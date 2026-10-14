// Testes de integração contra o banco local. Rode antes: npm run db:setup
// Nenhum destes testes chama APIs externas (CEP/Nominatim).
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { criarApp } from '../src/aplicacao.js';
import { prisma } from '../src/config/db.js';

const app = criarApp();
let token;

before(async () => {
  const resposta = await request(app)
    .post('/api/auth/login')
    .send({
      email: process.env.ADMIN_EMAIL || 'admin@ecoeletro.local',
      senha: process.env.ADMIN_SENHA || 'trocar123',
    });
  assert.equal(resposta.status, 200, 'login do admin do seed falhou — rodou npm run db:setup?');
  token = resposta.body.token;
});

after(() => prisma.$disconnect());

describe('Rotas públicas', () => {
  it('GET /api/saude', async () => {
    const r = await request(app).get('/api/saude');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'ok' });
  });

  it('GET /api/pontos lista os pontos do seed', async () => {
    const r = await request(app).get('/api/pontos?limit=50');
    assert.equal(r.status, 200);
    assert.ok(r.body.total >= 10);
    const ponto = r.body.pontos[0];
    for (const campo of ['id', 'nome', 'endereco', 'latitude', 'longitude', 'categorias', 'como_chegar']) {
      assert.ok(campo in ponto, `faltou o campo ${campo}`);
    }
  });

  it('filtra por município sem depender de acento', async () => {
    const r = await request(app).get('/api/pontos?municipio=vitoria');
    assert.equal(r.status, 200);
    assert.ok(r.body.total >= 2);
    assert.ok(r.body.pontos.every((p) => p.municipio === 'Vitória'));
  });

  it('filtra por categoria', async () => {
    const r = await request(app).get('/api/pontos?categoria=eletro-grandes&limit=50');
    assert.equal(r.status, 200);
    assert.ok(r.body.pontos.every((p) => p.categorias.includes('eletro-grandes')));
  });

  it('GET /api/pontos/proximos por coordenada ordena por distância', async () => {
    const r = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=5');
    assert.equal(r.status, 200);
    assert.equal(r.body.fora_do_raio, false);
    assert.equal(r.body.pontos[0].nome, 'Ecoponto Praia da Costa');
    const distancias = r.body.pontos.map((p) => p.distancia_km);
    assert.deepEqual(
      distancias,
      [...distancias].sort((a, b) => a - b),
    );
    assert.ok(distancias.every((d) => d <= 5));
  });

  it('"Como chegar" parte do local buscado, não da localização do aparelho', async () => {
    const r = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29');
    assert.equal(r.status, 200);
    const link = new URL(r.body.pontos[0].como_chegar);
    assert.equal(link.searchParams.get('origin'), '-20.33,-40.29');
    assert.equal(
      link.searchParams.get('destination'),
      `${r.body.pontos[0].latitude},${r.body.pontos[0].longitude}`,
    );
  });

  it('respeita o alcance escolhido no seletor e recusa acima de 100 km', async () => {
    const curto = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=3');
    const longo = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=50');
    assert.equal(curto.body.raio_km, 3);
    assert.equal(longo.body.raio_km, 50);
    assert.ok(curto.body.pontos.every((p) => p.distancia_km <= 3));
    assert.ok(longo.body.total > curto.body.total, 'raio maior deve trazer mais pontos');

    const demais = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=101');
    assert.equal(demais.status, 400);
  });

  it('usa raio padrão de 12 km e traz todos os pontos dentro dele', async () => {
    const r = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29');
    assert.equal(r.status, 200);
    assert.equal(r.body.raio_km, 12);
    assert.ok(r.body.pontos.length >= 2);
    assert.ok(r.body.pontos.every((p) => p.distancia_km <= 12));
  });

  it('sem ponto no raio, devolve só o mais próximo, mesmo longe', async () => {
    // Venda Nova do Imigrante: o ponto mais próximo fica a dezenas de km.
    const r = await request(app).get('/api/pontos/proximos?lat=-20.339&lng=-41.135');
    assert.equal(r.status, 200);
    assert.equal(r.body.fora_do_raio, true);
    assert.equal(r.body.pontos.length, 1);
    assert.ok(r.body.pontos[0].distancia_km > 12);
  });

  it('recusa CEP de fora do ES sem chamar API externa', async () => {
    const r = await request(app).get('/api/pontos/proximos?cep=01001-000');
    assert.equal(r.status, 422);
    assert.equal(r.body.erro.codigo, 'CEP_FORA_DO_ES');
  });

  it('recusa CEP incompleto', async () => {
    const r = await request(app).get('/api/cep/2910');
    assert.equal(r.status, 400);
    assert.equal(r.body.erro.codigo, 'CEP_INVALIDO');
  });

  it('exige cep ou lat/lng', async () => {
    const r = await request(app).get('/api/pontos/proximos');
    assert.equal(r.status, 400);
    assert.equal(r.body.erro.codigo, 'DADOS_INVALIDOS');
  });

  it('recusa coordenada fora do ES', async () => {
    const r = await request(app).get('/api/pontos/proximos?lat=-23.55&lng=-46.63');
    assert.equal(r.status, 422);
    assert.equal(r.body.erro.codigo, 'FORA_DO_ES');
  });

  it('GET /api/pontos/:id inexistente → 404', async () => {
    const r = await request(app).get('/api/pontos/999999');
    assert.equal(r.status, 404);
    assert.equal(r.body.erro.codigo, 'PONTO_NAO_ENCONTRADO');
  });

  it('GET /api/categorias e /api/municipios', async () => {
    const categorias = await request(app).get('/api/categorias');
    assert.equal(categorias.status, 200);
    assert.equal(categorias.body.length, 8);

    const municipios = await request(app).get('/api/municipios');
    assert.equal(municipios.status, 200);
    assert.ok(municipios.body.every((m) => m.total_pontos > 0));
  });

  it('GET /api/estatisticas', async () => {
    const r = await request(app).get('/api/estatisticas');
    assert.equal(r.status, 200);
    assert.ok(r.body.total_pontos >= 10);
    assert.ok(Array.isArray(r.body.por_municipio));
  });

  it('POST /api/sugestoes valida os dados', async () => {
    const r = await request(app).post('/api/sugestoes').send({ tipo: 'correcao', mensagem: 'curta' });
    assert.equal(r.status, 400);
    const campos = r.body.erro.detalhes.map((d) => d.campo);
    assert.ok(campos.includes('mensagem'));
  });

  it('POST /api/sugestoes exige consentimento quando há e-mail', async () => {
    const r = await request(app).post('/api/sugestoes').send({
      tipo: 'novo_ponto',
      mensagem: 'Tem um ponto novo no shopping do bairro.',
      email_contato: 'visitante@exemplo.com',
    });
    assert.equal(r.status, 400);
    assert.ok(r.body.erro.detalhes.some((d) => d.campo === 'consentimento'));
  });

  it('envia Referer para os tiles do OpenStreetMap (senão dá 403)', async () => {
    const r = await request(app).get('/');
    assert.equal(r.status, 200);
    assert.equal(r.headers['referrer-policy'], 'strict-origin-when-cross-origin');
  });

  it('serve a documentação (Swagger por CDN) e o OpenAPI', async () => {
    const pagina = await request(app).get('/api/docs');
    assert.equal(pagina.status, 200);
    assert.match(pagina.text, /swagger-ui-bundle\.js/);

    const spec = await request(app).get('/api/openapi.json');
    assert.equal(spec.status, 200);
    assert.ok(spec.body.paths['/pontos/proximos']);
  });

  it('o index.js exporta o app para o Vercel', async () => {
    const { default: appVercel } = await import('../index.js');
    const r = await request(appVercel).get('/api/saude');
    assert.equal(r.status, 200);
  });

  it('rota inexistente → 404 no formato padrão', async () => {
    const r = await request(app).get('/api/nao-existe');
    assert.equal(r.status, 404);
    assert.equal(r.body.erro.codigo, 'ROTA_NAO_ENCONTRADA');
  });
});

