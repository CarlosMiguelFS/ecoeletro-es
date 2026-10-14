import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { env } from './config/env.js';
import openapi from './docs/openapi.json' with { type: 'json' };
import { paginaDocs } from './docs/pagina-docs.js';
import { rotaNaoEncontrada, tratarErros } from './middlewares/erro.js';
import { rotasAdmin } from './routes/admin.routes.js';
import { rotasAuth } from './routes/auth.routes.js';
import { rotasPublicas } from './routes/publicas.routes.js';

// No Vercel o site é servido pela CDN (pasta public/); localmente e no Docker, por aqui.
const pastaFrontend = fileURLToPath(new URL('../../frontend', import.meta.url));

function origemPermitida(origem, callback) {
  // Sem Origin = mesmo site, curl ou Postman. "null" = HTML aberto com dois cliques (file://), só em dev.
  const permitida = !origem || env.corsOrigens.includes(origem) || (!env.producao && origem === 'null');
  callback(null, permitida);
}

export function criarApp() {
  const app = express();
  app.set('trust proxy', 1);

  // Documentação antes do helmet, porque o Swagger UI não funciona com a CSP abaixo.
  app.get('/api/openapi.json', (req, res) => res.json(openapi));
  app.get(['/api/docs', '/api/docs/'], (req, res) => res.type('html').send(paginaDocs));

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          'script-src': ["'self'", 'https://unpkg.com'],
          'style-src': ["'self'", "'unsafe-inline'", 'https://unpkg.com'],
          'img-src': ["'self'", 'data:', 'https://tile.openstreetmap.org', 'https://unpkg.com'],
          'upgrade-insecure-requests': null,
        },
      },
      // O padrão do helmet (no-referrer) faz o OpenStreetMap bloquear os tiles com 403:
      // a política de uso deles exige o Referer. Este valor envia só a origem (sem caminho) para outros sites.
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(cors({ origin: origemPermitida }));
  app.use(express.json({ limit: '100kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { erro: { codigo: 'MUITAS_REQUISICOES', mensagem: 'Muitas requisições. Aguarde um minuto.' } },
    }),
  );

  app.get('/api/saude', (req, res) => res.json({ status: 'ok' }));
  app.use('/api/auth', rotasAuth);
  app.use('/api/admin', rotasAdmin);
  app.use('/api', rotasPublicas);
  app.use('/api', rotaNaoEncontrada);

  app.use(express.static(pastaFrontend));

  app.use(tratarErros);
  return app;
}
