// Build no Vercel (npm run vercel-build). Roda a cada deploy:
//   1. copia o site (../frontend) para public/, que o Vercel serve pela CDN;
//   2. troca o banco do schema para PostgreSQL (localmente continua SQLite);
//   3. gera o Prisma Client, cria/atualiza as tabelas e carrega os pontos (upsert, não duplica).
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

// Criar tabelas pela conexão direta; o app usa a conexão com pool (DATABASE_URL).
const envSemPool = { ...process.env, DATABASE_URL: process.env.DATABASE_URL_UNPOOLED || urlBanco };
const rodar = (comando, env = process.env) => execSync(comando, { stdio: 'inherit', env });

etapa('Gerando o Prisma Client');
rodar('npx prisma generate');

etapa('Criando/atualizando as tabelas');
rodar('npx prisma db push --skip-generate', envSemPool);

etapa('Carregando municípios, categorias, pontos e admin');
rodar('node prisma/seed.js', envSemPool);
