# Levantamento do Back-end — EcoEletro ES

Projeto PEI II: um site que ajuda a encontrar pontos de coleta de lixo eletrônico no Espírito Santo.
Este documento lista o que o back-end precisa fazer, quais serviços de mapa gratuitos dá para usar, o modelo de dados, os endpoints da API e os erros que devem aparecer no caminho.

---

## 1. O que o back-end precisa fazer

O front ([frontend/index.html](../frontend/index.html)) já tem três lugares que vão depender do back:

| Elemento no HTML                                | O que precisa do back                                                   |
| ----------------------------------------------- | ----------------------------------------------------------------------- |
| `#cepInput` (campo de CEP)                      | Converter o CEP em coordenadas e devolver os pontos mais próximos       |
| `#containerMapaLista` / `#listaPontos`          | Lista de pontos (cards `.ponto-card` com `.badge`) + marcadores no mapa |
| Botão "Encontre o Ponto de Coleta mais próximo" | Pode usar a geolocalização do navegador (lat/lng) em vez do CEP         |

### Funcionalidades — o essencial (MVP, para a apresentação)

1. **Listar pontos de coleta**, com filtro por município e por tipo de material aceito.
2. **Buscar pontos próximos por CEP**: CEP → coordenadas → pontos ordenados por distância.
3. **Buscar pontos próximos por localização** (lat/lng vindas do navegador).
4. **Detalhe de um ponto**: endereço, horário, telefone, materiais aceitos, link "Como chegar".
5. **Listar categorias de materiais** (celulares, pilhas, computadores…).

### Funcionalidades — segunda fase

6. **Painel administrativo** com login, para cadastrar, editar e desativar pontos.
7. **Sugestões dos visitantes**: sugerir um ponto novo, avisar que um ponto fechou, corrigir um endereço.
8. **Estatísticas** (pontos por município, materiais mais aceitos), úteis na apresentação.
9. **Importação em lote** de pontos via CSV (para carregar uma lista pronta de uma prefeitura, por exemplo).

---

## 2. Mapas — opções gratuitas

Todas as opções abaixo são gratuitas e **não precisam de cartão de crédito nem de chave de API**, o que o Google Maps exige.

| Necessidade                            | Serviço recomendado                                                                                                                                      | Chave? | Limites e cuidados                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Desenhar o mapa** (front)            | **Leaflet** (biblioteca JS) + tiles do **OpenStreetMap**                                                                                                 | Não    | Obrigatório mostrar "© OpenStreetMap contributors". A política de uso dos tiles do OSM proíbe tráfego pesado; para um trabalho acadêmico, tudo bem.                                                                                                                                                   |
| Alternativa de tiles                   | **OpenFreeMap** (com MapLibre GL) ou **CARTO basemaps** (visual mais limpo)                                                                              | Não    | CARTO é gratuito para uso não comercial.                                                                                                                                                                                                                                                              |
| **CEP → endereço**                     | **ViaCEP** (`viacep.com.br/ws/{cep}/json/`)                                                                                                              | Não    | Não devolve coordenadas. CEP inexistente responde **HTTP 200** com `{"erro": true}`, então é preciso tratar isso.                                                                                                                                                                                     |
| **CEP → endereço** (principal)         | **BrasilAPI CEP v2** (`brasilapi.com.br/api/cep/v2/{cep}`)                                                                                               | Não    | ⚠️ **Testado na prática:** a coordenada que ela devolve é a do **centro da cidade**, não a do CEP (29101-010 → exatamente o centro de Vila Velha). Serve só como fallback.                                                                                                                            |
| **Endereço → coordenadas** (principal) | **Nominatim** (geocodificador do OpenStreetMap)                                                                                                          | Não    | **Máximo de 1 requisição por segundo**, precisa de um `User-Agent` identificando o app e **não pode** ser usado para autocompletar. Chame sempre pelo back-end e guarde o resultado em cache. Às vezes não acha a rua por diferença de grafia ("Vellozo" × "Veloso"); nesse caso, busque pelo bairro. |
| **Distância** entre usuário e ponto    | **OSRM** (`router.project-osrm.org`, serviço _table_) para a distância **de carro pelas ruas**; Haversine (linha reta) só como pré-filtro e como reserva | Não    | ⚠️ **Testado na prática:** a linha reta enganava — 5,3 km "de avião" eram 11,3 km pela rua (Google: 11,1 km). Uma consulta calcula todos os destinos; resultado em cache. Se o OSRM cair, a busca volta para a linha reta e avisa.                                                                    |
| **"Como chegar"**                      | Link para o Google Maps ou o Waze com o destino                                                                                                          | Não    | `https://www.google.com/maps/dir/?api=1&destination=LAT,LNG` abre a rota no app do usuário, sem API e sem custo.                                                                                                                                                                                      |