describe('Autenticação e admin', () => {
  it('login com senha errada → 401', async () => {
    const r = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@ecoeletro.local', senha: 'errada' });
    assert.equal(r.status, 401);
  });

  it('admin sem token → 401', async () => {
    const r = await request(app).get('/api/admin/pontos');
    assert.equal(r.status, 401);
    assert.equal(r.body.erro.codigo, 'NAO_AUTENTICADO');
  });

  it('admin com token inválido → 401', async () => {
    const r = await request(app).get('/api/admin/pontos').set('Authorization', 'Bearer xyz');
    assert.equal(r.status, 401);
    assert.equal(r.body.erro.codigo, 'TOKEN_INVALIDO');
  });

  it('cria, edita e desativa um ponto (com coordenadas, sem geocodificação)', async () => {
    const auth = { Authorization: `Bearer ${token}` };
    const dados = {
      nome: 'Ponto de Teste Automatizado',
      tipo: 'ecoponto',
      logradouro: 'Rua de Teste',
      numero: '1',
      bairro: 'Centro',
      cep: '29010-000',
      municipio: 'vitória',
      latitude: -20.32,
      longitude: -40.34,
      categorias: ['pilhas-baterias'],
    };

    // Limpa resto de uma execução anterior que tenha falhado no meio.
    await prisma.pontoColeta.deleteMany({ where: { nome: dados.nome } });

    const criado = await request(app).post('/api/admin/pontos').set(auth).send(dados);
    assert.equal(criado.status, 201, JSON.stringify(criado.body));
    assert.equal(criado.body.municipio, 'Vitória');

    const duplicado = await request(app).post('/api/admin/pontos').set(auth).send(dados);
    assert.equal(duplicado.status, 409);

    const editado = await request(app)
      .put(`/api/admin/pontos/${criado.body.id}`)
      .set(auth)
      .send({ ...dados, categorias: ['lampadas', 'pilhas-baterias'] });
    assert.equal(editado.status, 200);
    assert.deepEqual(editado.body.categorias.sort(), ['lampadas', 'pilhas-baterias']);

    const desativado = await request(app).delete(`/api/admin/pontos/${criado.body.id}`).set(auth);
    assert.equal(desativado.status, 200);

    const publico = await request(app).get(`/api/pontos/${criado.body.id}`);
    assert.equal(publico.status, 404, 'ponto desativado não deve aparecer no público');

    await prisma.pontoColeta.delete({ where: { id: criado.body.id } });
  });

  it('recusa ponto com coordenadas fora do ES', async () => {
    const r = await request(app)
      .post('/api/admin/pontos')
      .set('Authorization', `Bearer ${token}`)
      .send({
        nome: 'Ponto Errado',
        tipo: 'ecoponto',
        logradouro: 'Rua X',
        bairro: 'Centro',
        cep: '29010000',
        municipio: 'Vitória',
        latitude: -40.34, // invertida com a longitude
        longitude: -20.32,
        categorias: ['pilhas-baterias'],
      });
    assert.equal(r.status, 422);
    assert.equal(r.body.erro.codigo, 'COORDENADAS_FORA_DO_ES');
  });

  it('importa o CSV de exemplo', async () => {
    const r = await request(app)
      .post('/api/admin/pontos/importar')
      .set('Authorization', `Bearer ${token}`)
      .attach('arquivo', 'seed/exemplo-importacao.csv');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.total_linhas, 2);
    assert.deepEqual(r.body.erros, []);
    assert.equal(r.body.criados + r.body.atualizados, 2);

    await prisma.pontoColeta.deleteMany({ where: { nome: { contains: '(fictíci' } } });
  });

  it('lista sugestões', async () => {
    const r = await request(app)
      .get('/api/admin/sugestoes?status=pendente')
      .set('Authorization', `Bearer ${token}`);
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body));
  });
});
