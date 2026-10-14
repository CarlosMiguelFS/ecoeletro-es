import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { AppError } from '../utils/erros.js';

export async function login(email, senha) {
  const usuario = await prisma.usuarioAdmin.findUnique({ where: { email: email.toLowerCase() } });
  const senhaCorreta = usuario && (await bcrypt.compare(senha, usuario.senhaHash));
  if (!senhaCorreta) {
    throw new AppError(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha inválidos.');
  }

  const token = jwt.sign({ sub: String(usuario.id), papel: usuario.papel }, env.jwtSecret, {
    expiresIn: env.jwtExpiracao,
  });
  return {
    token,
    expira_em: env.jwtExpiracao,
    usuario: { id: usuario.id, nome: usuario.nome, email: usuario.email, papel: usuario.papel },
  };
}
