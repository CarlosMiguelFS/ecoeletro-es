// URL da API.
// null = automático: usa o mesmo endereço do site quando ele é servido pela API (http://localhost:3000)
// e http://localhost:3000/api quando aberto pelo Live Server ou com dois cliques.
// Em produção, com front e API em domínios diferentes, coloque a URL da API, ex.:
//   apiUrl: 'https://ecoeletro-es-api.onrender.com/api'
window.ECOELETRO_CONFIG = {
  apiUrl: null,
};

// Posiciona os tiles do mapa em pixels inteiros (sem transform 3D). Evita linhas brancas entre os
// tiles em telas com zoom de 125%/150%. Precisa ser definido ANTES de carregar o Leaflet.
window.L_DISABLE_3D = true;
