import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/erros.js';
import { cepEhDoES, formatarCep, normalizarCep } from '../utils/cep.js';
import { dentroDoES } from '../utils/geo.js';
import { buscarJson } from '../utils/http.js';
import { geocodificar } from './geocodificacao.service.js';
import { encontrarMunicipioPorNome } from './municipios.service.js';

// Quão confiável é a coordenada, dependendo de quem respondeu.
// Detalhe que custou caro descobrir: a BrasilAPI devolve o CENTRO DA CIDADE, não o do CEP.
// Por isso ela é "municipio", e não "endereco".
const PRECISAO = {
  nominatim: 'endereco',
  nominatim_bairro: 'bairro',
  brasilapi: 'municipio',
  nominatim_cidade: 'municipio',
  centro_municipio: 'municipio',
};

function numeroOuNull(valor) {
  if (valor === null || valor === undefined || valor === '') return null;
  const numero = Number(valor);
  return Number.isFinite(numero) ? numero : null;
}

// Combinado das funções abaixo (é meio feio, mas funciona):
//   objeto    → achou
//   null      → a API disse "esse CEP não existe"
//   undefined → a API nem respondeu direito

async function consultarBrasilApi(cep) {
  try {
    const { status, ok, corpo } = await buscarJson(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (status === 404 || status === 400) return null;
    if (!ok || !corpo) return undefined;
    // às vezes vem coordinates: {} vazio. E quando vem, é o centro da cidade (ver PRECISAO lá em cima)
    const coordenadas = corpo.location?.coordinates ?? {};
    return {
      logradouro: corpo.street || null,
      bairro: corpo.neighborhood || null,
      cidade: corpo.city || null,
      uf: corpo.state || null,
      latitude: numeroOuNull(coordenadas.latitude),
      longitude: numeroOuNull(coordenadas.longitude),
    };
  } catch (erro) {
    console.warn('[brasilapi] falha:', erro.message);
    return undefined;
  }
}

async function consultarViaCep(cep) {
  try {
    const { status, ok, corpo } = await buscarJson(`https://viacep.com.br/ws/${cep}/json/`);
    if (status === 400) return null;
    if (!ok || !corpo) return undefined;
    // clássico do ViaCEP: CEP que não existe responde 200 OK com { "erro": true }. Sucesso no erro.
    if (corpo.erro) return null;
    return {
      logradouro: corpo.logradouro || null,
      bairro: corpo.bairro || null,
      cidade: corpo.localidade || null,
      uf: corpo.uf || null,
      latitude: null,
      longitude: null,
    };
  } catch (erro) {
    console.warn('[viacep] falha:', erro.message);
    return undefined;
  }
}

// Vai descendo a escada, do mais preciso pro menos preciso:
//   1. rua (Nominatim)
//   2. bairro (Nominatim). A rua às vezes falha por grafia: "Vellozo" x "Veloso"
//   3. coordenada da BrasilAPI (centro da cidade)
//   4. centro do município que a gente tem no banco
//   5. cidade (Nominatim), última esperança
async function descobrirCoordenadas(endereco) {
  if (endereco.logradouro && endereco.cidade) {
    const achado = await geocodificar({ logradouro: endereco.logradouro, cidade: endereco.cidade });
    if (achado) return { ...achado, fonte: 'nominatim' };
  }

  if (endereco.bairro && endereco.cidade) {
    const achado = await geocodificar({ bairro: endereco.bairro, cidade: endereco.cidade });
    if (achado) return { ...achado, fonte: 'nominatim_bairro' };
  }

  if (dentroDoES(endereco.latitude, endereco.longitude)) {
    return { latitude: endereco.latitude, longitude: endereco.longitude, fonte: 'brasilapi' };
  }

  const municipio = await encontrarMunicipioPorNome(endereco.cidade);
  if (municipio) {
    return {
      latitude: municipio.latitudeCentro,
      longitude: municipio.longitudeCentro,
      fonte: 'centro_municipio',
    };
  }

  if (endereco.cidade) {
    const achado = await geocodificar({ cidade: endereco.cidade });
    if (achado) return { ...achado, fonte: 'nominatim_cidade' };
  }

  return null;
}

function formatar(registro) {
  return {
    cep: formatarCep(registro.cep),
    logradouro: registro.logradouro,
    bairro: registro.bairro,
    cidade: registro.cidade,
    uf: registro.uf,
    latitude: registro.latitude,
    longitude: registro.longitude,
    fonte: registro.fonte,
    precisao: PRECISAO[registro.fonte] ?? 'municipio',
  };
}

const expirado = (registro) =>
  Date.now() - registro.atualizadoEm.getTime() > env.cepCacheDias * 24 * 60 * 60 * 1000;

// CEP → endereço + coordenadas. Guarda no banco (cep_cache) pra não perguntar de novo amanhã.
export async function resolverCep(entrada) {
  const cep = normalizarCep(entrada);
  if (!cep) throw new AppError(400, 'CEP_INVALIDO', 'Informe um CEP com 8 dígitos.');
  if (!cepEhDoES(cep)) {
    throw new AppError(422, 'CEP_FORA_DO_ES', 'Este CEP não pertence ao Espírito Santo.');
  }

  const emCache = await prisma.cepCache.findUnique({ where: { cep } });
  if (emCache && !expirado(emCache)) return formatar(emCache);

  const brasilApi = await consultarBrasilApi(cep);
  let endereco = brasilApi;
  if (!endereco) {
    const viaCep = await consultarViaCep(cep);
    if (viaCep) {
      endereco = viaCep;
    } else {
      if (emCache) return formatar(emCache); // vencido, mas melhor que nada
      if (brasilApi === null || viaCep === null) {
        throw new AppError(404, 'CEP_NAO_ENCONTRADO', 'CEP não encontrado.');
      }
      throw new AppError(
        503,
        'SERVICO_CEP_INDISPONIVEL',
        'Os serviços de CEP não responderam. Tente novamente em instantes.',
      );
    }
  }

  if (endereco.uf && endereco.uf !== 'ES') {
    throw new AppError(422, 'CEP_FORA_DO_ES', 'Este CEP não pertence ao Espírito Santo.');
  }

  const coordenadas = await descobrirCoordenadas(endereco);
  if (!coordenadas) {
    throw new AppError(
      503,
      'GEOCODIFICACAO_INDISPONIVEL',
      'Não foi possível localizar este CEP no mapa. Tente novamente em instantes.',
    );
  }

  const dados = {
    logradouro: endereco.logradouro,
    bairro: endereco.bairro,
    cidade: endereco.cidade,
    uf: endereco.uf ?? 'ES',
    ...coordenadas,
  };
  const salvo = await prisma.cepCache.upsert({
    where: { cep },
    update: dados,
    create: { cep, ...dados },
  });
  return formatar(salvo);
}
