import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/erros.js';

/** Exige o cabeçalho "Authorization: Bearer <token>" e guarda o usuário em req.usuario. */
export function exigirAuth(req, res, next) {
  const [tipo, token] = (req.headers.authorization ?? '').split(' ');
  if (tipo !== 'Bearer' || !token) {
    throw new AppError(401, 'NAO_AUTENTICADO', 'Faça login para acessar esta área.');
  }
  try {
    const dados = jwt.verify(token, env.jwtSecret);
    req.usuario = { id: Number(dados.sub), papel: dados.papel };
  } catch {
    throw new AppError(401, 'TOKEN_INVALIDO', 'Sessão inválida ou expirada. Faça login novamente.');
  }
  next();
}

/** Use depois de exigirAuth. */
export function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (!papeis.includes(req.usuario?.papel)) {
      throw new AppError(403, 'SEM_PERMISSAO', 'Seu usuário não tem permissão para esta ação.');
    }
    next();
  };
}
