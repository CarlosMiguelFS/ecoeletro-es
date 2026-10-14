(() => {
  const API_URL = (() => {
    const configurada = window.ECOELETRO_CONFIG?.apiUrl;
    if (configurada) return configurada.replace(/\/$/, '');
    const servidoPelaApi = location.protocol.startsWith('http') && location.port === '3000';
    if (servidoPelaApi || !['localhost', '127.0.0.1', ''].includes(location.hostname)) {
      return `${location.origin}/api`;
    }
    return 'http://localhost:3000/api';
  })();

  // Todos os pontos até 12 km; se não houver nenhum, a API devolve só o mais próximo.
  const RAIO_BUSCA_KM = 12;
  const CENTRO_ES = [-19.6, -40.6];

  const ROTULO_TIPO = {
    ecoponto: 'Ecoponto',
    loja_parceira: 'Loja parceira',
    cooperativa: 'Cooperativa',
    orgao_publico: 'Órgão público',
  };

  const el = {
    formCep: document.getElementById('formCep'),
    cep: document.getElementById('cepInput'),
    btnLocalizacao: document.getElementById('btnLocalizacao'),
    filtro: document.getElementById('filtroCategoria'),
    status: document.getElementById('statusBusca'),
    tituloLista: document.getElementById('tituloLista'),
    lista: document.getElementById('listaPontos'),
    secao: document.getElementById('locais'),
    mapa: document.getElementById('mapa'),
  };

  const nomesCategorias = {};
  const marcadores = new Map();
  let ultimaBusca = null; // nada aparece no mapa até a primeira busca

  // ---------- Mapa (Leaflet + OpenStreetMap) ----------

  const mapa = L.map('mapa', { scrollWheelZoom: false }).setView(CENTRO_ES, 7);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(mapa);
  const camadaPontos = L.featureGroup().addTo(mapa);
  const camadaOrigem = L.featureGroup().addTo(mapa);

  const iconePonto = L.divIcon({
    className: 'marcador-ponto',
    html: '<span></span>',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -28],
  });
  const iconeOrigem = L.divIcon({ className: 'marcador-origem', iconSize: [18, 18], iconAnchor: [9, 9] });

  // ---------- Utilidades ----------

  const escapar = (texto) =>
    String(texto ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );

  function mostrarStatus(mensagem, tipo = '') {
    el.status.textContent = mensagem;
    el.status.className = `status-busca ${tipo}`.trim();
  }

  async function chamarApi(caminho) {
    let resposta;
    try {
      resposta = await fetch(`${API_URL}${caminho}`);
    } catch {
      throw new Error('Não foi possível conectar à API. Ela está rodando? (na pasta backend: npm run dev)');
    }
    const corpo = await resposta.json().catch(() => ({}));
    if (!resposta.ok) throw new Error(corpo.erro?.mensagem ?? `Erro ${resposta.status} na API.`);
    return corpo;
  }

  function formatarDistancia(km) {
    if (km < 0.1) return 'menos de 100 m';
    return `${km.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;
  }

  // ---------- Balão do marcador (todos os detalhes ficam aqui) ----------

  function htmlPopup(ponto) {
    const distancia =
      ponto.distancia_km !== undefined
        ? `<p class="popup-distancia">a ${formatarDistancia(ponto.distancia_km)} de você</p>`
        : '';
    const horario = ponto.horario
      ? `<ul class="popup-horario">${Object.entries(ponto.horario)
          .map(([dias, horas]) => `<li><strong>${escapar(dias)}</strong> ${escapar(horas)}</li>`)
          .join('')}</ul>`
      : '';
    const telefone = ponto.telefone
      ? `<p><a href="tel:${escapar(ponto.telefone.replace(/\D/g, ''))}">${escapar(ponto.telefone)}</a></p>`
      : '';
    const observacoes = ponto.observacoes ? `<p class="popup-obs">${escapar(ponto.observacoes)}</p>` : '';
    const fonte = ponto.fonte_url
      ? `<p class="popup-fonte"><a href="${escapar(ponto.fonte_url)}" target="_blank" rel="noopener">Fonte da informação ↗</a></p>`
      : '';
    const materiais = ponto.categorias
      .map((slug) => `<li>${escapar(nomesCategorias[slug] ?? slug)}</li>`)
      .join('');

    return `
      <div class="popup-ponto">
        <span class="badge">${escapar(ROTULO_TIPO[ponto.tipo] ?? ponto.tipo)}</span>
        <h4>${escapar(ponto.nome)}</h4>
        ${distancia}
        <p>${escapar(ponto.endereco)}</p>
        ${horario}
        ${telefone}
        <ul class="popup-materiais" aria-label="Materiais aceitos">${materiais}</ul>
        ${observacoes}
        ${fonte}
        <a class="popup-rota" href="${escapar(ponto.como_chegar)}" target="_blank" rel="noopener">Como chegar ↗</a>
      </div>`;
  }

  // ---------- Lista lateral (compacta) ----------

  function htmlItemLista(ponto) {
    const distancia =
      ponto.distancia_km !== undefined
        ? `<span class="item-distancia">${formatarDistancia(ponto.distancia_km)}</span>`
        : '';
    return `
      <li>
        <button type="button" class="item-ponto" data-id="${ponto.id}">
          <span class="item-topo">
            <span class="item-nome">${escapar(ponto.nome)}</span>
            ${distancia}
          </span>
          <span class="item-detalhe">${escapar(ROTULO_TIPO[ponto.tipo] ?? ponto.tipo)} · ${escapar(ponto.municipio)}</span>
        </button>
      </li>`;
  }

  function marcarItemAtivo(id) {
    el.lista.querySelectorAll('.item-ponto.ativo').forEach((b) => b.classList.remove('ativo'));
    const item = el.lista.querySelector(`[data-id="${id}"]`);
    if (item) {
      item.classList.add('ativo');
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }

  // Sem animação: o balão só consegue se reposicionar (autoPan) depois que o mapa parou.
  function abrirPonto(id, { aproximar = true } = {}) {
    const marcador = marcadores.get(id);
    if (!marcador) return;
    if (aproximar) mapa.setView(marcador.getLatLng(), Math.max(mapa.getZoom(), 15), { animate: false });
    marcador.openPopup();
    marcarItemAtivo(id);
  }

  // ---------- Desenho ----------

  function desenhar(pontos, origem, { mostrarRaio = false } = {}) {
    camadaPontos.clearLayers();
    camadaOrigem.clearLayers();
    marcadores.clear();

    for (const ponto of pontos) {
      const marcador = L.marker([ponto.latitude, ponto.longitude], { icon: iconePonto, title: ponto.nome })
        .bindPopup(htmlPopup(ponto), { maxWidth: 300 })
        .on('click', () => marcarItemAtivo(ponto.id));
      camadaPontos.addLayer(marcador);
      marcadores.set(ponto.id, marcador);
    }

    if (origem) {
      if (mostrarRaio) {
        L.circle([origem.latitude, origem.longitude], {
          radius: RAIO_BUSCA_KM * 1000,
          className: 'raio-busca',
          interactive: false,
        }).addTo(camadaOrigem);
      }
      L.marker([origem.latitude, origem.longitude], { icon: iconeOrigem, title: 'Você', zIndexOffset: 1000 })
        .bindPopup('Sua localização (aproximada)')
        .addTo(camadaOrigem);
    }

    const limites = camadaPontos.getBounds();
    if (origem) limites.extend(camadaOrigem.getBounds());
    if (limites.isValid()) mapa.fitBounds(limites, { padding: [30, 30], maxZoom: 15, animate: false });

    el.lista.innerHTML = pontos.length
      ? pontos.map(htmlItemLista).join('')
      : '<li class="lista-vazia">Nenhum ponto para este material.</li>';
  }

  // ---------- Buscas ----------

  function parametrosFiltro() {
    return el.filtro.value ? `&categoria=${encodeURIComponent(el.filtro.value)}` : '';
  }

  async function executar(busca) {
    ultimaBusca = busca;
    mostrarStatus('Buscando pontos de coleta…');

    try {
      const origem =
        busca.tipo === 'cep' ? `cep=${busca.cep}` : `lat=${busca.latitude}&lng=${busca.longitude}`;
      const dados = await chamarApi(`/pontos/proximos?${origem}&raio=${RAIO_BUSCA_KM}${parametrosFiltro()}`);
      desenhar(dados.pontos, dados.origem, { mostrarRaio: true });

      const avisos = [];
      if (dados.fora_do_raio && dados.pontos.length) {
        const maisProximo = dados.pontos[0];
        el.tituloLista.textContent = 'Ponto mais próximo';
        avisos.push(
          `Nenhum ponto até ${RAIO_BUSCA_KM} km. O mais próximo fica a ${formatarDistancia(maisProximo.distancia_km)}, em ${maisProximo.municipio}.`,
        );
      } else if (dados.fora_do_raio) {
        el.tituloLista.textContent = 'Nenhum ponto';
        avisos.push('Nenhum ponto de coleta cadastrado para este material.');
      } else {
        el.tituloLista.textContent = `${dados.total} ${dados.total === 1 ? 'ponto' : 'pontos'} até ${RAIO_BUSCA_KM} km`;
        avisos.push(
          `${dados.total} ${dados.total === 1 ? 'ponto encontrado' : 'pontos encontrados'} a até ${RAIO_BUSCA_KM} km.`,
        );
      }
      if (dados.origem.precisao === 'municipio') {
        avisos.push(`Localização aproximada pelo centro de ${dados.origem.cidade}.`);
      } else if (dados.origem.precisao === 'bairro') {
        avisos.push(`Localização aproximada pelo bairro ${dados.origem.bairro}.`);
      }
      mostrarStatus(
        avisos.join(' '),
        dados.fora_do_raio || dados.origem.precisao === 'municipio' ? 'aviso' : '',
      );

      // Um único resultado: já abre o balão com o "Como chegar", mantendo você e o ponto na tela.
      if (dados.pontos.length === 1) abrirPonto(dados.pontos[0].id, { aproximar: false });
    } catch (erro) {
      mostrarStatus(erro.message, 'erro');
    }
  }

  function irParaResultados() {
    el.secao.scrollIntoView({ behavior: 'smooth' });
  }

  // ---------- Eventos ----------

  // Só a máscara 00000-000: a busca acontece apenas no botão Buscar (ou Enter).
  el.cep.addEventListener('input', () => {
    const digitos = el.cep.value.replace(/\D/g, '').slice(0, 8);
    el.cep.value = digitos.length > 5 ? `${digitos.slice(0, 5)}-${digitos.slice(5)}` : digitos;
  });

  el.formCep.addEventListener('submit', (evento) => {
    evento.preventDefault();
    const digitos = el.cep.value.replace(/\D/g, '');
    if (digitos.length !== 8) {
      mostrarStatus('Digite um CEP com 8 dígitos.', 'erro');
      irParaResultados();
      el.cep.focus();
      return;
    }
    executar({ tipo: 'cep', cep: digitos });
    irParaResultados();
  });

  el.btnLocalizacao.addEventListener('click', (evento) => {
    evento.preventDefault();
    irParaResultados();
    if (!navigator.geolocation) {
      mostrarStatus('Seu navegador não permite localização. Digite seu CEP.', 'aviso');
      return;
    }
    mostrarStatus('Obtendo sua localização…');
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => executar({ tipo: 'gps', latitude: coords.latitude, longitude: coords.longitude }),
      () => {
        mostrarStatus('Não foi possível obter sua localização. Digite seu CEP acima.', 'aviso');
        el.cep.focus();
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  });

  // Trocar o material refaz a última busca; antes da primeira busca, só guarda a escolha.
  el.filtro.addEventListener('change', () => {
    if (ultimaBusca) executar(ultimaBusca);
  });

  el.lista.addEventListener('click', (evento) => {
    const item = evento.target.closest('[data-id]');
    if (!item) return;
    // No celular a lista fica abaixo do mapa: sobe até ele antes de abrir o balão.
    if (window.matchMedia('(max-width: 899px)').matches) {
      el.mapa.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    abrirPonto(Number(item.dataset.id));
  });

  // ---------- Início ----------

  function mostrarEstadoInicial() {
    el.tituloLista.textContent = 'Pontos de coleta';
    el.lista.innerHTML =
      '<li class="lista-vazia">Digite seu CEP acima e clique em <strong>Buscar</strong> para ver os pontos até 12 km de você.</li>';
  }

  async function iniciar() {
    try {
      const categorias = await chamarApi('/categorias');
      for (const categoria of categorias) {
        nomesCategorias[categoria.slug] = categoria.nome;
        el.filtro.add(new Option(categoria.nome, categoria.slug));
      }
    } catch {
      // Sem categorias o filtro fica só com "Todos"; o erro aparece na busca abaixo.
    }

    // Link direto para uma busca, ex.: index.html?cep=29101-010
    const cepDaUrl = new URLSearchParams(location.search).get('cep')?.replace(/\D/g, '');
    if (cepDaUrl?.length === 8) {
      el.cep.value = `${cepDaUrl.slice(0, 5)}-${cepDaUrl.slice(5)}`;
      executar({ tipo: 'cep', cep: cepDaUrl });
    } else {
      mostrarEstadoInicial();
    }
  }

  iniciar();
})();
