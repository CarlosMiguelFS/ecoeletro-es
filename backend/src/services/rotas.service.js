import { env } from '../config/env.js';
import { buscarJson } from '../utils/http.js';

// Distância DE CARRO, pelas ruas.
// Antes era linha reta e o site jurava que o EcoVix São Pedro ficava a 5,3 km do Jardim Carapina.
// Pela rua são 11,3 km. Só se você fosse de helicóptero.
//
// Quem calcula é o OSRM (grátis, sem chave, em cima do OpenStreetMap), e numa consulta só
// (serviço "table") ele devolve a distância da origem até todos os pontos.

const VALIDADE_CACHE_MS = 60 * 60 * 1000; // 1h
const MAXIMO_CACHE = 2000;
// limite do servidor público: 100 coordenadas por consulta (1 origem + 99 destinos)
export const MAXIMO_DESTINOS = 99;

// a pessoa arrasta o alcance pra lá e pra cá com a mesma origem. Sem cache, o OSRM ia nos odiar
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

// Devolve [{ distanciaKm, duracaoMin }, ...] na mesma ordem dos destinos.
// Destino sem rota (ilha sem ponte, por exemplo) vem null.
// Se o OSRM cair ou estiver desligado, devolve null inteiro e quem chamou se vira com a linha reta.
export async function distanciasDeCarro(origem, destinos) {
  if (!env.roteamentoAtivo) return null;
  if (destinos.length > MAXIMO_DESTINOS)
    throw new Error(`No máximo ${MAXIMO_DESTINOS} destinos por consulta.`);

  const resultado = destinos.map((destino) => lerCache(chaveCache(origem, destino)));
  const faltando = destinos
    .map((destino, i) => ({ destino, i }))
    .filter(({ i }) => resultado[i] === undefined);
  if (faltando.length === 0) return resultado;

  // CUIDADO: o OSRM quer longitude,latitude. O Leaflet quer latitude,longitude.
  // Inverteu? Seu ponto de coleta vai parar no meio do oceano Índico.
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

// só os testes usam isso
export function limparCacheRotas() {
  cache.clear();
}
