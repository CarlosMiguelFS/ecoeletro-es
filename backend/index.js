// Ponto de entrada no Vercel: ele procura um index.js que exporte o app Express.
// Localmente e no Docker o servidor sobe por src/server.js.
import { criarApp } from './src/app.js';

export default criarApp();
