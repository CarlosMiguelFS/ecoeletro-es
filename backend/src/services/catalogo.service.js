import { prisma } from '../config/db.js';

const pontosAtivos = { pontos: { where: { ponto: { ativo: true } } } };

export async function listarCategorias() {
  const categorias = await prisma.categoria.findMany({
    orderBy: { nome: 'asc' },
    include: { _count: { select: pontosAtivos } },
  });
  return categorias.map((c) => ({
    id: c.id,
    slug: c.slug,
    nome: c.nome,
    descricao: c.descricao,
    total_pontos: c._count.pontos,
  }));
}

// números pros gráficos da apresentação 📊
export async function obterEstatisticas() {
  const [totalPontos, porTipo, municipios, categorias, totalSugestoes] = await Promise.all([
    prisma.pontoColeta.count({ where: { ativo: true } }),
    prisma.pontoColeta.groupBy({ by: ['tipo'], where: { ativo: true }, _count: { _all: true } }),
    prisma.municipio.findMany({
      select: { nome: true, _count: { select: { pontos: { where: { ativo: true } } } } },
    }),
    listarCategorias(),
    prisma.sugestao.count(),
  ]);

  return {
    total_pontos: totalPontos,
    total_municipios_atendidos: municipios.filter((m) => m._count.pontos > 0).length,
    total_sugestoes_recebidas: totalSugestoes,
    por_tipo: porTipo.map((t) => ({ tipo: t.tipo, total: t._count._all })).sort((a, b) => b.total - a.total),
    por_municipio: municipios
      .filter((m) => m._count.pontos > 0)
      .map((m) => ({ municipio: m.nome, total: m._count.pontos }))
      .sort((a, b) => b.total - a.total || a.municipio.localeCompare(b.municipio)),
    por_categoria: categorias
      .map((c) => ({ categoria: c.slug, nome: c.nome, total: c.total_pontos }))
      .sort((a, b) => b.total - a.total),
  };
}