### Fluxo recomendado da busca por CEP

```
Usuário digita CEP
   │
   ▼
Front: GET /api/pontos/proximos?cep=29101-010
   │
   ▼
Back: CEP fora de 29000-000..29999-999? ── sim ──► erro CEP_FORA_DO_ES (sem chamar nada)
   │ não
   ▼
CEP está na tabela cep_cache (< 90 dias)? ── sim ──► usa lat/lng salvas
   │ não
   ▼
Endereço: BrasilAPI v2 → se falhar, ViaCEP ── nenhum achou ──► CEP_NAO_ENCONTRADO
   │
   ▼
Coordenadas, da mais precisa para a menos precisa:
   1. Nominatim pela rua            → precisao "endereco"
   2. Nominatim pelo bairro         → precisao "bairro"
   3. Coordenada da BrasilAPI       → precisao "municipio"
   4. Centro do município (tabela)  → precisao "municipio"
   5. Nominatim pela cidade         → precisao "municipio"
   │
   ▼
Salva no cache → calcula a distância até cada ponto → ordena → devolve os N mais próximos
(o front mostra "localização aproximada" quando a precisão é bairro ou município)
```

**Regra importante:** as coordenadas dos **pontos de coleta** são geocodificadas **uma única vez, no cadastro**, e ficam salvas no banco. Nunca geocodifique os pontos a cada busca.

---

## 3. Stack sugerida

| Camada                | Recomendação                                                   | Por quê                                                                |
| --------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Linguagem / framework | **Node.js + Express**                                          | Mesma linguagem (JavaScript) do front, com muito material em português |
| Banco de dados        | **PostgreSQL** (plano gratuito do **Supabase** ou do **Neon**) | Grátis, na nuvem, e aceita a extensão **PostGIS** se precisar          |
| ORM / consultas       | **Prisma** ou `pg` puro                                        | Prisma gera as migrations e facilita o seed                            |
| Validação             | **Zod**                                                        | Valida CEP, lat/lng e corpo das requisições                            |
| Autenticação (admin)  | **JWT** + senha com **bcrypt**                                 | Simples e suficiente                                                   |
| Hospedagem da API     | **Render** ou **Railway** (plano gratuito)                     | Deploy direto do GitHub                                                |
| Hospedagem do front   | **GitHub Pages**, **Netlify** ou **Vercel**                    | Site estático, grátis                                                  |

> Alternativa mais simples: **SQLite** + Haversine. Funciona bem localmente para a apresentação, mas é pior para colocar em produção.

---

## 4. Modelo de dados

```
municipios (1) ──< pontos_coleta >──< ponto_categoria >── (N) categorias
                        │
                        └──< sugestoes
usuarios_admin
cep_cache
```

### `pontos_coleta`

