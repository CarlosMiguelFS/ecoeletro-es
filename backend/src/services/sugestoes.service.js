import { prisma } from '../config/db.js';
import { AppError } from '../utils/erros.js';

export async function criarSugestao(dados) {
  if (dados.ponto_id) {
    const existe = await prisma.pontoColeta.count({ where: { id: dados.ponto_id } });
    if (!existe) throw new AppError(404, 'PONTO_NAO_ENCONTRADO', 'Ponto de coleta não encontrado.');
  }
  const sugestao = await prisma.sugestao.create({
    data: {
      tipo: dados.tipo,
      pontoId: dados.ponto_id ?? null,
      mensagem: dados.mensagem,
      emailContato: dados.email_contato ?? null,
    },
  });
  // Não devolve o e-mail: a resposta é pública.
  return { id: sugestao.id, status: sugestao.status, mensagem: 'Obrigado! Sua sugestão será analisada.' };
}

function formatar(s) {
  return {
    id: s.id,
    tipo: s.tipo,
    status: s.status,
    mensagem: s.mensagem,
    email_contato: s.emailContato,
    ponto: s.ponto ? { id: s.ponto.id, nome: s.ponto.nome } : null,
    created_at: s.createdAt,
  };
}

export async function listarSugestoes({ status }) {
  const sugestoes = await prisma.sugestao.findMany({
    where: status ? { status } : {},
    include: { ponto: { select: { id: true, nome: true } } },
    orderBy: { createdAt: 'desc' },
  });
  return sugestoes.map(formatar);
}

export async function alterarStatusSugestao(id, status) {
  const existe = await prisma.sugestao.count({ where: { id } });
  if (!existe) throw new AppError(404, 'SUGESTAO_NAO_ENCONTRADA', 'Sugestão não encontrada.');
  const sugestao = await prisma.sugestao.update({
    where: { id },
    data: { status },
    include: { ponto: { select: { id: true, nome: true } } },
  });
  return formatar(sugestao);
}
