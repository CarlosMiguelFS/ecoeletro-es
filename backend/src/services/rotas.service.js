import { env } from '../config/env.js';
import { buscarJson } from '../utils/http.js';

// Distância de carro pelas ruas, via OSRM (roteador gratuito sobre o OpenStreetMap, sem chave).
// Uma única requisição (serviço "table") calcula da origem até todos os destinos.

const VALIDADE_CACHE_MS = 60 * 60 * 1000;
const MAXIMO_CACHE = 2000;
// O servidor público do OSRM aceita no máximo 100 coordenadas por consulta (origem + 99 destinos).
export const MAXIMO_DESTINOS = 99;

// Mexer no seletor de alcance refaz a busca com a mesma origem: o cache evita consultar o OSRM de novo.
const cache = new Map();

const chaveCache = (origem, destino) =>
  `${origem.latitude.toFixed(5)},${origem.longitude.toFixed(5)}|${destino.latitude},${destino.longitude}`;

function lerCache(chave) {
  const item = cache.get(chave);
  if (!item || Date.now() - item.em > VALIDADE_CACHE_MS) return undefined;
  return item.valor;
}

function salvarCache(chave, valor) {
  if (cache.size >= MAXIMO_CACHE) cache.delete(cache.keys().next().value); // descarta o mais antigo
  cache.set(chave, { valor, em: Date.now() });
}

/**
 * Distância (km) e tempo (min) de carro da origem até cada destino, na mesma ordem dos destinos.
 * Um destino sem rota (ex.: ilha sem ponte) vem como null.
 * Retorna null inteiro se o roteamento estiver desligado ou o OSRM falhar: quem chama usa a linha reta.
 */
export async function distanciasDeCarro(origem, destinos) {
  if (!env.roteamentoAtivo) return null;
  if (destinos.length > MAXIMO_DESTINOS)
    throw new Error(`No máximo ${MAXIMO_DESTINOS} destinos por consulta.`);

  const resultado = destinos.map((destino) => lerCache(chaveCache(origem, destino)));
  const faltando = destinos
    .map((destino, i) => ({ destino, i }))
    .filter(({ i }) => resultado[i] === undefined);
  if (faltando.length === 0) return resultado;

  // Atenção: o OSRM usa longitude,latitude (ao contrário do Leaflet).
  const coordenadas = [origem, ...faltando.map((f) => f.destino)]
    .map((p) => `${p.longitude},${p.latitude}`)
    .join(';');
  const url = `${env.osrmUrl}/table/v1/driving/${coordenadas}?sources=0&annotations=distance,duration`;

  try {
    const { ok, corpo } = await buscarJson(url, { headers: { 'User-Agent': env.nominatimUserAgent } });
    if (!ok || corpo?.code !== 'Ok') {
      console.warn('[osrm] resposta inesperada:', corpo?.code ?? 'sem corpo');
      return null;
    }
    faltando.forEach(({ destino, i }, k) => {
      const metros = corpo.distances[0][k + 1];
      const segundos = corpo.durations[0][k + 1];
      const valor =
        metros === null || metros === undefined
          ? null
          : { distanciaKm: metros / 1000, duracaoMin: Math.max(1, Math.round(segundos / 60)) };
      resultado[i] = valor;
      salvarCache(chaveCache(origem, destino), valor);
    });
    return resultado;
  } catch (erro) {
    console.warn('[osrm] falha:', erro.message);
    return null;
  }
}

/** Só para os testes. */
export function limparCacheRotas() {
  cache.clear();
}
