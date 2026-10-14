// Roda a cada deploy no Vercel (npm run vercel-build):
//   1. copia o site (../frontend) pra public/, que é a única pasta que o Vercel serve
//   2. troca SQLite por PostgreSQL no schema (só lá, aqui continua SQLite)
//   3. gera o Prisma Client, cria as tabelas e carrega os pontos
// Se der erro aqui, o deploy para e o site antigo continua no ar. Ufa.
import { execSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const raiz = new URL('../', import.meta.url);
const caminho = (relativo) => new URL(relativo, raiz);

function etapa(titulo) {
  console.log(`\n▶ ${titulo}`);
}

etapa('Copiando o site para public/');
rmSync(caminho('public'), { recursive: true, force: true });
cpSync(caminho('../frontend'), caminho('public'), { recursive: true });

const urlBanco = process.env.DATABASE_URL ?? '';
if (!/^postgres(ql)?:\/\//.test(urlBanco)) {
  throw new Error(
    'DATABASE_URL precisa ser um PostgreSQL (ex.: Neon). No Vercel: Storage → Create Database → Neon, ' +
      'e conecte ao projeto. SQLite não funciona no Vercel porque o disco não é permanente.',
  );
}

etapa('Usando PostgreSQL no schema do Prisma');
const arquivoSchema = caminho('prisma/schema.prisma');
const schema = readFileSync(arquivoSchema, 'utf8');
writeFileSync(arquivoSchema, schema.replace('provider = "sqlite"', 'provider = "postgresql"'));

// tabelas pela conexão direta (o pooler do Neon não curte DDL); o app usa a com pool
const envSemPool = { ...process.env, DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || urlBanco };
const rodar = (comando, env = process.env) => execSync(comando, { stdio: 'inherit', env });

etapa('Gerando o Prisma Client');
rodar('npx prisma generate');

etapa('Criando/atualizando as tabelas');
rodar('npx prisma db push --skip-generate', envSemPool);

etapa('Carregando municípios, categorias, pontos e admin');
rodar('node prisma/seed.js', envSemPool);
