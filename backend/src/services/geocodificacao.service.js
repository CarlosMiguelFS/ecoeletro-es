import { env } from '../config/env.js';
import { buscarJson } from '../utils/http.js';
import { dentroDoES } from '../utils/geo.js';

// Política do Nominatim: no máximo 1 requisição por segundo, com User-Agent identificando o app.
// Todas as chamadas passam por esta fila, então nunca há duas ao mesmo tempo.
const INTERVALO_MS = 1100;
let fila = Promise.resolve();
let ultimaChamada = 0;

function naFila(tarefa) {
  const execucao = fila.then(async () => {
    const espera = ultimaChamada + INTERVALO_MS - Date.now();
    if (espera > 0) await new Promise((resolver) => setTimeout(resolver, espera));
    try {
      return await tarefa();
    } finally {
      ultimaChamada = Date.now();
    }
  });
  fila = execucao.catch(() => {});
  return execucao;
}

/**
 * Endereço → { latitude, longitude } pelo Nominatim (OpenStreetMap).
 * Com logradouro, faz busca estruturada; só com bairro, busca livre "bairro, cidade" (a estruturada não tem bairro).
 * Retorna null se não achar, se o resultado cair fora do ES ou se o serviço falhar — nunca lança erro.
 */
export async function geocodificar({ logradouro, numero, bairro, cidade }) {
  const parametros = new URLSearchParams({ format: 'jsonv2', limit: '1', countrycodes: 'br' });
  if (!logradouro && bairro) {
    parametros.set('q', [bairro, cidade, 'Espírito Santo', 'Brasil'].filter(Boolean).join(', '));
  } else {
    parametros.set('state', 'Espírito Santo');
    parametros.set('country', 'Brasil');
    if (logradouro) {
      parametros.set('street', numero && numero !== 'S/N' ? `${numero} ${logradouro}` : logradouro);
    }
    if (cidade) parametros.set('city', cidade);
  }

  try {
    const { ok, corpo } = await naFila(() =>
      buscarJson(`https://nominatim.openstreetmap.org/search?${parametros}`, {
        headers: { 'User-Agent': env.nominatimUserAgent, 'Accept-Language': 'pt-BR' },
      }),
    );
    if (!ok || !Array.isArray(corpo) || corpo.length === 0) return null;

    const latitude = Number(corpo[0].lat);
    const longitude = Number(corpo[0].lon);
    return dentroDoES(latitude, longitude) ? { latitude, longitude } : null;
  } catch (erro) {
    console.warn('[nominatim] falha:', erro.message);
    return null;
  }
}
