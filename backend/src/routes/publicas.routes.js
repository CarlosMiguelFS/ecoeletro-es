import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validar } from '../middlewares/validar.js';
import { listarCategorias, obterEstatisticas } from '../services/catalogo.service.js';
import { resolverCep } from '../services/cep.service.js';
import { listarMunicipiosComPontos } from '../services/municipios.service.js';
import { criarSugestao } from '../services/sugestoes.service.js';
import { esquemaSugestao } from '../validacao/esquemas.js';
import { rotasPontos } from './pontos.routes.js';

export const rotasPublicas = Router();

const limiteSugestoes = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    erro: { codigo: 'MUITAS_SUGESTOES', mensagem: 'Muitas sugestões seguidas. Tente de novo em 15 minutos.' },
  },
});

rotasPublicas.use('/pontos', rotasPontos);

rotasPublicas.get('/categorias', async (req, res) => {
  res.json(await listarCategorias());
});

rotasPublicas.get('/municipios', async (req, res) => {
  res.json(await listarMunicipiosComPontos());
});

rotasPublicas.get('/cep/:cep', async (req, res) => {
  res.json(await resolverCep(req.params.cep));
});

rotasPublicas.get('/estatisticas', async (req, res) => {
  res.json(await obterEstatisticas());
});

rotasPublicas.post('/sugestoes', limiteSugestoes, validar({ body: esquemaSugestao }), async (req, res) => {
  res.status(201).json(await criarSugestao(req.dados.body));
});
