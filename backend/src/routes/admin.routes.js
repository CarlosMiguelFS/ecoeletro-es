import { Router } from 'express';
import multer from 'multer';
import { exigirAuth, exigirPapel } from '../middlewares/auth.js';
import { validar } from '../middlewares/validar.js';
import { importarCsv } from '../services/importacao.service.js';
import {
  atualizarPonto,
  criarPonto,
  desativarPonto,
  listarPontos,
  obterPonto,
} from '../services/pontos.service.js';
import { alterarStatusSugestao, listarSugestoes } from '../services/sugestoes.service.js';
import { AppError } from '../utils/erros.js';
import {
  esquemaFiltroSugestoes,
  esquemaId,
  esquemaListagem,
  esquemaPonto,
  esquemaStatusSugestao,
} from '../validacao/esquemas.js';

export const rotasAdmin = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 1024 * 1024 },
  fileFilter: (req, arquivo, aceitar) => {
    const ehCsv = arquivo.originalname.toLowerCase().endsWith('.csv');
    aceitar(ehCsv ? null : new AppError(400, 'ARQUIVO_INVALIDO', 'Envie um arquivo .csv.'), ehCsv);
  },
});

// daqui pra baixo é área VIP: só com login.
// editor cuida de pontos e sugestões; excluir e importar CSV é coisa de admin
rotasAdmin.use(exigirAuth);

rotasAdmin.get('/pontos', validar({ query: esquemaListagem }), async (req, res) => {
  res.json(await listarPontos({ ...req.dados.query, incluirInativos: true }));
});

rotasAdmin.get('/pontos/:id', validar({ params: esquemaId }), async (req, res) => {
  res.json(await obterPonto(req.dados.params.id, { incluirInativos: true }));
});

rotasAdmin.post('/pontos', validar({ body: esquemaPonto }), async (req, res) => {
  res.status(201).json(await criarPonto(req.dados.body));
});

rotasAdmin.put('/pontos/:id', validar({ params: esquemaId, body: esquemaPonto }), async (req, res) => {
  res.json(await atualizarPonto(req.dados.params.id, req.dados.body));
});

rotasAdmin.delete('/pontos/:id', exigirPapel('admin'), validar({ params: esquemaId }), async (req, res) => {
  res.json(await desativarPonto(req.dados.params.id));
});

rotasAdmin.post('/pontos/importar', exigirPapel('admin'), upload.single('arquivo'), async (req, res) => {
  if (!req.file) {
    throw new AppError(400, 'ARQUIVO_AUSENTE', 'Envie o CSV no campo "arquivo" (multipart/form-data).');
  }
  res.json(await importarCsv(req.file.buffer));
});

rotasAdmin.get('/sugestoes', validar({ query: esquemaFiltroSugestoes }), async (req, res) => {
  res.json(await listarSugestoes(req.dados.query));
});

rotasAdmin.patch(
  '/sugestoes/:id',
  validar({ params: esquemaId, body: esquemaStatusSugestao }),
  async (req, res) => {
    res.json(await alterarStatusSugestao(req.dados.params.id, req.dados.body.status));
  },
);