| Campo                      | Tipo          | Observação                                                  |
| -------------------------- | ------------- | ----------------------------------------------------------- |
| id                         | serial / uuid | PK                                                          |
| nome                       | text          | "Ecoponto Jardim Camburi"                                   |
| tipo                       | enum          | `ecoponto`, `loja_parceira`, `cooperativa`, `orgao_publico` |
| logradouro, numero, bairro | text          |                                                             |
| cep                        | char(8)       | só números                                                  |
| municipio_id               | FK            |                                                             |
| latitude, longitude        | numeric(9,6)  | **obrigatórias**, preenchidas no cadastro                   |
| telefone, email, site      | text          | opcionais                                                   |
| horario                    | jsonb         | `{"seg":"08:00-17:00","sab":"08:00-12:00"}`                 |
| observacoes                | text          | "Aceita apenas até 5 itens por pessoa"                      |
| ativo                      | boolean       | para desativar sem apagar                                   |
| verificado_em              | date          | data da última confirmação de que o ponto funciona          |
| created_at, updated_at     | timestamp     |                                                             |

### `categorias`

`id`, `nome` ("Pilhas e baterias"), `slug` (`pilhas-baterias`), `icone`, `descricao`.

Sugestão inicial: celulares e tablets · computadores e notebooks · pilhas e baterias · lâmpadas · cabos e carregadores · eletrodomésticos pequenos · eletrodomésticos grandes · TVs e monitores.

### `ponto_categoria`

`ponto_id`, `categoria_id` (PK composta).

### `municipios`

`id`, `nome`, `latitude_centro`, `longitude_centro`. O seed traz 32 municípios (os maiores do ES), e o centro de cada um serve de fallback na busca por CEP. Quando um ponto é cadastrado num município que ainda não está na tabela, ele é criado automaticamente com o centro descoberto pelo Nominatim.

### `sugestoes`

`id`, `ponto_id` (pode ser nulo), `tipo` (`novo_ponto` / `correcao` / `ponto_fechado`), `mensagem`, `email_contato` (opcional), `status` (`pendente` / `aprovada` / `rejeitada`), `created_at`.

### `cep_cache`

`cep` (PK), `logradouro`, `bairro`, `cidade`, `uf`, `latitude`, `longitude`, `fonte` (`nominatim` / `nominatim_bairro` / `brasilapi` / `centro_municipio` / `nominatim_cidade`), `atualizado_em`.

### `usuarios_admin`

`id`, `nome`, `email` (único), `senha_hash`, `papel` (`admin` / `editor`), `created_at`.

---

## 5. Endpoints da API

### Públicos

| Método | Rota                   | Descrição                                                                                           |
| ------ | ---------------------- | --------------------------------------------------------------------------------------------------- |
| GET    | `/api/pontos`          | Lista paginada. Filtros: `municipio`, `categoria`, `tipo`, `page`, `limit`                          |
| GET    | `/api/pontos/proximos` | `?cep=29101010` **ou** `?lat=-20.31&lng=-40.29`, com `&raio=10&limite=10&categoria=pilhas-baterias` |
| GET    | `/api/pontos/:id`      | Detalhe de um ponto                                                                                 |
| GET    | `/api/categorias`      | Lista de materiais                                                                                  |
| GET    | `/api/municipios`      | Municípios que têm pontos cadastrados                                                               |
| GET    | `/api/cep/:cep`        | Endereço + coordenadas (proxy com cache das APIs externas)                                          |
| POST   | `/api/sugestoes`       | Visitante envia uma sugestão ou correção                                                            |
| GET    | `/api/estatisticas`    | Totais para gráficos                                                                                |

### Administrativos (exigem JWT)

| Método | Rota                         | Descrição                                              |
| ------ | ---------------------------- | ------------------------------------------------------ |
| POST   | `/api/auth/login`            | Retorna o token                                        |
| POST   | `/api/admin/pontos`          | Cria um ponto (geocodifica o endereço automaticamente) |
| PUT    | `/api/admin/pontos/:id`      | Edita                                                  |
| DELETE | `/api/admin/pontos/:id`      | Desativa (`ativo = false`)                             |
| POST   | `/api/admin/pontos/importar` | Upload de CSV                                          |
| GET    | `/api/admin/sugestoes`       | Lista as pendentes                                     |
| PATCH  | `/api/admin/sugestoes/:id`   | Aprova ou rejeita                                      |

### Exemplo de resposta — `GET /api/pontos/proximos?cep=29101010&limite=2`

