// Ponto de entrada no Vercel. Ele exige um arquivo chamado index.js, app.js ou server.js
// (na raiz ou em src/) que IMPORTE o express e exporte o app como default. Por isso
// este é o único arquivo com um desses nomes — os do src/ se chamam aplicacao.js e
// servidor.js de propósito. Localmente e no Docker o servidor sobe por src/servidor.js.
import express from 'express';
import { criarApp } from './src/aplicacao.js';

export default criarApp(express());
