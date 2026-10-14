# EcoEletro ES

Site para encontrar **pontos de coleta de lixo eletrônico no Espírito Santo**: você digita o CEP e vê no mapa todos os pontos até 12 km, com endereço, horário, materiais aceitos e rota.

Projeto Integrador (PEI II) — Análise e Desenvolvimento de Sistemas.

## Funcionalidades

- **Busca por CEP** (ou pela localização do navegador): mostra todos os pontos até **12 km**. Se não houver nenhum, mostra **o mais próximo**, a qualquer distância, sempre dentro do ES.
- **Mapa** (Leaflet + OpenStreetMap) com lista lateral; o balão de cada ponto tem horário, telefone, materiais aceitos, fonte da informação e o botão **Como chegar** (abre a rota no Google Maps).
- **Filtro por material**: celulares, computadores, pilhas, lâmpadas, eletrodomésticos…
- **32 pontos reais** reunidos de fontes públicas (prefeituras, Green Eletron, Reciclus, EDP, UVV), cada um com a URL da fonte e a data da informação.
- **API REST** documentada (Swagger), com área administrativa (login JWT), importação de pontos por CSV e sugestões de visitantes.

> Alguns dados das fontes são de 2021–2022. Horários e materiais aceitos podem mudar: confirme com o local antes de ir.

## Tecnologias

| Camada         | Tecnologia                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------- |
| Front-end      | HTML, CSS e JavaScript puros + [Leaflet](https://leafletjs.com)                               |
| Back-end       | Node.js, Express 5, Zod                                                                       |
| Banco de dados | SQLite via Prisma (troca para PostgreSQL mudando uma linha)                                   |
| Mapas e CEP    | OpenStreetMap (tiles), Nominatim (geocodificação), BrasilAPI e ViaCEP (CEP) — todos gratuitos |
| Testes         | `node:test` + Supertest                                                                       |
| Deploy         | Docker / Docker Compose                                                                       |

## Estrutura

```
.
├── frontend/                  # site estático
│   ├── index.html
│   └── assets/
│       ├── css/style.css
│       ├── js/config.js       # URL da API (automática em dev)
│       ├── js/app.js          # mapa, busca por CEP/localização, lista e balões
│       └── img/
├── backend/                   # API
│   ├── src/
│   │   ├── routes/            # rotas públicas, auth e admin
│   │   ├── services/          # regras: pontos, CEP, geocodificação, importação...
│   │   ├── validacao/         # esquemas Zod
│   │   ├── middlewares/       # auth, erros, validação
│   │   ├── utils/             # CEP, distância (Haversine), textos
│   │   └── docs/openapi.json  # Swagger em /api/docs
│   ├── prisma/                # schema do banco + seed
│   ├── seed/                  # pontos reais (CSV), fictícios (testes), municípios
│   └── tests/
├── docs/levantamento-backend.md   # levantamento técnico: decisões e erros previstos
├── Dockerfile
└── docker-compose.yml
```

## Rodando localmente

Requisito: [Node.js](https://nodejs.org) 20.12 ou mais novo.

```bash
cd backend
npm install
cp .env.example .env         # no Windows (PowerShell): copy .env.example .env
npm run db:setup             # cria o banco SQLite e importa os pontos reais
npm run dev                  # sobe a API e o site
```

| Endereço                             | O que é                                       |
| ------------------------------------ | --------------------------------------------- |
| http://localhost:3000                | O site                                        |
| http://localhost:3000/?cep=29101-010 | O site já com uma busca feita                 |
| http://localhost:3000/api/docs       | Documentação da API (dá para testar as rotas) |

Login do admin criado pelo seed: `admin@ecoeletro.local` / `trocar123` (mude `ADMIN_EMAIL` e `ADMIN_SENHA` no `.env` antes do `db:setup`).

### Comandos (pasta `backend/`)

| Comando             | Para quê                                                                         |
| ------------------- | -------------------------------------------------------------------------------- |
| `npm run dev`       | Sobe o servidor e reinicia ao salvar arquivos                                    |
| `npm test`          | Roda os 33 testes num banco separado (`test.db`), com dados fictícios e sem rede |
| `npm run db:seed`   | Reimporta os pontos (não duplica; reaproveita coordenadas já descobertas)        |
| `npm run db:studio` | Abre o Prisma Studio para ver e editar o banco no navegador                      |

Para adicionar ou corrigir pontos, edite [backend/seed/pontos-reais.csv](backend/seed/pontos-reais.csv) e rode `npm run db:seed` — ou envie um CSV em `POST /api/admin/pontos/importar` pelo Swagger. Linhas sem latitude/longitude são geocodificadas automaticamente.

## Deploy no Vercel

O back-end vira uma função serverless e o site é servido pela CDN do Vercel. Como lá o disco não é permanente, o banco é **PostgreSQL** (Neon, plano grátis); localmente continua SQLite — o build troca sozinho.

1. **Add New → Project** → importe o repositório → em **Root Directory** escolha **`backend`** (o Vercel detecta o Express).
2. Antes de fazer o deploy, abra **Environment Variables** e adicione:
   - `JWT_SECRET` — um texto aleatório longo
   - `ADMIN_SENHA` — a senha do usuário admin (`admin@ecoeletro.local`)
3. Clique em **Deploy**. O primeiro deploy vai **falhar de propósito** pedindo o banco — é normal.
4. No projeto: **Storage → Create Database → Neon** (Free) → conecte ao projeto (marque Production e Preview). Isso cria a variável `DATABASE_URL`.
5. **Deployments → ⋯ → Redeploy**. O build (`npm run vercel-build`) copia o site para `public/`, cria as tabelas e carrega os 32 pontos.

Cada `git push` na branch `main` gera um deploy novo automaticamente.

## Deploy com Docker

O container serve o site e a API juntos; o banco SQLite fica num volume.

```bash
# na pasta do projeto, no servidor
cat > .env <<EOF
JWT_SECRET=$(openssl rand -hex 32)
ADMIN_SENHA=$(openssl rand -base64 12)
PORTA=8090
EOF
docker compose up -d --build
```

O site fica em `http://IP-DO-SERVIDOR:8090`. Para atualizar, envie os arquivos novos e rode `docker compose up -d --build` de novo — os dados do volume são mantidos.

> Sem HTTPS, o botão "minha localização" não funciona (os navegadores só liberam a localização em sites seguros). A busca por CEP funciona normalmente.

## Créditos

- Mapas © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors.
- Pontos de coleta: fontes listadas em cada ponto (`fonte_url`).
