// Isso aqui só existe por causa do Vercel.
// Ele sai procurando um index.js / app.js / server.js que importe o express,
// e se achar mais de um escolhe o errado (já aconteceu, foi um dia longo).
// Por isso os arquivos do src/ se chamam aplicacao.js e servidor.js.
// Rodando local ou no Docker, quem sobe o servidor é o src/servidor.js.
import express from 'express';
import { criarApp } from './src/aplicacao.js';

export default criarApp(express());
