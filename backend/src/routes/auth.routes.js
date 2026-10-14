import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validar } from '../middlewares/validar.js';
import { login } from '../services/auth.service.js';
import { esquemaLogin } from '../validacao/esquemas.js';

export const rotasAuth = Router();

const limiteLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    erro: { codigo: 'MUITAS_TENTATIVAS', mensagem: 'Muitas tentativas de login. Aguarde 15 minutos.' },
  },
});

rotasAuth.post('/login', limiteLogin, validar({ body: esquemaLogin }), async (req, res) => {
  const { email, senha } = req.dados.body;
  res.json(await login(email, senha));
});
