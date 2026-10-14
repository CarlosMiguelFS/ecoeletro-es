import { Router } from 'express';
import { validar } from '../middlewares/validar.js';
import { buscarProximos, listarPontos, obterPonto } from '../services/pontos.service.js';
import { esquemaId, esquemaListagem, esquemaProximos } from '../validacao/esquemas.js';

export const rotasPontos = Router();

rotasPontos.get('/', validar({ query: esquemaListagem }), async (req, res) => {
  res.json(await listarPontos(req.dados.query));
});

// tem que vir antes do "/:id", senão o Express acha que "proximos" é um id. E aí, qual o id de "proximos"?
rotasPontos.get('/proximos', validar({ query: esquemaProximos }), async (req, res) => {
  res.json(await buscarProximos(req.dados.query));
});

rotasPontos.get('/:id', validar({ params: esquemaId }), async (req, res) => {
  res.json(await obterPonto(req.dados.params.id));
});
