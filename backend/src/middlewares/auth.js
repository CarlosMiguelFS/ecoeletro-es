import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { AppError } from '../utils/erros.js';

// Pede o crachá: "Authorization: Bearer <token>". Se estiver ok, o usuário fica em req.usuario.
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

// sempre depois do exigirAuth (primeiro descobre quem é, depois o que pode)
export function exigirPapel(...papeis) {
  return (req, res, next) => {
    if (!papeis.includes(req.usuario?.papel)) {
      throw new AppError(403, 'SEM_PERMISSAO', 'Seu usuário não tem permissão para esta ação.');
    }
    next();
  };
}
