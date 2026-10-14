import { prisma } from '../config/db.js';
import { AppError } from '../utils/erros.js';
import { formatarCep } from '../utils/cep.js';
import { dentroDoES, distanciaKm, linkComoChegar } from '../utils/geo.js';
import { resolverCep } from './cep.service.js';
import { geocodificar } from './geocodificacao.service.js';
import { distanciasDeCarro, MAXIMO_DESTINOS } from './rotas.service.js';
import { encontrarMunicipioPorNome, obterOuCriarMunicipio } from './municipios.service.js';

const incluir = { municipio: true, categorias: { include: { categoria: true } } };

function lerHorario(texto) {
  if (!texto) return null;
  try {
    return JSON.parse(texto);
  } catch {
    return null;
  }
}

// Banco → formato da API (snake_case, endereço montadinho, link de rota).
// Na busca por proximidade vem junto a medida ({ reta, rota? }) e a origem, pra rota sair do CEP.
function formatarPonto(ponto, medida, origem) {
  const umaCasa = (km) => Math.round(km * 10) / 10;
  return {
    id: ponto.id,
    nome: ponto.nome,
    tipo: ponto.tipo,
    ...(medida && {
      // de carro se o OSRM respondeu, senão linha reta mesmo
      distancia_km: umaCasa(medida.rota ? medida.rota.distanciaKm : medida.reta),
      distancia_tipo: medida.rota ? 'carro' : 'linha_reta',
      ...(medida.rota && { duracao_min: medida.rota.duracaoMin }),
      distancia_reta_km: umaCasa(medida.reta),
    }),
    endereco: `${ponto.logradouro}, ${ponto.numero} - ${ponto.bairro}, ${ponto.municipio.nome} - ES`,
    logradouro: ponto.logradouro,
    numero: ponto.numero,
    bairro: ponto.bairro,
    cep: ponto.cep ? formatarCep(ponto.cep) : null,
    municipio: ponto.municipio.nome,
    latitude: ponto.latitude,
    longitude: ponto.longitude,
    telefone: ponto.telefone,
    email: ponto.email,
    site: ponto.site,
    horario: lerHorario(ponto.horario),
    observacoes: ponto.observacoes,
    fonte_url: ponto.fonteUrl,
    categorias: ponto.categorias.map((pc) => pc.categoria.slug),
    ativo: ponto.ativo,
    verificado_em: ponto.verificadoEm,
    como_chegar: linkComoChegar(ponto.latitude, ponto.longitude, origem),
  };
}

async function montarFiltro({ municipio, categoria, tipo, incluirInativos = false }) {
  const where = {};
  if (!incluirInativos) where.ativo = true;
  if (tipo) where.tipo = tipo;
  if (categoria) where.categorias = { some: { categoria: { slug: categoria } } };
  if (municipio) {
    const encontrado = await encontrarMunicipioPorNome(municipio);
    where.municipioId = encontrado ? encontrado.id : -1; // município sem cadastro → lista vazia
  }
  return where;
}

