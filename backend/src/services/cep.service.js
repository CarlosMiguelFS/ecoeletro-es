import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/erros.js';
import { cepEhDoES, formatarCep, normalizarCep } from '../utils/cep.js';
import { dentroDoES } from '../utils/geo.js';
import { buscarJson } from '../utils/http.js';
import { geocodificar } from './geocodificacao.service.js';
import { encontrarMunicipioPorNome } from './municipios.service.js';

// Quão exata é a coordenada, conforme a fonte que a forneceu.
// A BrasilAPI (base open-cep) devolve o centro da cidade, não o do CEP — por isso "municipio".
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

// As consultas retornam: objeto = encontrado | null = a API disse que não existe | undefined = a API falhou.

async function consultarBrasilApi(cep) {
  try {
    const { status, ok, corpo } = await buscarJson(`https://brasilapi.com.br/api/cep/v2/${cep}`);
    if (status === 404 || status === 400) return null;
    if (!ok || !corpo) return undefined;
    // A v2 nem sempre traz coordenadas: "coordinates" pode vir como {}.
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
    // CEP inexistente responde HTTP 200 com { "erro": true }.
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

/**
 * Tenta, do mais preciso ao menos preciso: Nominatim pela rua → Nominatim pelo bairro →
 * coordenada da BrasilAPI → centro do município cadastrado → Nominatim pela cidade.
 */
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

/** CEP → endereço + coordenadas, com cache no banco (tabela cep_cache). */
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
      if (emCache) return formatar(emCache); // dado antigo é melhor do que nenhum
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
