(() => {
  const API_URL = (() => {
    const configurada = window.ECOELETRO_CONFIG?.apiUrl;
    if (configurada) return configurada.replace(/\/$/, '');
    // A própria API serve o site (local, Docker, Vercel): mesmo endereço. Só quando o HTML é aberto
    // com dois cliques (file://) ou pelo Live Server (porta 5500) a API fica em localhost:3000.
    const foraDaApi = location.protocol === 'file:' || location.port === '5500';
    return foraDaApi ? 'http://localhost:3000/api' : `${location.origin}/api`;
  })();

  const CENTRO_ES = [-19.6, -40.6];
  const CHAVE_RAIO_SALVO = 'ecoeletro:raio';

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
    raio: document.getElementById('raioInput'),
    raioValor: document.getElementById('raioValor'),
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

  function desenhar(pontos, origem, raioKm) {
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
      if (raioKm) {
        L.circle([origem.latitude, origem.longitude], {
          radius: raioKm * 1000,
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

  // ---------- Alcance da busca ----------
  // Limites e valor inicial vêm dos atributos min/max/value do <input type="range"> no HTML.

  function limitarRaio(valor) {
    if (valor === null || valor === '') return null;
    const numero = Math.round(Number(valor));
    if (!Number.isFinite(numero)) return null;
    return Math.min(Number(el.raio.max), Math.max(Number(el.raio.min), numero));
  }

  function definirRaio(valor) {
    el.raio.value = limitarRaio(valor) ?? el.raio.defaultValue;
    el.raioValor.textContent = `${el.raio.value} km`;
    el.raio.setAttribute('aria-valuetext', `${el.raio.value} quilômetros`);
  }

  // O navegador pode bloquear o armazenamento (aba anônima etc.): aí só não lembra.
  function lerRaioSalvo() {
    try {
      return localStorage.getItem(CHAVE_RAIO_SALVO);
    } catch {
      return null;
    }
  }

  function salvarRaio() {
    try {
      localStorage.setItem(CHAVE_RAIO_SALVO, el.raio.value);
    } catch {
      // segue sem lembrar
    }
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
      const dados = await chamarApi(`/pontos/proximos?${origem}&raio=${el.raio.value}${parametrosFiltro()}`);
      const raio = dados.raio_km;
      desenhar(dados.pontos, dados.origem, raio);

      const avisos = [];
      if (dados.fora_do_raio && dados.pontos.length) {
        const maisProximo = dados.pontos[0];
        el.tituloLista.textContent = 'Ponto mais próximo';
        avisos.push(
          `Nenhum ponto até ${raio} km. O mais próximo fica a ${formatarDistancia(maisProximo.distancia_km)}, em ${maisProximo.municipio}.`,
        );
      } else if (dados.fora_do_raio) {
        el.tituloLista.textContent = 'Nenhum ponto';
        avisos.push('Nenhum ponto de coleta cadastrado para este material.');
      } else {
        el.tituloLista.textContent = `${dados.total} ${dados.total === 1 ? 'ponto' : 'pontos'} até ${raio} km`;
        avisos.push(
          `${dados.total} ${dados.total === 1 ? 'ponto encontrado' : 'pontos encontrados'} a até ${raio} km.`,
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

  // Alcance: o número acompanha o arraste; ao soltar, lembra a escolha e,
  // se já houve uma busca, refaz com o novo raio (o CEP continua só no botão Buscar).
  el.raio.addEventListener('input', () => definirRaio(el.raio.value));
  el.raio.addEventListener('change', () => {
    salvarRaio();
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
      '<li class="lista-vazia">Digite seu CEP acima, escolha o alcance e clique em <strong>Buscar</strong> para ver os pontos perto de você.</li>';
  }

  async function iniciar() {
    // Alcance: o da URL (?raio=20) tem prioridade; senão, o último escolhido; senão, o padrão do HTML.
    const parametros = new URLSearchParams(location.search);
    definirRaio(parametros.get('raio') ?? lerRaioSalvo() ?? el.raio.defaultValue);

    try {
      const categorias = await chamarApi('/categorias');
      for (const categoria of categorias) {
        nomesCategorias[categoria.slug] = categoria.nome;
        el.filtro.add(new Option(categoria.nome, categoria.slug));
      }
    } catch {
      // Sem categorias o filtro fica só com "Todos"; o erro aparece na busca abaixo.
    }

    // Link direto para uma busca, ex.: index.html?cep=29101-010&raio=20
    const cepDaUrl = parametros.get('cep')?.replace(/\D/g, '');
    if (cepDaUrl?.length === 8) {
      el.cep.value = `${cepDaUrl.slice(0, 5)}-${cepDaUrl.slice(5)}`;
      executar({ tipo: 'cep', cep: cepDaUrl });
    } else {
      mostrarEstadoInicial();
    }
  }

  iniciar();
})();
