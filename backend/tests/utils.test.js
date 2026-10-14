import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cepEhDoES, formatarCep, normalizarCep } from '../src/utils/cep.js';
import { dentroDoES, distanciaKm, linkComoChegar } from '../src/utils/geo.js';
import { normalizarTexto } from '../src/utils/texto.js';

describe('CEP', () => {
  it('normaliza formatos comuns', () => {
    assert.equal(normalizarCep('29101-010'), '29101010');
    assert.equal(normalizarCep('29.101-010'), '29101010');
    assert.equal(normalizarCep('29101010'), '29101010');
  });

  it('rejeita CEP incompleto', () => {
    assert.equal(normalizarCep('2910101'), null);
    assert.equal(normalizarCep(''), null);
    assert.equal(normalizarCep(undefined), null);
  });

  it('reconhece a faixa do ES', () => {
    assert.equal(cepEhDoES('29000000'), true);
    assert.equal(cepEhDoES('29999999'), true);
    assert.equal(cepEhDoES('01001000'), false);
    assert.equal(cepEhDoES('30000000'), false);
  });

  it('formata com hífen', () => {
    assert.equal(formatarCep('29101010'), '29101-010');
  });
});

describe('Geo', () => {
  it('calcula a distância Vitória → Vila Velha (poucos km)', () => {
    const km = distanciaKm(-20.3155, -40.3128, -20.3297, -40.2925);
    assert.ok(km > 2 && km < 4, `esperado entre 2 e 4 km, veio ${km}`);
  });

  it('distância de um ponto para ele mesmo é zero', () => {
    assert.equal(distanciaKm(-20.3, -40.3, -20.3, -40.3), 0);
  });

  it('sabe o que está dentro do ES', () => {
    assert.equal(dentroDoES(-20.3155, -40.3128), true); // Vitória
    assert.equal(dentroDoES(-23.5505, -46.6333), false); // São Paulo
    assert.equal(dentroDoES(-40.3128, -20.3155), false); // lat/lng invertidas
    assert.equal(dentroDoES(NaN, -40.3), false);
  });
});

describe('Link "Como chegar"', () => {
  const destino = new URL(linkComoChegar(-18.7155, -39.8596)).searchParams;

  it('sem origem, só tem o destino (o Google usa a localização do aparelho)', () => {
    assert.equal(destino.get('destination'), '-18.7155,-39.8596');
    assert.equal(destino.get('origin'), null);
  });

  it('busca por CEP: a rota parte do endereço do CEP, por escrito', () => {
    const origem = {
      cep: '29945-430',
      logradouro: 'Rua Professor Amaro Nascimento Mendes',
      bairro: 'Guriri Sul',
      cidade: 'São Mateus',
      latitude: -18.7409,
      longitude: -39.7525,
    };
    const link = new URL(linkComoChegar(-18.7155, -39.8596, origem)).searchParams;
    assert.equal(
      link.get('origin'),
      'Rua Professor Amaro Nascimento Mendes, Guriri Sul, São Mateus - ES, 29945-430',
    );
  });

  it('CEP sem rua (CEP geral da cidade): usa o que tiver', () => {
    const link = new URL(
      linkComoChegar(-18.7, -39.8, { cep: '29930-000', cidade: 'São Mateus', latitude: 1, longitude: 2 }),
    ).searchParams;
    assert.equal(link.get('origin'), 'São Mateus - ES, 29930-000');
  });
});

describe('Texto', () => {
  it('ignora acento e maiúscula', () => {
    assert.equal(normalizarTexto(' Vitória '), 'vitoria');
    assert.equal(normalizarTexto('IÚNA'), 'iuna');
  });
});
