import multer from 'multer';
import { ZodError } from 'zod';
import { AppError } from '../utils/erros.js';

function responder(res, status, codigo, mensagem, detalhes) {
  res.status(status).json({ erro: { codigo, mensagem, ...(detalhes && { detalhes }) } });
}

// Todo erro da API sai no mesmo formato: { erro: { codigo, mensagem, detalhes? } }
// O front só precisa aprender a ler um jeito.
export function tratarErros(erro, req, res, next) {
  if (res.headersSent) return next(erro);

  if (erro instanceof AppError) {
    return responder(res, erro.status, erro.codigo, erro.message, erro.detalhes);
  }
  if (erro instanceof ZodError) {
    const detalhes = erro.issues.map((i) => ({ campo: i.path.join('.'), mensagem: i.message }));
    return responder(res, 400, 'DADOS_INVALIDOS', 'Verifique os dados enviados.', detalhes);
  }
  if (erro instanceof multer.MulterError) {
    return responder(res, 400, 'UPLOAD_INVALIDO', erro.message);
  }
  if (erro?.type === 'entity.parse.failed') {
    return responder(res, 400, 'JSON_INVALIDO', 'O corpo da requisição não é um JSON válido.');
  }
  // códigos do Prisma: P2002 = duplicado, P2025 = não achou
  if (erro?.code === 'P2002') {
    return responder(res, 409, 'JA_EXISTE', 'Já existe um registro com esses dados.');
  }
  if (erro?.code === 'P2025') {
    return responder(res, 404, 'NAO_ENCONTRADO', 'Registro não encontrado.');
  }

  // chegou aqui = a gente não previu. Loga tudo e torce
  console.error(erro);
  responder(res, 500, 'ERRO_INTERNO', 'Erro inesperado. Tente novamente.');
}

export function rotaNaoEncontrada(req, res) {
  responder(res, 404, 'ROTA_NAO_ENCONTRADA', `A rota ${req.method} ${req.originalUrl} não existe.`);
}
