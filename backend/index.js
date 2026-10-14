// Ponto de entrada no Vercel: ele procura por nome um index.js, app.js ou server.js
// (na raiz ou em src/) que exporte o app Express. Por isso este é o ÚNICO arquivo com
// um desses nomes — os do src/ se chamam aplicacao.js e servidor.js de propósito.
// Localmente e no Docker o servidor sobe por src/servidor.js.
import { criarApp } from './src/aplicacao.js';

export default criarApp();
