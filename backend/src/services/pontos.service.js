import { prisma } from '../config/db.js';
import { AppError } from '../utils/erros.js';
import { formatarCep } from '../utils/cep.js';
import { dentroDoES, distanciaKm, linkComoChegar } from '../utils/geo.js';
import { resolverCep } from './cep.service.js';
import { geocodificar } from './geocodificacao.service.js';
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

/**
 * Converte o registro do banco no formato da API (snake_case, endereço pronto, link de rota).
 * Em buscas por proximidade, recebe a distância e a origem (CEP ou GPS) para a rota partir de lá.
 */
function formatarPonto(ponto, distancia, origem) {
  return {
    id: ponto.id,
    nome: ponto.nome,
    tipo: ponto.tipo,
    ...(distancia !== undefined && { distancia_km: Math.round(distancia * 10) / 10 }),
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

/**
 * Pontos mais próximos de um CEP ou de uma coordenada (GPS do navegador), sempre no ES.
 * Devolve todos os pontos dentro do raio (padrão 12 km). Se nenhum cair no raio,
 * devolve só o mais próximo, esteja a que distância estiver, com fora_do_raio = true —
 * o usuário sempre recebe pelo menos um lugar para levar o material.
 */
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

  // Com algumas centenas de pontos, calcular a distância em memória é suficiente.
  // Com milhares, troque por uma consulta PostGIS (ST_DWithin).
  const candidatos = await prisma.pontoColeta.findMany({
    where: await montarFiltro({ categoria, tipo }),
    include: incluir,
  });
  const ordenados = candidatos
    .map((ponto) => ({
      ponto,
      distancia: distanciaKm(origem.latitude, origem.longitude, ponto.latitude, ponto.longitude),
    }))
    .sort((a, b) => a.distancia - b.distancia);

  const noRaio = ordenados.filter((item) => item.distancia <= raio);
  const foraDoRaio = noRaio.length === 0;
  const selecionados = foraDoRaio ? ordenados.slice(0, 1) : noRaio.slice(0, limite);

  return {
    origem,
    raio_km: raio,
    fora_do_raio: foraDoRaio,
    total: selecionados.length,
    pontos: selecionados.map((item) => formatarPonto(item.ponto, item.distancia, origem)),
  };
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

/**
 * Usa a coordenada informada ou geocodifica o endereço, do mais preciso ao menos preciso:
 * rua + número → só a rua → CEP → bairro (marcado como aproximado).
 * Nunca usa o centro do município para um ponto. Retorna { latitude, longitude, aproximada }.
 */
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
      // segue para o bairro
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

/** PUT: substitui o ponto inteiro. Sem latitude/longitude no corpo, o endereço é geocodificado de novo. */
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

/** Não apaga: só marca como inativo, para manter o histórico e as sugestões ligadas ao ponto. */
export async function desativarPonto(id) {
  await obterPonto(id, { incluirInativos: true });
  await prisma.pontoColeta.update({ where: { id }, data: { ativo: false } });
  return { id, ativo: false };
}
