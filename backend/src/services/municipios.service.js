import { prisma } from '../config/db.js';
import { AppError } from '../utils/erros.js';
import { normalizarTexto } from '../utils/texto.js';
import { geocodificar } from './geocodificacao.service.js';

// "vitoria", "VITÓRIA", " Vitória " → todos acham Vitória
export async function encontrarMunicipioPorNome(nome) {
  if (!nome) return null;
  const alvo = normalizarTexto(nome);
  const municipios = await prisma.municipio.findMany();
  return municipios.find((m) => normalizarTexto(m.nome) === alvo) ?? null;
}

// No cadastro de ponto: se a cidade ainda não está no banco, pergunta pro Nominatim onde ela fica e cadastra
export async function obterOuCriarMunicipio(nome) {
  const existente = await encontrarMunicipioPorNome(nome);
  if (existente) return existente;

  const centro = await geocodificar({ cidade: nome });
  if (!centro) {
    throw new AppError(422, 'MUNICIPIO_DESCONHECIDO', `Município "${nome}" não encontrado no ES.`);
  }
  return prisma.municipio.create({
    data: { nome: nome.trim(), latitudeCentro: centro.latitude, longitudeCentro: centro.longitude },
  });
}

// só as cidades que têm pelo menos um ponto ativo
export async function listarMunicipiosComPontos() {
  const municipios = await prisma.municipio.findMany({
    orderBy: { nome: 'asc' },
    select: {
      id: true,
      nome: true,
      latitudeCentro: true,
      longitudeCentro: true,
      _count: { select: { pontos: { where: { ativo: true } } } },
    },
  });
  return municipios
    .filter((m) => m._count.pontos > 0)
    .map((m) => ({
      id: m.id,
      nome: m.nome,
      total_pontos: m._count.pontos,
      latitude_centro: m.latitudeCentro,
      longitude_centro: m.longitudeCentro,
    }));
}