```json
{
  "origem": {
    "cep": "29101010",
    "cidade": "Vila Velha",
    "bairro": "Praia da Costa",
    "latitude": -20.335,
    "longitude": -40.2824,
    "fonte": "nominatim_bairro",
    "precisao": "bairro"
  },
  "raio_km": 10,
  "fora_do_raio": false,
  "total": 2,
  "pontos": [
    {
      "id": 3,
      "nome": "Ecoponto Praia da Costa",
      "tipo": "ecoponto",
      "endereco": "Av. Antônio Gil Veloso, 1200 - Praia da Costa, Vila Velha",
      "distancia_km": 0.4,
      "latitude": -20.3345,
      "longitude": -40.286,
      "categorias": ["celulares-tablets", "pilhas-baterias", "cabos-carregadores"],
      "horario": { "seg-sex": "08:00-18:00", "sab": "08:00-12:00" },
      "como_chegar": "https://www.google.com/maps/dir/?api=1&destination=-20.3345,-40.2860"
    }
  ]
}
```

Padrão de erro (o mesmo para todas as rotas):

```json
{ "erro": { "codigo": "CEP_FORA_DO_ES", "mensagem": "Este CEP não pertence ao Espírito Santo." } }
```

---

## 6. Regras de negócio e validações

- **CEP**: aceitar `29101-010` ou `29101010` e normalizar para 8 dígitos.
- **CEP do ES**: vai de **29000-000 a 29999-999**. Fora dessa faixa, retornar `CEP_FORA_DO_ES` sem chamar nenhuma API externa.
- **Coordenadas do ES**: latitude entre −21,35 e −17,85; longitude entre −41,90 e −39,60. Recusar pontos cadastrados fora dessa área (costuma ser erro de geocodificação).
- **Raio**: padrão de **12 km**, máximo de 100 km. Todos os pontos dentro do raio são devolvidos (limite técnico de 100).
- Se nenhum ponto cair no raio, devolver **só o mais próximo**, a qualquer distância (40, 50, 100 km…), com `"fora_do_raio": true`. O usuário nunca fica sem resposta.
- Buscas públicas devolvem só pontos com `ativo = true`.

---

## 7. Erros que vão aparecer (e como evitar)

| #   | Problema                                                                | Causa                                                                            | Solução                                                                                                      |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| 1   | **`fetch` bloqueado por CORS** ao abrir o `index.html` com dois cliques | Aberto como `file://`, a página tem origem `null`                                | Servir o front por HTTP (extensão **Live Server** do VS Code) e liberar a origem no back com o pacote `cors` |
| 2   | ViaCEP "funciona", mas os dados vêm vazios                              | CEP inexistente responde **200** com `{"erro": true}`                            | Verificar `data.erro` antes de usar o resultado                                                              |
| 3   | CEP sem coordenada precisa                                              | A BrasilAPI v2 às vezes não traz `location` e, quando traz, é o centro da cidade | Seguir a cadeia de fallback da seção 2 e mostrar a precisão para o usuário                                   |
| 4   | Nominatim responde **403/429** ou é bloqueado                           | Mais de 1 req/s, falta de `User-Agent` ou uso para autocompletar                 | Chamar só pelo back, com fila de 1 req/s, `User-Agent: EcoEletroES/1.0 (email)` e cache                      |
| 5   | Mapa aparece cinza ou cortado                                           | O Leaflet foi iniciado com a div escondida ou sem altura                         | Dar `height` fixa à div e chamar `map.invalidateSize()` depois de mostrá-la                                  |
| 6   | Marcadores caem no oceano ou em outro estado                            | Latitude e longitude invertidas                                                  | Padronizar: o Leaflet usa `[lat, lng]`, e o GeoJSON/PostGIS usa `[lng, lat]`                                 |
| 7   | Chave, senha ou URL do banco exposta no GitHub                          | Credenciais escritas direto no código                                            | Usar arquivo `.env` + `.gitignore` e deixar só um `.env.example` no repositório                              |
| 8   | Front chama `localhost:3000` depois do deploy                           | URL da API fixa no código                                                        | Uma constante `API_URL` por ambiente                                                                         |
| 9   | API do Render "demora" no primeiro acesso                               | O plano gratuito hiberna após inatividade                                        | Abrir a API alguns minutos antes da apresentação                                                             |
| 10  | _Mixed content_                                                         | Front em HTTPS chamando a API em HTTP                                            | Usar HTTPS nos dois (Render e Netlify já entregam HTTPS)                                                     |
| 11  | Busca a cada tecla digitada                                             | Evento `input` sem controle                                                      | Buscar só com 8 dígitos completos, ou usar _debounce_ de 400 ms                                              |
| 12  | Pontos duplicados                                                       | Importação de CSV repetida                                                       | Criar um índice único em (`nome`, `cep`, `numero`)                                                           |
| 13  | CSV do Excel "quebra" as colunas                                        | O Excel em português usa `;` como separador e `,` como decimal (`-20,329`)       | Detectar o separador pelo cabeçalho e trocar a vírgula decimal por ponto                                     |

