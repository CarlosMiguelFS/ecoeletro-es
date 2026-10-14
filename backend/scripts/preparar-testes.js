// Os testes ganham um banco só deles (prisma/test.db), com os dados fictícios.
// Assim não precisam de internet e não bagunçam o banco de desenvolvimento.
import { execSync } from 'node:child_process';

const env = { ...process.env, DATABASE_URL: 'file:./test.db', SEED_DADOS: 'ficticios' };
execSync('npx prisma db push --skip-generate', { stdio: 'inherit', env });
execSync('node --env-file-if-exists=.env prisma/seed.js', { stdio: 'inherit', env });
