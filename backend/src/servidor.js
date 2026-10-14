import { criarApp } from './aplicacao.js';
import { prisma } from './config/db.js';
import { env } from './config/env.js';

const servidor = criarApp().listen(env.porta, () => {
  console.log(`EcoEletro ES rodando em http://localhost:${env.porta}`);
  console.log(`  Site:  http://localhost:${env.porta}/`);
  console.log(`  API:   http://localhost:${env.porta}/api/pontos`);
  console.log(`  Docs:  http://localhost:${env.porta}/api/docs`);
});

// Ctrl+C fecha tudo direitinho, sem deixar conexão do banco pendurada
async function encerrar() {
  servidor.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', encerrar);
process.on('SIGTERM', encerrar);
