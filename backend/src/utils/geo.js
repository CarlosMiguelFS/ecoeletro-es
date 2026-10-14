const RAIO_TERRA_KM = 6371;

// Retângulo que envolve o Espírito Santo (continente). Serve para descartar geocodificações erradas.
const LIMITES_ES = { latMin: -21.35, latMax: -17.85, lngMin: -41.9, lngMax: -39.6 };

const emRadianos = (graus) => (graus * Math.PI) / 180;

/** Distância em km entre dois pontos (fórmula de Haversine). */
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

/**
 * Link que abre a rota no Google Maps, sem API e sem custo.
 * Com origem, a rota parte do CEP buscado; sem origem, o Google usa a localização atual do aparelho
 * (que pode ser outra cidade: quem busca o CEP de Guriri estando em Vitória receberia a rota de Vitória).
 */
export function linkComoChegar(latitude, longitude, origem) {
  const parametros = new URLSearchParams({ api: '1', destination: `${latitude},${longitude}` });
  if (origem) parametros.set('origin', `${origem.latitude},${origem.longitude}`);
  return `https://www.google.com/maps/dir/?${parametros}`;
}
