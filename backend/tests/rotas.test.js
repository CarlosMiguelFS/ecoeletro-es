// Distância de carro (OSRM) com o serviço SIMULADO: nada sai para a internet.
// O OSRM falso devolve rotas com o dobro da linha reta, como se as ruas dessem voltas.
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';
import request from 'supertest';
import { criarApp } from '../src/aplicacao.js';
import { prisma } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { limparCacheRotas } from '../src/services/rotas.service.js';
import { distanciaKm } from '../src/utils/geo.js';

const app = criarApp();
const fetchOriginal = globalThis.fetch;
let urlsOsrm = [];

function osrmFalso(fator) {
  return async (url) => {
    urlsOsrm.push(url);
    // /table/v1/driving/lng,lat;lng,lat;...?...
    const pares = decodeURIComponent(new URL(url).pathname.split('/driving/')[1])
      .split(';')
      .map((par) => par.split(',').map(Number));
    const [lngO, latO] = pares[0];
    const metros = pares.map(([lng, lat]) => distanciaKm(latO, lngO, lat, lng) * fator * 1000);
    return Response.json({ code: 'Ok', distances: [metros], durations: [metros.map((m) => m / 10)] });
  };
}

before(() => {
  env.roteamentoAtivo = true;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  urlsOsrm = [];
  limparCacheRotas();
});

after(async () => {
  env.roteamentoAtivo = false;
  await prisma.$disconnect();
});

describe('Distância de carro (OSRM simulado)', () => {
  it('mostra e filtra pela distância de carro, não pela linha reta', async () => {
    globalThis.fetch = osrmFalso(2);
    const r = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=8');
    assert.equal(r.status, 200);
    assert.equal(r.body.distancia_tipo, 'carro');
    assert.ok(r.body.pontos.length > 0);
    for (const p of r.body.pontos) {
      assert.equal(p.distancia_tipo, 'carro');
      assert.ok(p.distancia_km <= 8, `${p.nome}: ${p.distancia_km} km de carro passa do alcance`);
      assert.ok(Math.abs(p.distancia_km - p.distancia_reta_km * 2) <= 0.2, 'distância deve ser a do OSRM');
      assert.ok(p.duracao_min >= 1);
    }

    // Com linha reta, o mesmo alcance traria mais pontos (os que ficam longe pela rua saem).
    env.roteamentoAtivo = false;
    const reta = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=8');
    env.roteamentoAtivo = true;
    assert.ok(reta.body.total > r.body.total);
  });

  it('manda as coordenadas ao OSRM como longitude,latitude e faz uma consulta só', async () => {
    globalThis.fetch = osrmFalso(2);
    await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=12');
    assert.equal(urlsOsrm.length, 1);
    assert.match(urlsOsrm[0], /\/driving\/-40\.29,-20\.33;/);
  });

  it('reaproveita as distâncias ao mudar só o alcance (cache)', async () => {
    globalThis.fetch = osrmFalso(2);
    await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=12');
    await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=6');
    assert.equal(urlsOsrm.length, 1);
  });

  it('se o OSRM falhar, volta para a linha reta sem quebrar a busca', async () => {
    globalThis.fetch = async () => {
      throw new Error('sem rede');
    };
    const r = await request(app).get('/api/pontos/proximos?lat=-20.33&lng=-40.29&raio=12');
    assert.equal(r.status, 200);
    assert.equal(r.body.distancia_tipo, 'linha_reta');
    assert.ok(r.body.pontos.every((p) => p.distancia_tipo === 'linha_reta' && p.duracao_min === undefined));
  });

  it('sem ponto no alcance, devolve o mais próximo de carro', async () => {
    globalThis.fetch = osrmFalso(2);
    // Venda Nova do Imigrante: nenhum ponto fictício perto.
    const r = await request(app).get('/api/pontos/proximos?lat=-20.339&lng=-41.135&raio=12');
    assert.equal(r.body.fora_do_raio, true);
    assert.equal(r.body.pontos.length, 1);
    assert.equal(r.body.pontos[0].distancia_tipo, 'carro');
  });
});