export async function listarPontos({ page, limit, ...filtros }) {
  const where = await montarFiltro(filtros);
  const [total, pontos] = await Promise.all([
    prisma.pontoColeta.count({ where }),
    prisma.pontoColeta.findMany({
      where,
      include: incluir,
      orderBy: { nome: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);
  return {
    total,
    page,
    limit,
    paginas: Math.ceil(total / limit),
    pontos: pontos.map((p) => formatarPonto(p)),
  };
}

export async function obterPonto(id, { incluirInativos = false } = {}) {
  const ponto = await prisma.pontoColeta.findUnique({ where: { id }, include: incluir });
  if (!ponto || (!ponto.ativo && !incluirInativos)) {
    throw new AppError(404, 'PONTO_NAO_ENCONTRADO', 'Ponto de coleta não encontrado.');
  }
  return formatarPonto(ponto);
}

// O coração do projeto ❤️
// Recebe um CEP (ou o GPS) e devolve os pontos dentro do alcance, de carro.
// Regra de ouro: NINGUÉM sai de mãos vazias. Se não tiver nada no alcance, vai o mais
// próximo, nem que seja a 100 km, com fora_do_raio = true.
export async function buscarProximos({ cep, lat, lng, raio, limite, categoria, tipo }) {
  let origem;
  if (cep) {
    origem = await resolverCep(cep);
  } else {
    if (!dentroDoES(lat, lng)) {
      throw new AppError(422, 'FORA_DO_ES', 'Sua localização está fora do Espírito Santo.');
    }
    origem = { latitude: lat, longitude: lng, precisao: 'gps' };
  }

  // com algumas centenas de pontos dá pra fazer tudo em memória tranquilo.
  // Se um dia tiver milhares, aí é PostGIS (ST_DWithin). Problema do eu do futuro.
  const candidatos = await prisma.pontoColeta.findMany({
    where: await montarFiltro({ categoria, tipo }),
    include: incluir,
  });
  const porLinhaReta = candidatos
    .map((ponto) => ({
      ponto,
      reta: distanciaKm(origem.latitude, origem.longitude, ponto.latitude, ponto.longitude),
    }))
    .sort((a, b) => a.reta - b.reta);

  // Truque: pela rua nunca é mais perto que em linha reta (a não ser que você atravesse paredes).
  // Então quem já está fora do alcance em linha reta nem vai pro OSRM.
  const noAlcanceReto = porLinhaReta.filter((item) => item.reta <= raio).slice(0, MAXIMO_DESTINOS);
  const rotas = await distanciasDeCarro(
    origem,
    noAlcanceReto.map((item) => item.ponto),
  );

  let porCarro = rotas !== null;
  let medidos = porCarro
    ? noAlcanceReto
        .map((item, i) => ({ ...item, rota: rotas[i] }))
        .filter((item) => item.rota && item.rota.distanciaKm <= raio)
        .sort((a, b) => a.rota.distanciaKm - b.rota.distanciaKm)
    : noAlcanceReto;

  const foraDoAlcance = medidos.length === 0;
  if (foraDoAlcance) {
    medidos = await maisProximoDeCarro(origem, porLinhaReta, porCarro);
    porCarro = medidos[0]?.rota !== undefined;
  }

  const selecionados = medidos.slice(0, limite);
  return {
    origem,
    raio_km: raio,
    distancia_tipo: porCarro ? 'carro' : 'linha_reta',
    fora_do_raio: foraDoAlcance,
    total: selecionados.length,
    pontos: selecionados.map((item) =>
      formatarPonto(item.ponto, { reta: item.reta, rota: porCarro ? item.rota : undefined }, origem),
    ),
  };
}

// Nada no alcance: pega os 5 mais perto em linha reta e escolhe o mais perto DE CARRO.
// O mais perto "de avião" pode estar do outro lado da baía de Vitória. Pergunta como a gente sabe.
async function maisProximoDeCarro(origem, porLinhaReta, tentarCarro) {
  const finalistas = porLinhaReta.slice(0, 5);
  if (finalistas.length === 0) return [];

  const rotas = tentarCarro
    ? await distanciasDeCarro(
        origem,
        finalistas.map((item) => item.ponto),
      )
    : null;
  if (rotas === null) return finalistas.slice(0, 1);

  const comRota = finalistas
    .map((item, i) => ({ ...item, rota: rotas[i] }))
    .filter((item) => item.rota)
    .sort((a, b) => a.rota.distanciaKm - b.rota.distanciaKm);
  return comRota.length ? comRota.slice(0, 1) : finalistas.slice(0, 1);
}

// ---------- Administração ----------

async function idsDasCategorias(slugs) {
  const unicos = [...new Set(slugs)];
  const categorias = await prisma.categoria.findMany({ where: { slug: { in: unicos } } });
  const faltando = unicos.filter((slug) => !categorias.some((c) => c.slug === slug));
  if (faltando.length) {
    throw new AppError(422, 'CATEGORIA_INVALIDA', `Categorias inexistentes: ${faltando.join(', ')}.`);
  }
  return categorias.map((c) => c.id);
}

export const AVISO_LOCALIZACAO_APROXIMADA = 'Localização no mapa aproximada pelo bairro.';

// Veio latitude/longitude? Ótimo, usa. Senão a gente descobre pelo endereço:
// rua + número → só a rua → CEP → bairro (esse marca como "aproximada").
// Centro da cidade pra ponto de coleta NUNCA: imagina mandar o povo pra praça da matriz com uma geladeira.
async function resolverCoordenadas(dados, municipio) {
  if (dados.latitude !== undefined) {
    if (!dentroDoES(dados.latitude, dados.longitude)) {
      throw new AppError(422, 'COORDENADAS_FORA_DO_ES', 'Latitude/longitude fora do Espírito Santo.');
    }
    return { latitude: dados.latitude, longitude: dados.longitude, aproximada: false };
  }

  const cidade = municipio.nome;
  const temNumero = dados.numero && dados.numero !== 'S/N';
  const tentativas = [
    temNumero && { logradouro: dados.logradouro, numero: dados.numero, cidade },
    { logradouro: dados.logradouro, cidade },
  ].filter(Boolean);
  for (const tentativa of tentativas) {
    const achado = await geocodificar(tentativa);
    if (achado) return { ...achado, aproximada: false };
  }

  if (dados.cep) {
    try {
      const peloCep = await resolverCep(dados.cep);
      if (peloCep.precisao === 'endereco') {
        return { latitude: peloCep.latitude, longitude: peloCep.longitude, aproximada: false };
      }
    } catch {
      // deu ruim no CEP, bora pro bairro
    }
  }

  const peloBairro = await geocodificar({ bairro: dados.bairro, cidade });
  if (peloBairro) return { ...peloBairro, aproximada: true };

  throw new AppError(
    422,
    'GEOCODIFICACAO_FALHOU',
    'Não foi possível localizar o endereço. Informe latitude e longitude manualmente.',
  );
}

function observacoesComAviso(observacoes, aproximada) {
  if (!aproximada || observacoes?.includes(AVISO_LOCALIZACAO_APROXIMADA)) return observacoes ?? null;
  return [observacoes, AVISO_LOCALIZACAO_APROXIMADA].filter(Boolean).join(' ');
}

function camposDoPonto(dados) {
  return {
    nome: dados.nome,
    tipo: dados.tipo,
    logradouro: dados.logradouro,
    numero: dados.numero || 'S/N',
    bairro: dados.bairro,
    cep: dados.cep ?? '',
    telefone: dados.telefone ?? null,
    email: dados.email ?? null,
    site: dados.site ?? null,
    horario: dados.horario ? JSON.stringify(dados.horario) : null,
    observacoes: dados.observacoes ?? null,
    fonteUrl: dados.fonte_url ?? null,
    ativo: dados.ativo ?? true,
    verificadoEm: dados.verificado_em ?? null,
  };
}

export async function criarPonto(dados) {
  const municipio = await obterOuCriarMunicipio(dados.municipio);
  const categoriaIds = await idsDasCategorias(dados.categorias);
  const { aproximada, ...coordenadas } = await resolverCoordenadas(dados, municipio);

  const ponto = await prisma.pontoColeta.create({
    data: {
      ...camposDoPonto(dados),
      ...coordenadas,
      observacoes: observacoesComAviso(dados.observacoes, aproximada),
      municipioId: municipio.id,
      categorias: { create: categoriaIds.map((categoriaId) => ({ categoriaId })) },
    },
    include: incluir,
  });
  return formatarPonto(ponto);
}

// PUT troca o ponto inteiro. Se não mandar latitude/longitude, a gente geocodifica de novo
export async function atualizarPonto(id, dados) {
  await obterPonto(id, { incluirInativos: true });
  const municipio = await obterOuCriarMunicipio(dados.municipio);
  const categoriaIds = await idsDasCategorias(dados.categorias);
  const { aproximada, ...coordenadas } = await resolverCoordenadas(dados, municipio);

  const ponto = await prisma.pontoColeta.update({
    where: { id },
    data: {
      ...camposDoPonto(dados),
      ...coordenadas,
      observacoes: observacoesComAviso(dados.observacoes, aproximada),
      municipioId: municipio.id,
      categorias: {
        deleteMany: {},
        create: categoriaIds.map((categoriaId) => ({ categoriaId })),
      },
    },
    include: incluir,
  });
  return formatarPonto(ponto);
}

// não apaga de verdade, só esconde (ativo = false). As sugestões ligadas ao ponto agradecem
export async function desativarPonto(id) {
  await obterPonto(id, { incluirInativos: true });
  await prisma.pontoColeta.update({ where: { id }, data: { ativo: false } });
  return { id, ativo: false };
}
