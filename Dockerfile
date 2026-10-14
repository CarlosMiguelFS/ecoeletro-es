# EcoEletro ES: API + site num único container.
FROM node:24-alpine

# O Prisma precisa do OpenSSL no Alpine.
RUN apk add --no-cache openssl

WORKDIR /app/backend

# Dependências primeiro (camada reaproveitada quando só o código muda).
COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci && npx prisma generate

COPY backend/ ./
COPY frontend/ /app/frontend/

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_URL=file:/data/ecoeletro.db \
    SEED_DADOS=reais

# O banco SQLite fica num volume: sobrevive a rebuilds e atualizações.
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD wget -qO- http://localhost:3000/api/saude || exit 1

# Cria/atualiza as tabelas, carrega os pontos (upsert, não duplica) e sobe o servidor.
CMD ["sh", "-c", "npx prisma db push --skip-generate && node prisma/seed.js && node src/servidor.js"]
