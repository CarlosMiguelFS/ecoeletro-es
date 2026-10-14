// Cria um banco separado (prisma/test.db) só com os dados fictícios, para os testes
// não dependerem de internet nem mexerem no banco de desenvolvimento.
import { execSync } from 'node:child_process';

const env = { ...process.env, DATABASE_URL: 'file:./test.db', SEED_DADOS: 'ficticios' };
execSync('npx prisma db push --skip-generate', { stdio: 'inherit', env });
execSync('node --env-file-if-exists=.env prisma/seed.js', { stdio: 'inherit', env });
