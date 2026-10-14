import { PrismaClient } from '@prisma/client';

// um client só pra aplicação inteira
export const prisma = new PrismaClient();