---

## 8. Requisitos não funcionais

- **Segurança**: _rate limit_ nas rotas públicas (`express-rate-limit`), `helmet`, senhas com bcrypt e JWT com prazo de expiração.
- **LGPD**: o formulário de sugestões pede e-mail só de forma opcional, com um aviso de uso. Não guardar a localização do visitante.
- **Desempenho**: índice em `latitude, longitude` (ou índice GIST no PostGIS) e cache do CEP.
- **Timeouts**: 5 s para cada API externa. Se falhar, seguir para o próximo fallback.
- **Logs**: registrar erros das APIs externas para saber quando uma delas cair.
- **Documentação**: Swagger/OpenAPI em `/api/docs` (conta pontos na apresentação).

---

## 9. Estrutura de pastas do back (implementada)

```
backend/
├── src/
│   ├── servidor.js            # sobe o Express (local e Docker)
│   ├── aplicacao.js           # middlewares (helmet, cors, json, rate-limit), rotas e site estático
│   ├── config/                # env.js (lê o .env), db.js (Prisma)
│   ├── routes/                # publicas, pontos, auth, admin — validam a entrada e chamam os services
│   ├── services/              # regras: pontos, cep, geocodificacao, municipios, sugestoes, catalogo, auth, importacao
│   ├── validacao/             # esquemas.js (Zod)
│   ├── middlewares/           # auth.js, erro.js, validar.js
│   ├── utils/                 # cep.js, geo.js (Haversine), texto.js, http.js, erros.js
│   └── docs/openapi.json      # Swagger em /api/docs
├── prisma/                    # schema.prisma + seed.js
├── seed/                      # pontos-ficticios.json, municipios-es.json, exemplo-importacao.csv
├── tests/                     # utils.test.js, api.test.js (node --test + supertest)
├── .env.example
└── package.json
```

As camadas `controllers/` e `repositories/` ficaram de fora: com o Prisma, cada service já acessa o banco direto, e as rotas são curtas o bastante para fazer o papel dos controllers.

---

## 10. Roteiro de desenvolvimento

| Fase  | Entrega                                                                | Situação                                                                                                    |
| ----- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **1** | Express + banco + seed + `GET /api/pontos` e `/api/categorias`         | ✅ Feito — o front lista os pontos fictícios nos cards e no mapa                                            |
| **2** | `GET /api/cep/:cep` + `GET /api/pontos/proximos` com cache e fallbacks | ✅ Feito — testado com CEPs reais de Vitória e Vila Velha                                                   |
| **3** | Login + API administrativa com geocodificação automática               | ✅ API feita — ⏳ falta a **tela** do painel admin (hoje use o Swagger em `/api/docs`)                      |
| **4** | Sugestões, estatísticas, Swagger e deploy                              | ✅ Sugestões, estatísticas e Swagger feitos — ⏳ falta o **formulário** de sugestões no site e o **deploy** |

Dados fictícios para a fase 1: [backend/seed/pontos-ficticios.json](../backend/seed/pontos-ficticios.json).
