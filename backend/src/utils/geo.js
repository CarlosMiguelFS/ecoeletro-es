// o raio da Terra inteira, só pra saber quantos km faltam até o ecoponto
const RAIO_TERRA_KM = 6371;

// um retângulo em volta do ES. Se o geocodificador jurar que a rua fica em Minas, a gente não acredita
const LIMITES_ES = { latMin: -21.35, latMax: -17.85, lngMin: -41.9, lngMax: -39.6 };

const emRadianos = (graus) => (graus * Math.PI) / 180;

// Haversine = distância em linha reta, "de avião".
// Hoje só serve de pré-filtro e de plano B: a distância que aparece na tela é a de carro (OSRM).
export function distanciaKm(lat1, lng1, lat2, lng2) {
  const dLat = emRadianos(lat2 - lat1);
  const dLng = emRadianos(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(emRadianos(lat1)) * Math.cos(emRadianos(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * RAIO_TERRA_KM * Math.asin(Math.sqrt(a));
}

export function dentroDoES(latitude, longitude) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= LIMITES_ES.latMin &&
    latitude <= LIMITES_ES.latMax &&
    longitude >= LIMITES_ES.lngMin &&
    longitude <= LIMITES_ES.lngMax
  );
}

// Link do Google Maps, de graça e sem API.
// Sem origem, o Google sai da localização do celular. Foi assim que alguém buscou um CEP
// de Guriri estando em Vitória e ganhou a rota Vitória → São Mateus. Agora a gente manda a origem.
export function linkComoChegar(latitude, longitude, origem) {
  const parametros = new URLSearchParams({ api: '1', destination: `${latitude},${longitude}` });
  if (origem) parametros.set('origin', descreverOrigem(origem));
  return `https://www.google.com/maps/dir/?${parametros}`;
}

// Buscou por CEP? Vai o endereço por escrito ("Rua X, Bairro, Cidade - ES, 29945-430"),
// que o Google mostra bonitinho como partida. Buscou pelo GPS? Vão as coordenadas mesmo.
function descreverOrigem(origem) {
  if (!origem.cep) return `${origem.latitude},${origem.longitude}`;
  const local = [origem.logradouro, origem.bairro, origem.cidade && `${origem.cidade} - ES`];
  return [...local.filter(Boolean), origem.cep].join(', ');
}
