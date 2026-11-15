/* IdeaSito — interfaccia: scheda guidata, caricamento immagini, motore AI (Puter) e motore offline. */
(function () {
  'use strict';

  // ======================================================================
  // Utility
  // ======================================================================
  const $ = (id) => document.getElementById(id);
  const qsa = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const kb = (bytes) => (bytes >= 1024 * 1024 ? (bytes / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB' : Math.max(1, Math.round(bytes / 1024)) + ' KB');
  const dataUrlBytes = (u) => (u ? Math.round((u.length - u.indexOf(',') - 1) * 0.75) : 0);

  const STATE_KEY = 'ideasito-brief-v2';
  const HISTORY_KEY = 'ideasito-history';
  const MAX_PHOTOS = 12;
  const MAX_HISTORY = 10;

  // ======================================================================
  // Dati del contratto offline (letti in modo difensivo)
  // ======================================================================
  const FALLBACK_CATEGORIES = [
    { id: 'ristorante', label: 'Ristorante / Pizzeria', emoji: '🍝', defaultSections: ['chi', 'menu', 'galleria', 'testimonianze', 'orari', 'dove', 'contatti'] },
    { id: 'bar', label: 'Bar / Caffetteria', emoji: '☕', defaultSections: ['chi', 'menu', 'galleria', 'orari', 'dove', 'contatti'] },
    { id: 'negozio', label: 'Negozio', emoji: '🛍️', defaultSections: ['chi', 'prodotti', 'galleria', 'orari', 'dove', 'contatti'] },
    { id: 'portfolio', label: 'Portfolio', emoji: '📷', defaultSections: ['chi', 'progetti', 'galleria', 'prezzi', 'testimonianze', 'contatti'] },
    { id: 'prodotto', label: 'App / Startup', emoji: '🚀', defaultSections: ['servizi', 'numeri', 'prezzi', 'testimonianze', 'faq', 'cta'] },
    { id: 'fitness', label: 'Palestra / Fitness', emoji: '💪', defaultSections: ['chi', 'servizi', 'prezzi', 'team', 'orari', 'contatti'] },
    { id: 'personale', label: 'Personale / CV', emoji: '💻', defaultSections: ['chi', 'servizi', 'progetti', 'contatti'] },
    { id: 'ospitalita', label: 'Hotel / B&B', emoji: '🏡', defaultSections: ['chi', 'servizi', 'galleria', 'prezzi', 'testimonianze', 'dove', 'contatti'] },
    { id: 'professionista', label: 'Professionista', emoji: '⚖️', defaultSections: ['chi', 'servizi', 'numeri', 'testimonianze', 'faq', 'contatti'] },
    { id: 'evento', label: 'Evento', emoji: '🎉', defaultSections: ['chi', 'programma', 'galleria', 'dove', 'faq', 'contatti'] },
    { id: 'associazione', label: 'Associazione', emoji: '🤝', defaultSections: ['chi', 'servizi', 'numeri', 'team', 'cta', 'contatti'] },
    { id: 'altro', label: 'Altro', emoji: '✨', defaultSections: ['chi', 'servizi', 'galleria', 'testimonianze', 'contatti'] },
  ];
  const FALLBACK_SECTIONS = [
    ['chi', 'Chi siamo'], ['servizi', 'Servizi'], ['menu', 'Menù'], ['prodotti', 'Prodotti'], ['progetti', 'Progetti'],
    ['galleria', 'Galleria'], ['prezzi', 'Prezzi'], ['testimonianze', 'Recensioni'], ['team', 'Team'], ['numeri', 'Numeri'],
    ['programma', 'Programma'], ['faq', 'Domande frequenti'], ['orari', 'Orari'], ['dove', 'Dove siamo'], ['cta', 'Invito all\'azione'], ['contatti', 'Contatti'],
  ].map(([id, label]) => ({ id, label, description: '' }));

  const themes = () => (Array.isArray(window.OFFLINE_THEMES) ? window.OFFLINE_THEMES.filter((t) => t && t.id) : []);
  const categories = () => (Array.isArray(window.OFFLINE_CATEGORIES) && window.OFFLINE_CATEGORIES.length ? window.OFFLINE_CATEGORIES : FALLBACK_CATEGORIES);
  const sectionsList = () => (Array.isArray(window.OFFLINE_SECTIONS) && window.OFFLINE_SECTIONS.length ? window.OFFLINE_SECTIONS : FALLBACK_SECTIONS);
  const offlineAvailable = () => typeof window.generateOffline === 'function';
  const findCat = (id) => categories().find((c) => c.id === id);
  const findTheme = (id) => themes().find((t) => t.id === id);
  const sectionLabel = (id) => (sectionsList().find((s) => s.id === id) || { label: id }).label;
  const catDefaults = (id) => {
    const c = findCat(id) || findCat('altro');
    return c && Array.isArray(c.defaultSections) ? c.defaultSections.slice() : [];
  };

  // Testi della scheda che si adattano alla categoria
  const CAT_UI = {
    ristorante: { items: 'Piatti del menù', ph: 'Margherita - 7€\nDiavola - 8,50€: salame piccante e fior di latte\nTiramisù della casa - 5€', tag: 'La vera pizza napoletana, dal 1987',
      desc: "Siamo una pizzeria a conduzione familiare nel cuore della città. Impasto a lunga lievitazione (48 ore), forno a legna e ingredienti DOP. Ideale per cene in famiglia e tra amici, anche da asporto. Prenota su WhatsApp!" },
    bar: { items: 'Menù del bar', ph: 'Espresso - 1,20€\nCappuccino - 1,60€\nCornetto artigianale - 1,50€\nAperitivo con stuzzichini - 8€', tag: 'Il caffè buono sotto casa',
      desc: "Un bar di quartiere dove tutti si sentono di casa. Caffè di torrefazione locale, cornetti sfornati ogni mattina e aperitivi al tramonto in dehors. Aperti dalla colazione all'aperitivo." },
    negozio: { items: 'Prodotti', ph: 'Borsa in pelle - 89€\nCintura artigianale - 39€: pelle conciata al vegetale\nPortafoglio - 45€', tag: 'Fatto a mano, fatto per durare',
      desc: "Un piccolo laboratorio-negozio dove creiamo a mano accessori in pelle, uno per uno. Materiali italiani, lavorazione tradizionale e personalizzazione su richiesta." },
    portfolio: { items: 'Progetti e servizi', ph: 'Matrimonio sul lago di Como: reportage completo\nRitratti in studio - da 150€\nServizio famiglia - 220€', tag: 'Racconto storie con la luce',
      desc: "Sono un fotografo con dieci anni di esperienza tra matrimoni, ritratti ed eventi. Il mio stile è naturale ed elegante: niente pose forzate, solo emozioni vere." },
    prodotto: { items: 'Funzionalità e piani', ph: 'Piano Base - 0€: per iniziare\nPiano Pro - 9€/mese: tutte le funzioni\nPiano Team - 29€/mese: fino a 10 persone\nSincronizzazione su tutti i dispositivi', tag: "Organizza la tua giornata in 5 minuti",
      desc: "Un'app semplice che ti aiuta a pianificare la giornata, ricordarti le cose importanti e lavorare meglio in team. Pensata per freelance e piccoli gruppi che odiano le complicazioni." },
    fitness: { items: 'Corsi e abbonamenti', ph: 'Abbonamento mensile - 45€\nPilates: lunedì e giovedì ore 19\nPersonal training - 35€/ora\nFunctional training: tutti i giorni', tag: 'Allenati con il sorriso',
      desc: "Una palestra a misura di persona: istruttori certificati, corsi per tutti i livelli e un ambiente dove nessuno si sente giudicato. Prima lezione di prova gratuita." },
    personale: { items: 'Progetti e competenze', ph: 'E-commerce per un negozio di bici: React + Node\nApp prenotazioni per un parrucchiere\nCompetenze: JavaScript, TypeScript, React, Figma', tag: 'Sviluppatore web, costruisco cose semplici e veloci',
      desc: "Ciao! Sono uno sviluppatore web freelance. Aiuto piccole aziende e startup a creare siti e app veloci, accessibili e facili da usare. Mi piacciono il codice pulito e il buon design." },
    ospitalita: { items: 'Camere e servizi', ph: 'Camera doppia vista mare - 120€/notte\nSuite con terrazza - 180€/notte\nColazione con prodotti locali: inclusa\nParcheggio privato: gratuito', tag: 'Il tuo angolo di pace a due passi dal mare',
      desc: "Un B&B in una masseria ristrutturata, circondata dagli ulivi e a 5 minuti dal mare. Camere luminose, colazione con prodotti del territorio e consigli su misura per scoprire la zona." },
    bellezza: { items: 'Trattamenti e prezzi', ph: 'Taglio e piega - 35€\nColore - da 45€\nManicure semipermanente - 25€\nMassaggio rilassante 50 min - 55€', tag: 'Il tuo momento di bellezza',
      desc: "Un salone accogliente dove prenderti cura di te. Prodotti professionali e naturali, consulenza personalizzata e un'atmosfera rilassante. Prenota il tuo appuntamento anche su WhatsApp." },
    professionista: { items: 'Servizi', ph: 'Consulenza iniziale - 80€\nDiritto di famiglia: separazioni e affidi\nContrattualistica per aziende', tag: 'Al tuo fianco, con chiarezza',
      desc: "Studio legale con oltre 15 anni di esperienza. Ascoltiamo, spieghiamo con parole semplici e cerchiamo sempre la soluzione più rapida e meno costosa per te." },
    evento: { items: 'Programma', ph: '16:00 - Cerimonia in chiesa\n18:30 - Aperitivo in giardino\n20:30 - Cena e festa\n23:00 - Taglio della torta', tag: 'Il 14 giugno ci sposiamo!',
      desc: "Dopo otto anni insieme abbiamo deciso di dirci sì. Saremmo felicissimi di festeggiare con voi in una villa sulle colline. Qui trovate programma, indicazioni e come confermare." },
    associazione: { items: 'Attività', ph: 'Doposcuola gratuito: lun–ven 15–18\nRaccolta alimentare mensile\nGite per famiglie', tag: 'Insieme si fa di più',
      desc: "Siamo un'associazione di volontari che dal 2010 aiuta le famiglie del quartiere. Organizziamo doposcuola, raccolte alimentari ed eventi. Unisciti a noi!" },
    altro: { items: 'Servizi o prodotti', ph: 'Primo servizio - 50€\nSecondo servizio: breve descrizione\nTerzo servizio', tag: 'Una frase che ti rappresenta',
      desc: "Racconta chi sei, cosa fai e perché le persone dovrebbero sceglierti. Aggiungi dettagli concreti: anni di esperienza, città, cosa ti rende unico." },
  };
  const catUi = (id) => CAT_UI[id] || CAT_UI.altro;

  const ENGINES = [
    { id: 'offline', icon: '⚡', title: 'Template offline', desc: 'Istantaneo, nessun account, usa gli stili qui sopra. Funziona anche senza internet.' },
    { id: 'claude-sonnet-4', icon: '🧠', title: 'AI · Claude', desc: 'Scrive testi e layout su misura. Richiede un account Puter gratuito.' },
    { id: 'gpt-4o-mini', icon: '⚙️', title: 'AI · GPT-4o mini', desc: 'Più veloce, sempre tramite Puter. Utile se Claude è occupato.' },
  ];
  const ACCENTS = ['#e4572e', '#f59e0b', '#d4a24c', '#16a34a', '#0f766e', '#0ea5e9', '#2563eb', '#7c3aed', '#db2777', '#111827'];
  const isAI = (engine) => engine && engine !== 'offline';

  // ======================================================================
  // Stato
  // ======================================================================
  const emptyState = () => ({
    mode: 'guidata', step: 0, engine: 'offline', refineModel: 'claude-sonnet-4',
    idea: '', name: '', tagline: '', description: '', category: '', theme: '', accentColor: '',
    sections: [], sectionsCustom: false, items: '',
    contacts: { phone: '', email: '', whatsapp: '', address: '', instagram: '', facebook: '', hours: '' },
    logo: null, photos: [],
  });
  let state = emptyState();
  let current = null; // { id, raw, images:{logo,photos:[{src,caption}]}, engine, brief, title }
  let currentHtml = '';
  let busy = false;

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
      if (saved && typeof saved === 'object') {
        const base = emptyState();
        state = { ...base, ...saved, contacts: { ...base.contacts, ...(saved.contacts || {}) }, logo: null, photos: [] };
        if (!Array.isArray(state.sections)) state.sections = [];
      }
    } catch { /* stato corrotto: si riparte */ }
    if (!ENGINES.some((e) => e.id === state.engine)) state.engine = 'offline';
    if (state.engine === 'offline' && !offlineAvailable()) state.engine = 'claude-sonnet-4';
  }

  const saveState = debounce(() => {
    const { logo, photos, ...text } = state;
    try { localStorage.setItem(STATE_KEY, JSON.stringify(text)); } catch { /* storage pieno */ }
    scheduleLive();
  }, 250);

  // Immagini: IndexedDB (best effort), così un ricarico non le perde
  const idb = {
    db: null,
    open() {
      if (this.db) return Promise.resolve(this.db);
      return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('no idb'));
        const r = indexedDB.open('ideasito', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; resolve(r.result); };
        r.onerror = () => reject(r.error);
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const req = db.transaction('kv', 'readonly').objectStore('kv').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, val) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
  const saveImages = debounce(() => {
    idb.set('images', { logo: state.logo, photos: state.photos }).catch(() => {});
    scheduleLive();
  }, 300);
  async function loadImages() {
    try {
      const v = await idb.get('images');
      if (v && typeof v === 'object') {
        state.logo = typeof v.logo === 'string' ? v.logo : null;
        state.photos = Array.isArray(v.photos) ? v.photos.filter((p) => p && typeof p.src === 'string').slice(0, MAX_PHOTOS) : [];
      }
    } catch { /* niente immagini salvate */ }
  }

  function getPath(obj, path) { return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj); }
  function setPath(obj, path, val) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((o, k) => o[k], obj);
    target[last] = val;
  }

  // ======================================================================
  // Elementi
  // ======================================================================
  const els = {
    panelBody: $('panel-body'), paneVeloce: $('pane-veloce'), paneGuidata: $('pane-guidata'),
    footGuidata: $('foot-guidata'), footVeloce: $('foot-veloce'),
    prev: $('prev'), next: $('next'), generate: $('generate'), generateQuick: $('generate-quick'),
    status: $('status'), stepper: $('stepper'), progressBar: $('progress-bar'),
    catGrid: $('cat-grid'), sectionChips: $('section-chips'), sectionOrder: $('section-order'),
    itemsLabel: $('items-label'), itemsHint: $('items-hint'), itemsPreview: $('items-preview'), items: $('f-items'),
    tagline: $('f-tagline'), description: $('f-description'),
    logoZone: $('logo-zone'), photoZone: $('photo-zone'), photoGrid: $('photo-grid'), photoCount: $('photo-count'),
    logoInput: $('logo-input'), photosInput: $('photos-input'), quickThumbs: $('quick-thumbs'), quickMedia: $('quick-media'),
    themeGrid: $('theme-grid'), accentRow: $('accent-row'), engineCards: $('engine-cards'),
    quickTheme: $('quick-theme'), quickEngine: $('quick-engine'), summary: $('summary'), wizardHint: $('wizard-hint'),
    idea: $('idea'), prefill: $('prefill'),
    empty: $('empty'), frameWrap: $('frame-wrap'), preview: $('preview'), code: $('code'), codeText: $('code-text'),
    stageStatus: $('stage-status'), stageStatusText: $('stage-status-text'),
    copy: $('copy'), open: $('open'), download: $('download'),
    refineBox: $('refine-box'), refine: $('refine'), refineBtn: $('refine-btn'), refineModel: $('refine-model'),
    restyle: $('restyle'), restyleList: $('restyle-list'),
    historyDialog: $('history-dialog'), historyList: $('history-list'),
  };

  // ======================================================================
  // Messaggi
  // ======================================================================
  function setStatus(msg, kind = '', spin = false) {
    els.status.className = 'status' + (kind ? ' ' + kind : '');
    els.status.innerHTML = (spin ? '<span class="spinner"></span>' : '') + esc(msg);
    if (spin) {
      els.stageStatus.classList.remove('hidden');
      els.stageStatusText.textContent = msg;
    } else {
      els.stageStatus.classList.add('hidden');
    }
  }

  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    $('toasts').append(t);
    setTimeout(() => t.classList.add('out'), 3800);
    setTimeout(() => t.remove(), 4300);
  }

  function setBusy(b) {
    busy = b;
    [els.generate, els.generateQuick, els.refineBtn, els.prefill].forEach((x) => (x.disabled = b));
    qsa('.restyle-btn').forEach((x) => (x.disabled = b));
    document.body.classList.toggle('is-busy', b);
  }

  // ======================================================================
  // Render: modalità e passi
  // ======================================================================
  const STEP_COUNT = 5;

  function stepHasData(i) {
    const c = state.contacts;
    switch (i) {
      case 0: return !!(state.name || state.category || state.tagline || state.description);
      case 1: return !!(state.sectionsCustom || state.items.trim());
      case 2: return !!(state.logo || state.photos.length);
      case 3: return !!(state.theme || state.accentColor);
      case 4: return Object.values(c).some((v) => String(v).trim());
      default: return false;
    }
  }

  function renderMode() {
    const g = state.mode === 'guidata';
    els.paneGuidata.hidden = !g;
    els.paneVeloce.hidden = g;
    els.footGuidata.hidden = !g;
    els.footVeloce.hidden = g;
    qsa('.mode-btn').forEach((b) => {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', String(on));
    });
    if (!g) renderWizardHint();
  }

  function renderStep() {
    const s = Math.max(0, Math.min(STEP_COUNT - 1, state.step | 0));
    state.step = s;
    qsa('.step').forEach((el) => (el.hidden = Number(el.dataset.step) !== s));
    qsa('#stepper li').forEach((li, i) => {
      li.classList.toggle('active', i === s);
      li.classList.toggle('done', i !== s && stepHasData(i));
      const b = li.querySelector('button');
      if (i === s) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
    });
    els.progressBar.style.width = ((s + 1) / STEP_COUNT) * 100 + '%';
    els.prev.disabled = s === 0;
    const last = s === STEP_COUNT - 1;
    els.next.hidden = last;
    els.next.textContent = stepHasData(s) ? 'Avanti →' : 'Salta →';
    els.generate.textContent = last ? '✨ Crea il mio sito' : '✨ Crea ora';
    els.generate.classList.toggle('wide', last);
    els.footGuidata.classList.toggle('is-last', last);
    if (last) renderSummary();
  }

  function goStep(i) {
    state.step = Math.max(0, Math.min(STEP_COUNT - 1, i));
    if (!busy && !els.status.classList.contains('error')) setStatus('');
    renderStep();
    saveState();
    els.panelBody.scrollTop = 0;
    if (window.matchMedia('(max-width: 900px)').matches) {
      const top = els.paneGuidata.getBoundingClientRect().top + window.scrollY - 70;
      if (window.scrollY > top) window.scrollTo({ top, behavior: 'smooth' });
    }
  }

  function setMode(mode) {
    state.mode = mode;
    renderMode();
    saveState();
    els.panelBody.scrollTop = 0;
  }

  // ======================================================================
  // Render: passo 1 (categorie)
  // ======================================================================
  function renderCategories() {
    els.catGrid.innerHTML = '';
    categories().forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cat-tile';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.category === c.id));
      b.dataset.id = c.id;
      b.innerHTML = `<span class="cat-emoji" aria-hidden="true">${esc(c.emoji || '•')}</span><span class="cat-name">${esc(c.label)}</span>`;
      b.addEventListener('click', () => setCategory(state.category === c.id ? '' : c.id));
      els.catGrid.append(b);
    });
  }

  function setCategory(id) {
    state.category = id;
    if (!state.sectionsCustom) state.sections = id ? catDefaults(id) : [];
    renderCategories();
    renderSections();
    renderCategoryTexts();
    renderThemes();
    renderStep();
    saveState();
  }

  function renderCategoryTexts() {
    const ui = catUi(state.category);
    els.itemsLabel.textContent = ui.items;
    els.items.placeholder = ui.ph;
    els.tagline.placeholder = 'Es. ' + ui.tag;
    els.description.placeholder = 'Es. ' + ui.desc;
    renderItemsPreview();
  }

  // ======================================================================
  // Render: passo 2 (sezioni + voci)
  // ======================================================================
  function renderSections() {
    els.sectionChips.innerHTML = '';
    sectionsList().forEach((sec) => {
      const on = state.sections.includes(sec.id);
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip toggle' + (on ? ' on' : '');
      b.setAttribute('aria-pressed', String(on));
      b.title = sec.description || '';
      b.dataset.id = sec.id;
      b.textContent = (on ? '✓ ' : '+ ') + sec.label;
      b.addEventListener('click', () => {
        const i = state.sections.indexOf(sec.id);
        if (i >= 0) state.sections.splice(i, 1); else state.sections.push(sec.id);
        state.sectionsCustom = true;
        renderSections();
        renderStep();
        saveState();
      });
      els.sectionChips.append(b);
    });

    els.sectionOrder.innerHTML = '';
    if (!state.sections.length) {
      const li = document.createElement('li');
      li.className = 'sort-empty';
      li.textContent = state.category
        ? 'Nessuna sezione scelta: userò quelle consigliate.'
        : 'Scegli il tipo di sito al passo 1 per avere le sezioni consigliate, oppure toccale qui sopra.';
      els.sectionOrder.append(li);
      return;
    }
    state.sections.forEach((id, i) => {
      const li = document.createElement('li');
      li.className = 'sort-item';
      li.draggable = true;
      li.dataset.index = String(i);
      li.dataset.id = id;
      li.innerHTML = `<span class="handle" aria-hidden="true">⋮⋮</span><span class="sort-n">${i + 1}</span><span class="sort-label">${esc(sectionLabel(id))}</span>
        <span class="sort-actions">
          <button type="button" class="mini" data-act="up" aria-label="Sposta su" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="mini" data-act="down" aria-label="Sposta giù" ${i === state.sections.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="mini danger" data-act="remove" aria-label="Rimuovi">✕</button>
        </span>`;
      els.sectionOrder.append(li);
    });
  }

  function moveItem(arr, from, to) {
    if (to < 0 || to >= arr.length || from === to) return false;
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
    return true;
  }

  els.sectionOrder.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = Number(btn.closest('li').dataset.index);
    const act = btn.dataset.act;
    if (act === 'up') moveItem(state.sections, i, i - 1);
    else if (act === 'down') moveItem(state.sections, i, i + 1);
    else if (act === 'remove') state.sections.splice(i, 1);
    state.sectionsCustom = true;
    renderSections();
    renderStep();
    saveState();
    const again = els.sectionOrder.querySelector(`li[data-index="${act === 'up' ? i - 1 : act === 'down' ? i + 1 : i}"] button[data-act="${act}"]`);
    if (again && !again.disabled) again.focus();
  });

  // Ordinamento con trascinamento (desktop)
  function makeSortable(listEl, getArr, onChange) {
    let from = null;
    listEl.addEventListener('dragstart', (e) => {
      const li = e.target.closest('li[data-index]');
      if (!li || e.target.closest('input, textarea')) return;
      from = Number(li.dataset.index);
      li.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', 'ideasito-sort'); } catch { /* ok */ }
    });
    listEl.addEventListener('dragover', (e) => {
      if (from === null) return;
      e.preventDefault();
      const li = e.target.closest('li[data-index]');
      qsa('.drop-target', listEl).forEach((x) => x !== li && x.classList.remove('drop-target'));
      if (li) li.classList.add('drop-target');
    });
    listEl.addEventListener('drop', (e) => {
      if (from === null) return;
      e.preventDefault();
      e.stopPropagation();
      const li = e.target.closest('li[data-index]');
      if (li && moveItem(getArr(), from, Number(li.dataset.index))) onChange();
    });
    listEl.addEventListener('dragend', () => {
      from = null;
      qsa('.dragging, .drop-target', listEl).forEach((x) => x.classList.remove('dragging', 'drop-target'));
    });
  }
  makeSortable(els.sectionOrder, () => state.sections, () => { state.sectionsCustom = true; renderSections(); saveState(); });

  $('sections-reset').addEventListener('click', () => {
    state.sections = catDefaults(state.category || 'altro');
    state.sectionsCustom = false;
    renderSections();
    renderStep();
    saveState();
  });

  // Anteprima delle voci riconosciute
  function parseItems(text) {
    return String(text || '').split('\n').map((l) => l.replace(/^[\s•*·-]+/, '').trim()).filter(Boolean).map((line) => {
      let name = line; let price = ''; let desc = '';
      const ci = name.indexOf(':');
      if (ci > 0 && !/^\d{1,2}:\d{2}/.test(name)) { desc = name.slice(ci + 1).trim(); name = name.slice(0, ci).trim(); }
      const m = name.match(/^(.*?)\s+[-–—]\s+(.+)$/);
      if (m) {
        if (/\d/.test(m[2]) && m[2].length <= 22) { name = m[1].trim(); price = m[2].trim(); }
        else if (/^\d{1,2}[:.]\d{2}$/.test(m[1].trim())) { name = m[2].trim(); price = m[1].trim(); }
      }
      return { name, price, desc };
    });
  }

  function renderItemsPreview() {
    const list = parseItems(state.items);
    if (!list.length) { els.itemsPreview.innerHTML = ''; return; }
    const shown = list.slice(0, 5).map((it) => `<li><span class="ip-name">${esc(it.name)}${it.desc ? `<small>${esc(it.desc)}</small>` : ''}</span>${it.price ? `<span class="ip-price">${esc(it.price)}</span>` : ''}</li>`).join('');
    els.itemsPreview.innerHTML = `<p class="ip-head">✓ ${list.length} ${list.length === 1 ? 'voce riconosciuta' : 'voci riconosciute'}</p><ul>${shown}</ul>${list.length > 5 ? `<p class="ip-more">…e altre ${list.length - 5}</p>` : ''}`;
  }

  // ======================================================================
  // Passo 3: immagini (compressione nel browser)
  // ======================================================================
  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }

  async function decodeImage(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error(`Non riesco a leggere «${file.name}». Usa una foto JPG, PNG o WebP (le HEIC dell'iPhone vanno prima convertite).`);
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }

  async function compressImage(file, { max, mime, quality, background }) {
    const img = await decodeImage(file);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    if (!w || !h) throw new Error(`L'immagine «${file.name}» sembra vuota.`);
    const scale = Math.min(1, max / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * scale));
    const ch = Math.max(1, Math.round(h * scale));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, cw, ch); }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, cw, ch);
    let out = canvas.toDataURL(mime, quality);
    // Se non serviva ridimensionare e l'originale (stesso formato) è più leggero, teniamo l'originale
    if (scale === 1 && file.type === mime && file.size < dataUrlBytes(out)) out = await readAsDataURL(file);
    return { src: out, width: cw, height: ch };
  }

  async function handleLogo(file) {
    if (!file) return;
    if (!/^image\//.test(file.type) && !/\.svg$/i.test(file.name)) { toast('Il logo deve essere un\'immagine (PNG, SVG, JPG).', 'error'); return; }
    try {
      let src;
      if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) {
        if (file.size > 400 * 1024) throw new Error('Il logo SVG è troppo pesante (max 400 KB).');
        src = await readAsDataURL(file);
        if (!/^data:image\/svg\+xml/.test(src)) src = 'data:image/svg+xml;base64,' + src.split(',')[1];
      } else {
        const keepJpeg = file.type === 'image/jpeg';
        ({ src } = await compressImage(file, { max: 512, mime: keepJpeg ? 'image/jpeg' : 'image/png', quality: 0.9 }));
      }
      state.logo = src;
      afterMediaChange();
      toast(`Logo caricato (${kb(dataUrlBytes(src))}) ✓`, 'ok');
    } catch (err) {
      toast(err.message || 'Logo non valido.', 'error');
    }
  }

  async function handlePhotos(fileList) {
    const files = Array.from(fileList || []).filter((f) => /^image\//.test(f.type) || /\.(jpe?g|png|webp|gif|avif|heic)$/i.test(f.name));
    if (!files.length) { toast('Nessuna immagine trovata tra i file scelti.', 'error'); return; }
    const room = MAX_PHOTOS - state.photos.length;
    if (room <= 0) { toast(`Puoi caricare al massimo ${MAX_PHOTOS} foto.`, 'error'); return; }
    if (files.length > room) toast(`Ne aggiungo ${room}: il massimo è ${MAX_PHOTOS} foto.`);
    const todo = files.slice(0, room);
    setStatus(`Preparo ${todo.length === 1 ? 'la foto' : todo.length + ' foto'}…`, '', true);
    let added = 0;
    for (const f of todo) {
      try {
        const { src, width, height } = await compressImage(f, { max: 1600, mime: 'image/jpeg', quality: 0.82, background: '#ffffff' });
        const caption = f.name.replace(/\.[^.]+$/, '').replace(/^(IMG|DSC|PXL|DCIM|WA|Screenshot)[_\-\s]?[\d_\-\s]*/i, '').replace(/[_-]+/g, ' ').trim();
        state.photos.push({ src, caption: caption.length > 2 && !/^\d+$/.test(caption) && !/^(foto|photo|image|img|immagine|pic|scan)\s*\d*$/i.test(caption) && !/^[\da-f-]{16,}$/i.test(caption) ? caption.charAt(0).toUpperCase() + caption.slice(1) : '', width, height });
        added++;
        renderMedia();
      } catch (err) {
        toast(err.message || 'Foto non valida.', 'error');
      }
    }
    afterMediaChange();
    setStatus(added ? `${added === 1 ? 'Foto aggiunta' : added + ' foto aggiunte'} ✓ Aggiungi una didascalia per ognuna.` : '', added ? 'ok' : '');
  }

  function afterMediaChange() {
    renderMedia();
    renderStep();
    saveImages();
  }

  function renderMedia() {
    // Logo
    if (state.logo) {
      els.logoZone.classList.add('has-file');
      els.logoZone.innerHTML = `<div class="logo-preview"><img src="${esc(state.logo)}" alt="Logo caricato"></div>
        <div class="logo-meta"><strong>Logo caricato</strong><span class="muted">${kb(dataUrlBytes(state.logo))} · comparirà nel menù, nel footer e come icona</span>
        <span class="logo-actions"><button type="button" class="btn small" data-logo="replace">Cambia</button><button type="button" class="btn small ghost danger" data-logo="remove">Rimuovi</button></span></div>`;
    } else {
      els.logoZone.classList.remove('has-file');
      els.logoZone.innerHTML = '<span class="dz-icon">🏷️</span><strong>Trascina qui il logo</strong><span class="muted">oppure <u>clicca per sceglierlo</u> · PNG trasparente o SVG ideali</span>';
    }

    // Foto
    const total = state.photos.reduce((a, p) => a + dataUrlBytes(p.src), 0);
    els.photoCount.textContent = state.photos.length ? `— ${state.photos.length}/${MAX_PHOTOS} · ${kb(total)}` : '';
    els.photoZone.classList.toggle('compact', state.photos.length > 0);
    els.photoGrid.innerHTML = '';
    state.photos.forEach((p, i) => {
      const li = document.createElement('li');
      li.className = 'photo-card' + (i === 0 ? ' is-cover' : '');
      li.draggable = true;
      li.dataset.index = String(i);
      li.innerHTML = `<div class="thumb"><img src="${esc(p.src)}" alt="${esc(p.caption || 'Foto ' + (i + 1))}" draggable="false">
          ${i === 0 ? '<span class="cover-badge">⭐ Copertina</span>' : `<span class="num-badge">${i + 1}</span>`}
          <span class="size-badge">${kb(dataUrlBytes(p.src))}</span></div>
        <input type="text" class="caption" data-index="${i}" maxlength="90" value="${esc(p.caption || '')}" placeholder="Didascalia (es. La nostra sala)" aria-label="Didascalia foto ${i + 1}">
        <div class="photo-actions">
          <button type="button" class="mini" data-act="cover" ${i === 0 ? 'disabled' : ''} title="Usa come copertina" aria-label="Usa come copertina">⭐</button>
          <button type="button" class="mini" data-act="left" ${i === 0 ? 'disabled' : ''} title="Sposta prima" aria-label="Sposta prima">←</button>
          <button type="button" class="mini" data-act="right" ${i === state.photos.length - 1 ? 'disabled' : ''} title="Sposta dopo" aria-label="Sposta dopo">→</button>
          <button type="button" class="mini danger" data-act="remove" title="Rimuovi" aria-label="Rimuovi foto">🗑</button>
        </div>`;
      els.photoGrid.append(li);
    });

    // Versione compatta (modalità veloce)
    const bits = [];
    if (state.logo) bits.push(`<span class="qt qt-logo"><img src="${esc(state.logo)}" alt="Logo"><button type="button" class="qt-x" data-qt="logo" aria-label="Rimuovi logo">✕</button></span>`);
    state.photos.forEach((p, i) => bits.push(`<span class="qt"><img src="${esc(p.src)}" alt="${esc(p.caption || 'Foto ' + (i + 1))}">${i === 0 ? '<em>copertina</em>' : ''}<button type="button" class="qt-x" data-qt="${i}" aria-label="Rimuovi foto ${i + 1}">✕</button></span>`));
    els.quickThumbs.innerHTML = bits.join('');
    els.quickMedia.classList.toggle('has-media', bits.length > 0);
  }

  els.photoGrid.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const i = Number(btn.closest('li').dataset.index);
    const act = btn.dataset.act;
    if (act === 'cover') moveItem(state.photos, i, 0);
    else if (act === 'left') moveItem(state.photos, i, i - 1);
    else if (act === 'right') moveItem(state.photos, i, i + 1);
    else if (act === 'remove') state.photos.splice(i, 1);
    afterMediaChange();
  });
  els.photoGrid.addEventListener('input', (e) => {
    if (!e.target.classList.contains('caption')) return;
    const p = state.photos[Number(e.target.dataset.index)];
    if (p) { p.caption = e.target.value; saveImages(); }
  });
  makeSortable(els.photoGrid, () => state.photos, afterMediaChange);

  els.quickThumbs.addEventListener('click', (e) => {
    const x = e.target.closest('[data-qt]');
    if (!x) return;
    if (x.dataset.qt === 'logo') state.logo = null; else state.photos.splice(Number(x.dataset.qt), 1);
    afterMediaChange();
  });

  els.logoZone.addEventListener('click', (e) => {
    const b = e.target.closest('[data-logo]');
    if (b && b.dataset.logo === 'remove') { state.logo = null; afterMediaChange(); return; }
    els.logoInput.click();
  });
  els.photoZone.addEventListener('click', () => els.photosInput.click());
  [els.logoZone, els.photoZone].forEach((z) => z.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === z) { e.preventDefault(); z.click(); }
  }));
  qsa('[data-pick]').forEach((b) => b.addEventListener('click', () => (b.dataset.pick === 'logo' ? els.logoInput : els.photosInput).click()));
  els.logoInput.addEventListener('change', () => { handleLogo(els.logoInput.files[0]); els.logoInput.value = ''; });
  els.photosInput.addEventListener('change', () => { const f = Array.from(els.photosInput.files); els.photosInput.value = ''; handlePhotos(f); });

  function bindDrop(zone, onFiles) {
    let depth = 0;
    zone.addEventListener('dragenter', (e) => { if (hasFiles(e)) { depth++; zone.classList.add('drag-over'); } });
    zone.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) zone.classList.remove('drag-over'); });
    zone.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    zone.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      zone.classList.remove('drag-over');
      onFiles(e.dataTransfer.files);
    });
  }
  const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');
  bindDrop(els.logoZone, (files) => handleLogo(files[0]));
  bindDrop(els.photoZone, handlePhotos);
  bindDrop(els.quickMedia, (files) => {
    const list = Array.from(files);
    // In modalità veloce: un'immagine con «logo» nel nome diventa il logo
    const logo = list.find((f) => /logo/i.test(f.name));
    if (logo) handleLogo(logo);
    const rest = list.filter((f) => f !== logo);
    if (rest.length) handlePhotos(rest);
  });
  // Evita che un file lasciato fuori dalle zone apra l'immagine al posto dell'app
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('drop', (e) => { if (hasFiles(e)) e.preventDefault(); });

  // ======================================================================
  // Passo 4: stile, colore, motore
  // ======================================================================
  function autoThemeId() {
    const c = findCat(state.category);
    return (c && c.defaultTheme) || '';
  }

  function themeCard(t, { selected, auto }) {
    const sw = (t.swatch && t.swatch.length ? t.swatch : ['#f4f1ea', '#1d1d1f', '#c9a227']).slice(0, 3);
    while (sw.length < 3) sw.push(sw[sw.length - 1]);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'theme-card' + (auto ? ' auto' : '');
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(selected));
    b.dataset.theme = auto ? '' : t.id;
    b.style.setProperty('--c1', sw[0]);
    b.style.setProperty('--c2', sw[1]);
    b.style.setProperty('--c3', sw[2]);
    b.innerHTML = `<span class="tp tp--${esc(auto ? 'auto' : t.id)}" aria-hidden="true">
        <span class="tp-nav"></span><span class="tp-title"></span><span class="tp-line"></span><span class="tp-btn"></span><span class="tp-art"></span><span class="tp-cards"><i></i><i></i><i></i></span>
      </span>
      <span class="tc-body"><span class="tc-name">${esc(auto ? 'Automatico' : t.name)}</span>
      <span class="tc-desc">${esc(t.description || '')}</span>
      <span class="tc-dots">${sw.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span></span>`;
    return b;
  }

  function renderThemes() {
    const list = themes();
    els.themeGrid.innerHTML = '';
    if (!list.length) {
      els.themeGrid.innerHTML = '<p class="note warn">Gli stili offline non sono disponibili in questo momento (file <code>offline/</code> non caricati). Puoi comunque usare il motore AI.</p>';
    } else {
      const autoT = findTheme(autoThemeId());
      els.themeGrid.append(themeCard({
        id: '', name: 'Automatico',
        description: autoT ? `Scelgo io in base al tipo di sito: ora «${autoT.name}».` : 'Scelgo io lo stile più adatto al tipo di sito.',
        swatch: autoT ? autoT.swatch : ['#7c5cff', '#22d3ee', '#f472b6'],
      }, { selected: !state.theme, auto: true }));
      list.forEach((t) => els.themeGrid.append(themeCard(t, { selected: state.theme === t.id })));
    }

    // select della modalità veloce
    els.quickTheme.innerHTML = '<option value="">Automatico</option>' + list.map((t) => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    els.quickTheme.value = list.some((t) => t.id === state.theme) ? state.theme : '';
    renderRestyle();
  }

  els.themeGrid.addEventListener('click', (e) => {
    const card = e.target.closest('.theme-card');
    if (!card) return;
    state.theme = card.dataset.theme || '';
    renderThemes();
    renderStep();
    saveState();
  });
  els.quickTheme.addEventListener('change', () => { state.theme = els.quickTheme.value; renderThemes(); saveState(); });

  function renderAccent() {
    const cur = (state.accentColor || '').toLowerCase();
    const custom = cur && !ACCENTS.includes(cur);
    els.accentRow.innerHTML = `<button type="button" class="accent-auto${!cur ? ' on' : ''}" data-accent="" aria-pressed="${!cur}">Dal tema</button>
      ${ACCENTS.map((c) => `<button type="button" class="accent-dot${cur === c ? ' on' : ''}" data-accent="${c}" style="--dot:${c}" aria-label="Colore ${c}" aria-pressed="${cur === c}"></button>`).join('')}
      <label class="accent-custom${custom ? ' on' : ''}" title="Scegli un colore qualsiasi" style="${custom ? `--dot:${esc(cur)}` : ''}">
        <input type="color" id="accent-picker" value="${esc(cur || '#7c5cff')}" aria-label="Colore personalizzato"><span>🎨</span></label>
      ${cur ? `<span class="accent-value">${esc(cur)}</span><button type="button" class="btn small ghost" data-accent="">Ripristina</button>` : ''}`;
  }
  els.accentRow.addEventListener('click', (e) => {
    const b = e.target.closest('[data-accent]');
    if (!b) return;
    state.accentColor = b.dataset.accent;
    renderAccent();
    renderStep();
    saveState();
  });
  els.accentRow.addEventListener('input', (e) => {
    if (e.target.id !== 'accent-picker') return;
    state.accentColor = e.target.value.toLowerCase();
    const lab = e.target.closest('.accent-custom');
    lab.classList.add('on');
    lab.style.setProperty('--dot', state.accentColor);
    saveState();
  });
  els.accentRow.addEventListener('change', (e) => { if (e.target.id === 'accent-picker') { renderAccent(); renderStep(); } });

  function renderEngines() {
    els.engineCards.innerHTML = '';
    ENGINES.forEach((en) => {
      const disabled = en.id === 'offline' && !offlineAvailable();
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'engine-card';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(state.engine === en.id));
      b.dataset.engine = en.id;
      b.disabled = disabled;
      b.innerHTML = `<span class="en-icon" aria-hidden="true">${en.icon}</span><span><strong>${esc(en.title)}</strong><small>${esc(disabled ? 'Non disponibile: file offline mancanti.' : en.desc)}</small></span>`;
      els.engineCards.append(b);
    });
    els.quickEngine.innerHTML = ENGINES.map((en) => `<option value="${en.id}" ${en.id === 'offline' && !offlineAvailable() ? 'disabled' : ''}>${esc(en.id === 'offline' ? 'Offline (istantaneo)' : en.title)}</option>`).join('');
    els.quickEngine.value = state.engine;
  }
  els.engineCards.addEventListener('click', (e) => {
    const b = e.target.closest('.engine-card');
    if (!b || b.disabled) return;
    state.engine = b.dataset.engine;
    renderEngines();
    saveState();
  });
  els.quickEngine.addEventListener('change', () => { state.engine = els.quickEngine.value; renderEngines(); saveState(); });

  // ======================================================================
  // Passo 5: riepilogo
  // ======================================================================
  function renderSummary() {
    const c = findCat(state.category);
    const t = findTheme(state.theme) || findTheme(autoThemeId());
    const nItems = parseItems(state.items).length;
    const contacts = Object.entries(state.contacts).filter(([, v]) => String(v).trim()).length;
    const secs = state.sections.length ? state.sections.length : catDefaults(state.category || 'altro').length;
    const en = ENGINES.find((e) => e.id === state.engine);
    const row = (ok, label, val, step) => `<li class="${ok ? 'ok' : ''}"><span>${ok ? '✓' : '○'}</span><span>${label}</span><b>${val}</b>${step != null ? `<button type="button" class="link" data-goto="${step}">modifica</button>` : ''}</li>`;
    els.summary.innerHTML = `<h3>Riepilogo</h3><ul>
      ${row(!!state.name, 'Nome', esc(state.name || 'da inventare'), 0)}
      ${row(!!c, 'Tipo', c ? esc(c.emoji + ' ' + c.label) : 'lo capisco dal testo', 0)}
      ${row(!!state.description, 'Descrizione', state.description ? `${state.description.trim().split(/\s+/).length} parole` : 'scrivo io i testi', 0)}
      ${row(true, 'Sezioni', `${secs}`, 1)}
      ${row(nItems > 0, 'Voci', nItems ? String(nItems) : 'esempi plausibili', 1)}
      ${row(!!state.logo || state.photos.length > 0, 'Immagini', `${state.logo ? 'logo + ' : ''}${state.photos.length} foto`, 2)}
      ${row(!!state.theme, 'Stile', esc(t ? t.name : 'automatico') + (state.theme ? '' : ' (auto)'), 3)}
      ${row(true, 'Motore', esc(en ? en.title : state.engine), 3)}
      ${row(contacts > 0, 'Contatti', contacts ? String(contacts) : 'nessuno', null)}
    </ul>`;
  }
  els.summary.addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) goStep(Number(b.dataset.goto)); });

  // ======================================================================
  // Modalità veloce: avviso dati scheda + compilazione automatica
  // ======================================================================
  function wizardDataSummary() {
    const bits = [];
    if (state.name) bits.push(`nome «${state.name}»`);
    if (state.category) { const c = findCat(state.category); if (c) bits.push(c.label.toLowerCase()); }
    if (state.description) bits.push('descrizione');
    if (state.items.trim()) bits.push(`${parseItems(state.items).length} voci`);
    const n = Object.values(state.contacts).filter((v) => String(v).trim()).length;
    if (n) bits.push(`${n} contatti`);
    return bits;
  }
  function renderWizardHint() {
    const bits = wizardDataSummary();
    els.wizardHint.classList.toggle('hidden', !bits.length);
    if (bits.length) {
      els.wizardHint.innerHTML = `📝 Userò anche i dati della scheda guidata: ${esc(bits.join(', '))}. <button type="button" class="link" data-mode-go="guidata">Apri la scheda</button>`;
    }
  }
  els.wizardHint.addEventListener('click', (e) => { if (e.target.closest('[data-mode-go]')) setMode('guidata'); });

  function safeDetect(text) {
    if (typeof window.detectBrief !== 'function' || !text) return {};
    try { return window.detectBrief(text) || {}; } catch (err) { console.warn('detectBrief', err); return {}; }
  }

  function prefillFromIdea() {
    const idea = state.idea.trim();
    if (idea.length < 8) { setStatus('Scrivi prima la tua idea qui sopra (anche solo una frase).', 'error'); els.idea.focus(); return; }
    if (typeof window.detectBrief !== 'function') {
      if (!state.description) state.description = idea;
      setMode('guidata');
      goStep(0);
      fillInputs();
      setStatus('Ho copiato la tua idea nella scheda: completala passo per passo.', 'ok');
      return;
    }
    const d = safeDetect(idea);
    const filled = [];
    if (d.name && !state.name) { state.name = String(d.name); filled.push('f-name'); }
    if (d.tagline && !state.tagline) { state.tagline = String(d.tagline); filled.push('f-tagline'); }
    if (!state.description) { state.description = idea; filled.push('f-description'); }
    if (d.category && findCat(d.category) && !state.category) state.category = d.category;
    if (!state.sectionsCustom) {
      const secs = Array.isArray(d.sections) && d.sections.length ? d.sections.filter((s) => sectionsList().some((x) => x.id === s)) : catDefaults(state.category || 'altro');
      state.sections = secs;
    }
    const catTheme = (findCat(state.category) || {}).defaultTheme;
    if (d.theme && !state.theme && findTheme(d.theme) && d.theme !== catTheme) state.theme = d.theme;
    if (d.accentColor && !state.accentColor && /^#[0-9a-f]{6}$/i.test(d.accentColor)) state.accentColor = d.accentColor.toLowerCase();
    if (d.city && !state.contacts.address) state.contacts.address = String(d.city);
    state.mode = 'guidata';
    state.step = 0;
    saveState();
    renderAll();
    els.panelBody.scrollTop = 0;
    filled.forEach((id) => { const el = $(id); if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } });
    const tile = els.catGrid.querySelector('[aria-checked="true"]');
    if (tile) tile.classList.add('flash');
    setStatus('Ho compilato la scheda con quello che ho capito ✍️ Controlla e completa i passi.', 'ok');
  }

  // ======================================================================
  // Brief → motori
  // ======================================================================
  function buildBrief() {
    const s = state;
    const text = [s.idea, s.name && `chiamato "${s.name}"`, s.tagline, s.description].filter(Boolean).join('. ');
    const d = safeDetect(text);
    const category = s.category || (findCat(d.category) ? d.category : '') || 'altro';
    const cat = findCat(category);
    const theme = s.theme || (d.theme && findTheme(d.theme) && d.theme !== (cat && cat.defaultTheme) ? d.theme : '');
    const name = (s.name || d.name || '').trim();
    const idea = s.idea.trim() || [cat && cat.label, name, s.tagline, s.description].filter(Boolean).join(' — ');
    const secIds = sectionsList().map((x) => x.id);
    const sections = s.sections.length ? s.sections.slice() : (Array.isArray(d.sections) ? d.sections.filter((x) => secIds.includes(x)) : []);
    const contacts = {};
    Object.keys(s.contacts).forEach((k) => (contacts[k] = String(s.contacts[k] || '').trim()));
    return {
      idea,
      name,
      tagline: (s.tagline || d.tagline || '').trim(),
      description: s.description.trim(),
      category,
      theme,
      accentColor: /^#[0-9a-f]{6}$/i.test(s.accentColor) ? s.accentColor : (/^#[0-9a-f]{6}$/i.test(d.accentColor || '') ? d.accentColor : ''),
      sections,
      items: s.items.trim(),
      contacts,
      logo: s.logo || null,
      photos: s.photos.map((p) => ({ src: p.src, caption: (p.caption || '').trim() })),
    };
  }

  const textBrief = (b) => { const { logo, photos, ...t } = b; return clone(t); };
  const snapshotImages = (b) => ({ logo: b.logo || null, photos: (b.photos || []).map((p) => ({ src: p.src, caption: p.caption || '' })) });

  // ---------- Segnaposto immagini ----------
  const PLACEHOLDER_IMG = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#c7d2fe"/><stop offset="1" stop-color="#fbcfe8"/></linearGradient></defs><rect width="1200" height="800" fill="url(#g)"/><circle cx="880" cy="260" r="160" fill="#fff" opacity=".35"/><path d="M0 640 Q300 480 600 600 T1200 560 V800 H0Z" fill="#fff" opacity=".4"/></svg>');
  const PLACEHOLDER_LOGO = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#7c5cff"/><path d="M32 14l4 14 14 4-14 4-4 14-4-14-14-4 14-4z" fill="#fff"/></svg>');

  function substitute(raw, images) {
    if (!raw) return raw;
    const imgs = images || { logo: null, photos: [] };
    return raw
      .replace(/__LOGO__/g, () => imgs.logo || PLACEHOLDER_LOGO)
      .replace(/__FOTO_(\d{1,2})__/g, (m, n) => { const p = imgs.photos[Number(n) - 1]; return p ? p.src : PLACEHOLDER_IMG; });
  }

  function toPlaceholders(html, images) {
    let out = html;
    images.photos.forEach((p, i) => { if (p.src && p.src.length > 64) out = out.split(p.src).join(`__FOTO_${i + 1}__`); });
    if (images.logo && images.logo.length > 64) out = out.split(images.logo).join('__LOGO__');
    return out;
  }

  // ---------- Prompt AI ----------
  const SYSTEM_PROMPT = `Sei un web designer pluripremiato. Crei siti web completi, moderni e bellissimi, in italiano.
Regole:
- Rispondi SOLO con un unico file HTML completo, da <!DOCTYPE html> a </html>. Niente spiegazioni, niente markdown.
- Tutto il CSS dentro <style> e tutto il JavaScript dentro <script>, nello stesso file. Puoi usare Google Fonts tramite <link>, con font di riserva di sistema.
- Design da landing page premiata: scala tipografica decisa, spaziature generose, palette coerente, ombre leggere, angoli coerenti, sezioni varie (non tutte griglie di 3 card), hero d'impatto.
- Barra di navigazione fissa con link alle sezioni e menù a hamburger su telefono; scorrimento fluido; animazioni di comparsa allo scroll (IntersectionObserver) che rispettano prefers-reduced-motion.
- Responsive fino a 360px senza scorrimento orizzontale; HTML semantico, testi alternativi, contrasto accessibile.
- Footer con anno, contatti e social. Usa contenuti veri dalla scheda; dove manca qualcosa scrivi testi plausibili e specifici in italiano (mai lorem ipsum, mai "Prodotto A").`;

  function waLink(n) {
    let d = String(n || '').replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
    if (/^3\d{8,9}$/.test(d)) d = '39' + d;
    return d ? `https://wa.me/${d}` : '';
  }
  function igLink(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/instagram\.com/i.test(s)) return 'https://' + s.replace(/^\/+/, '');
    return 'https://instagram.com/' + s.replace(/^@/, '');
  }
  function fbLink(v) {
    const s = String(v || '').trim();
    if (!s) return '';
    if (/^https?:\/\//i.test(s)) return s;
    if (/facebook\.com|fb\.com/i.test(s)) return 'https://' + s.replace(/^\/+/, '');
    return 'https://facebook.com/' + s.replace(/^@/, '').replace(/\s+/g, '');
  }

  function buildPrompt(brief) {
    const cat = findCat(brief.category);
    const theme = findTheme(brief.theme) || (!brief.theme ? findTheme((cat || {}).defaultTheme) : null);
    const ui = catUi(brief.category);
    const L = [SYSTEM_PROMPT, '', '## Scheda del cliente'];
    if (brief.name) L.push(`- Nome: ${brief.name}`);
    L.push(`- Tipo di sito: ${cat ? cat.label : 'da capire dalla descrizione'}`);
    if (brief.tagline) L.push(`- Slogan (usalo nell'hero): ${brief.tagline}`);
    if (brief.description) L.push(`- Descrizione del cliente (riscrivila in modo professionale ma fedele, usala per «Chi siamo» e per i testi):\n${brief.description}`);
    if (brief.idea && brief.idea !== brief.description) L.push(`- Idea raccontata dal cliente:\n${brief.idea}`);
    const secs = brief.sections.length ? brief.sections : catDefaults(brief.category);
    if (secs.length) {
      L.push(`- Sezioni, in quest'ordine dopo l'hero iniziale: ${secs.map((id) => `${sectionLabel(id)} (id="${id}")`).join(', ')}.`);
      if (secs.includes('dove') && brief.contacts.address) L.push(`  Nella sezione «Dove siamo» inserisci una mappa con <iframe src="https://www.google.com/maps?q=${encodeURIComponent(brief.contacts.address)}&output=embed" loading="lazy"> e un pulsante «Apri in Maps» (https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(brief.contacts.address)}).`);
    }
    if (brief.items) L.push(`- ${ui.items} forniti dal cliente: usali TUTTI esattamente, con i prezzi indicati (formato "nome - prezzo" oppure "nome: descrizione"):\n${brief.items}`);

    const c = brief.contacts;
    const cl = [];
    if (c.phone) cl.push(`Telefono: ${c.phone} (link tel:${c.phone.replace(/[^\d+]/g, '')})`);
    if (c.whatsapp) cl.push(`WhatsApp: ${c.whatsapp} (link ${waLink(c.whatsapp)}) — aggiungi anche un pulsante WhatsApp fluttuante in basso a destra`);
    if (c.email) cl.push(`Email: ${c.email} (link mailto:${c.email}; il modulo contatti usa action="mailto:${c.email}")`);
    if (c.address) cl.push(`Indirizzo: ${c.address}`);
    if (c.instagram) cl.push(`Instagram: ${igLink(c.instagram)}`);
    if (c.facebook) cl.push(`Facebook: ${fbLink(c.facebook)}`);
    if (c.hours) cl.push(`Orari:\n${c.hours}`);
    if (cl.length) L.push('- Contatti veri (usali come link cliccabili):\n  ' + cl.join('\n  '));
    else L.push('- Nessun contatto fornito: il modulo contatti mostra solo un messaggio di ringraziamento, non inventare numeri o email reali.');

    if (theme) L.push(`- Stile visivo: «${theme.name}» — ${theme.description || ''}${theme.swatch ? ` Palette di riferimento: ${theme.swatch.join(', ')}.` : ''}`);
    else L.push('- Stile visivo: scegli tu quello più adatto al tipo di attività.');
    if (brief.accentColor) L.push(`- Colore principale del brand: ${brief.accentColor} (pulsanti, link, dettagli).`);

    L.push('', '## Immagini');
    if (brief.logo || brief.photos.length) {
      L.push("Le immagini vere le inserisco io dopo: usa ESATTAMENTE questi segnaposto come valore di src (o dentro url() nel CSS), senza cambiarli e senza inventarne altri.");
      if (brief.logo) L.push(`- __LOGO__ = logo${brief.name ? ' di ' + brief.name : ''}. Mettilo nella barra di navigazione (alto circa 40px) e nel footer, e aggiungi <link rel="icon" href="__LOGO__"> nel <head>.`);
      brief.photos.forEach((p, i) => {
        const role = i === 0 ? 'foto di copertina: usala grande nell\'hero (sfondo con velatura scura o immagine affiancata)' : i === 1 ? 'usala nella sezione «Chi siamo»' : 'usala nella galleria';
        L.push(`- __FOTO_${i + 1}__${p.caption ? ` — «${p.caption}»` : ''} — ${role}.`);
      });
      if (brief.photos.length) L.push('Se c\'è una galleria, mostra tutte le foto con le didascalie e un lightbox al clic (Esc per chiudere, frecce per scorrere). Per altre decorazioni usa gradienti CSS, forme SVG inline o emoji: niente altre immagini esterne.');
    }
    if (!brief.logo) L.push('- Nessun logo: crea un logotipo testuale elegante (o un monogramma) con il nome.');
    if (!brief.photos.length) L.push('- Nessuna foto caricata: usa https://picsum.photos/seed/PAROLA/LARGHEZZA/ALTEZZA (PAROLA diversa per ogni immagine, a tema) oppure illustrazioni SVG inline e gradienti.');
    L.push('', 'Rispondi solo con il file HTML completo.');
    return L.join('\n');
  }

  function buildRefinePrompt(raw, request, images) {
    const ph = [];
    if (images.logo) ph.push('__LOGO__');
    images.photos.forEach((p, i) => ph.push(`__FOTO_${i + 1}__${p.caption ? ` («${p.caption}»)` : ''}`));
    return `Sei un web designer esperto. Modifichi un sito esistente.
Regole:
- Rispondi SOLO con il file HTML completo aggiornato, da <!DOCTYPE html> a </html>. Niente spiegazioni, niente markdown.
- Applica la modifica richiesta e lascia invariato tutto il resto (testi, struttura, stile, script).
- I valori __LOGO__ e __FOTO_N__ sono segnaposto delle immagini dell'utente: mantienili ESATTAMENTE così.${ph.length ? ` Disponibili: ${ph.join(', ')}.` : ''}

Sito attuale:

${raw}

Modifica richiesta dall'utente:
${request}`;
  }

  // ======================================================================
  // Generazione
  // ======================================================================
  function extractHtml(text) {
    let t = text;
    const fence = t.match(/```(?:html)?\s*([\s\S]*?)(?:```|$)/i);
    if (fence && /<html|<!doctype/i.test(fence[1])) t = fence[1];
    const start = t.search(/<!doctype html|<html/i);
    if (start > 0) t = t.slice(start);
    const end = t.toLowerCase().lastIndexOf('</html>');
    if (end !== -1) t = t.slice(0, end + 7);
    return t.trim();
  }

  async function waitForPuter(ms = 8000) {
    const t0 = Date.now();
    while (!(window.puter && window.puter.ai) && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 120));
    return !!(window.puter && window.puter.ai);
  }

  async function runAI(prompt, model, images) {
    if (!(await waitForPuter())) {
      throw new Error('Il servizio AI gratuito (Puter) non si è caricato. Controlla la connessione o usa il motore Offline.');
    }
    const stream = await window.puter.ai.chat(prompt, { model, stream: true });
    let raw = '';
    let lastPaint = 0;
    const paint = (force) => {
      const now = Date.now();
      if (!force && now - lastPaint < 800) return;
      lastPaint = now;
      const partial = extractHtml(raw);
      els.codeText.textContent = codeDisplay(partial || raw);
      if (/<body/i.test(partial)) showHtml(substitute(partial, images), { partial: true });
      setStatus(`Sto scrivendo il sito… ${Math.round(raw.length / 1000)}k caratteri`, '', true);
    };
    if (stream && typeof stream[Symbol.asyncIterator] === 'function') {
      for await (const part of stream) {
        const piece = part && (part.text || (part.message && part.message.content) || '');
        if (piece) { raw += piece; paint(false); }
      }
    } else {
      // Alcune versioni restituiscono la risposta intera
      const m = stream && stream.message;
      raw = typeof stream === 'string' ? stream : (m && (typeof m.content === 'string' ? m.content : Array.isArray(m.content) ? m.content.map((x) => x.text || '').join('') : '')) || String(stream || '');
    }
    const html = extractHtml(raw);
    if (!/<html|<body/i.test(html)) throw new Error("L'AI non ha restituito un sito valido. Riprova.");
    return html;
  }

  function validateBrief() {
    const s = state;
    const words = [s.idea, s.name, s.tagline, s.description].join(' ').trim();
    if (words.length < 4 && !s.category) {
      setStatus('Raccontaci almeno il nome o una breve descrizione della tua idea 🙂', 'error');
      if (s.mode === 'veloce') els.idea.focus(); else { goStep(0); $('f-name').focus(); }
      return false;
    }
    return true;
  }

  async function generateSite() {
    if (busy || !validateBrief()) return;
    const engine = state.engine;
    const brief = buildBrief();
    const images = snapshotImages(brief);
    setBusy(true);
    try {
      let raw;
      if (!isAI(engine)) {
        if (!offlineAvailable()) throw new Error('Il motore Offline non è disponibile (file offline mancanti). Scegli un motore AI.');
        setStatus('Impagino il tuo sito…', '', true);
        await new Promise((r) => setTimeout(r, 30));
        const html = window.generateOffline(brief);
        if (typeof html !== 'string' || !/<html|<body/i.test(html)) throw new Error('Il motore offline non ha prodotto un sito valido.');
        raw = toPlaceholders(html, images);
      } else {
        setStatus("L'AI sta progettando il tuo sito… (la prima volta Puter può chiederti un accesso gratuito)", '', true);
        raw = await runAI(buildPrompt(brief), engine, images);
      }
      const title = brief.name || brief.tagline || brief.idea.slice(0, 60) || 'Il mio sito';
      current = { id: 'h' + Date.now().toString(36), raw, images, engine, brief: textBrief(brief), title, live: true };
      liveKey = '';
      previewScroll = 0;
      showCurrent();
      saveHistory(current);
      setStatus(isAI(engine) ? 'Fatto! Chiedi modifiche qui sotto l\'anteprima o scarica il sito.' : 'Fatto! Prova altri stili sotto l\'anteprima, chiedi modifiche o scarica il sito.', 'ok');
      revealPreviewOnMobile();
    } catch (err) {
      console.error(err);
      setStatus(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  // ---------- Anteprima dal vivo (motore offline) ----------
  // Dopo la prima creazione offline, ogni modifica alla scheda aggiorna subito l'anteprima.
  let liveKey = '';
  const saveHistoryLater = debounce(() => { if (current) saveHistory(current); }, 1500);
  const scheduleLive = debounce(() => {
    if (busy || !current || !current.live || isAI(current.engine) || isAI(state.engine) || !offlineAvailable()) return;
    const brief = buildBrief();
    if (!(brief.name || brief.description || brief.idea.length > 3)) return;
    const images = snapshotImages(brief);
    const key = JSON.stringify(textBrief(brief)) + '|' + (images.logo || '').length + '|' + images.photos.map((p) => p.src.length + p.caption).join(',');
    if (key === liveKey) return;
    try {
      const html = window.generateOffline(brief);
      if (typeof html !== 'string') return;
      liveKey = key;
      current = { ...current, raw: toPlaceholders(html, images), images, brief: textBrief(brief), title: brief.name || current.title };
      showCurrent({ keepScroll: true });
      saveHistoryLater();
    } catch (err) { console.warn('anteprima dal vivo', err); }
  }, 600);

  let previewScroll = 0;
  window.addEventListener('message', (e) => {
    if (e.source === els.preview.contentWindow && e.data && typeof e.data.ideasitoScroll === 'number') previewScroll = e.data.ideasitoScroll;
  });
  function withScrollKeeper(html, y) {
    const js = `<script>(function(){var y=${Math.max(0, Math.round(y || 0))};if(y){var go=function(){try{window.scrollTo({top:y,behavior:'instant'})}catch(e){window.scrollTo(0,y)}};if(document.readyState==='complete')go();else addEventListener('load',go);}var t;addEventListener('scroll',function(){clearTimeout(t);t=setTimeout(function(){parent.postMessage({ideasitoScroll:window.scrollY},'*')},120)},{passive:true});})();<\/script>`;
    const i = html.toLowerCase().lastIndexOf('</body>');
    return i === -1 ? html + js : html.slice(0, i) + js + html.slice(i);
  }

  async function restyle(themeId) {
    if (busy || !current || !offlineAvailable()) return;
    setBusy(true);
    try {
      const brief = { ...clone(current.brief), theme: themeId, logo: current.images.logo, photos: current.images.photos.map((p) => ({ ...p })) };
      const html = window.generateOffline(brief);
      current = { ...current, raw: toPlaceholders(html, current.images), brief: textBrief(brief), engine: 'offline' };
      state.theme = themeId;
      renderThemes();
      saveState();
      showCurrent({ keepScroll: true });
      saveHistory(current);
      const t = findTheme(themeId);
      setStatus(`Stile «${t ? t.name : themeId}» applicato ✓`, 'ok');
    } catch (err) {
      console.error(err);
      setStatus(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function refine() {
    const request = els.refine.value.trim();
    if (busy || !current) return;
    if (!request) { setStatus('Scrivi cosa vuoi cambiare nel riquadro sotto l\'anteprima.', 'error'); els.refine.focus(); return; }
    const model = isAI(current.engine) ? current.engine : els.refineModel.value;
    setBusy(true);
    setStatus('Applico la modifica…', '', true);
    try {
      const raw = await runAI(buildRefinePrompt(current.raw, request, current.images), model, current.images);
      current = { ...current, raw, engine: model, brief: { ...current.brief }, title: current.title, id: 'h' + Date.now().toString(36), note: request };
      showCurrent();
      saveHistory(current);
      els.refine.value = '';
      setStatus('Modifica applicata ✓', 'ok');
    } catch (err) {
      console.error(err);
      setStatus(friendlyError(err), 'error');
      if (currentHtml) showHtml(currentHtml, { keepScroll: true });
    } finally {
      setBusy(false);
    }
  }

  function friendlyError(err) {
    const msg = (err && (err.message || (err.error && err.error.message) || (typeof err === 'string' ? err : ''))) || '';
    if (/cancel|closed|denied/i.test(msg)) return "Accesso a Puter annullato. Serve un account gratuito Puter per usare l'AI, oppure usa il motore Offline.";
    if (/limit|quota|insufficient|credit/i.test(msg)) return 'Limite gratuito raggiunto per ora. Prova un altro motore, riprova più tardi o usa il motore Offline.';
    if (/Offline|Puter|AI non ha|motore/i.test(msg)) return msg;
    return 'Qualcosa è andato storto: ' + (msg || 'errore sconosciuto').replace(/\.$/, '') + '. Riprova o usa il motore Offline.';
  }

  // ======================================================================
  // Anteprima
  // ======================================================================
  function codeDisplay(html) {
    return String(html || '').replace(/data:([\w/+.-]+);base64,[A-Za-z0-9+/=]{300,}/g, (m, mime) => `data:${mime};base64,… [immagine ${kb(m.length * 0.75)}]`);
  }

  function showHtml(html, { partial = false, keepScroll = false } = {}) {
    if (!partial) currentHtml = html;
    els.empty.classList.add('hidden');
    if (!keepScroll && !partial) previewScroll = 0;
    els.preview.srcdoc = partial ? html : withScrollKeeper(html, previewScroll);
    if (!partial) els.codeText.textContent = codeDisplay(current ? current.raw : html);
    const view = document.querySelector('.tab.active').dataset.view;
    els.frameWrap.classList.toggle('hidden', view !== 'preview');
    els.code.classList.toggle('hidden', view !== 'code');
    [els.copy, els.open, els.download].forEach((b) => (b.disabled = partial || !html));
  }

  function showCurrent({ keepScroll = false } = {}) {
    if (!current) return;
    showHtml(substitute(current.raw, current.images), { keepScroll });
    els.refineBox.classList.remove('hidden');
    els.refineModel.classList.toggle('hidden', isAI(current.engine));
    renderRestyle();
  }

  function renderRestyle() {
    const show = current && !isAI(current.engine) && offlineAvailable() && themes().length > 0;
    els.restyle.classList.toggle('hidden', !show);
    $('live-hint').classList.toggle('hidden', !(show && current.live));
    if (!show) return;
    const active = current.brief.theme || (findCat(current.brief.category) || {}).defaultTheme;
    els.restyleList.innerHTML = themes().map((t) => {
      const sw = (t.swatch || []).slice(0, 3);
      return `<button type="button" class="restyle-btn${t.id === active ? ' on' : ''}" data-theme="${esc(t.id)}" aria-pressed="${t.id === active}" ${busy ? 'disabled' : ''}>
        <span class="rs-dots">${sw.map((c) => `<i style="background:${esc(c)}"></i>`).join('')}</span>${esc(t.name)}</button>`;
    }).join('');
  }
  els.restyleList.addEventListener('click', (e) => {
    const b = e.target.closest('.restyle-btn');
    if (b && !b.classList.contains('on')) restyle(b.dataset.theme);
  });

  function revealPreviewOnMobile() {
    if (window.matchMedia('(max-width: 900px)').matches) $('preview-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ======================================================================
  // Cronologia (localStorage, con gestione dello spazio)
  // ======================================================================
  function loadHistory() {
    try { const l = JSON.parse(localStorage.getItem(HISTORY_KEY)); return Array.isArray(l) ? l : []; } catch { return []; }
  }

  function trySave(list) {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); return true; } catch { return false; }
  }

  function saveHistory(entry) {
    const e = { id: entry.id, title: entry.title, note: entry.note || '', engine: entry.engine, at: Date.now(), raw: entry.raw, images: entry.images, brief: entry.brief };
    let list = loadHistory().filter((x) => x.id !== e.id);
    list.unshift(e);
    list = list.slice(0, MAX_HISTORY);
    let ok = trySave(list);
    // 1) togli le immagini dai siti più vecchi
    for (let i = list.length - 1; !ok && i > 0; i--) {
      if (list[i].images) { list[i] = { ...list[i], images: null, noImages: true }; ok = trySave(list); }
    }
    // 2) elimina i più vecchi
    while (!ok && list.length > 1) { list.pop(); ok = trySave(list); }
    // 3) salva il sito senza immagini
    if (!ok) { list[0] = { ...list[0], images: null, noImages: true }; ok = trySave(list); }
    if (!ok) toast('Spazio del browser esaurito: questo sito non è stato salvato nella cronologia. Scaricalo!', 'error');
    else if (list[0].noImages) toast('Salvato nella cronologia senza le foto (troppo pesanti per il browser).');
    renderHistory();
  }

  function renderHistory() {
    const list = loadHistory();
    els.historyList.innerHTML = '';
    if (!list.length) {
      els.historyList.innerHTML = '<li class="history-empty">Nessun sito ancora. Il primo che crei comparirà qui.</li>';
      return;
    }
    list.forEach((item) => {
      const li = document.createElement('li');
      const when = item.at ? new Date(item.at).toLocaleString('it-IT', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
      const en = item.engine ? (isAI(item.engine) ? 'AI' : 'Offline') : '';
      const t = item.brief && findTheme(item.brief.theme || (findCat(item.brief.category) || {}).defaultTheme);
      const title = item.title || item.idea || 'Sito';
      li.innerHTML = `<div class="h-main"><strong></strong><small></small></div>
        <div class="h-actions"><button type="button" class="btn small primary" data-h="open">Apri</button>${item.brief ? '<button type="button" class="btn small" data-h="brief" title="Carica la scheda di questo sito">Scheda</button>' : ''}<button type="button" class="btn small ghost danger" data-h="del" aria-label="Elimina">🗑</button></div>`;
      li.querySelector('strong').textContent = title + (item.note ? ' → ' + item.note : '');
      li.querySelector('small').textContent = [when, en, t && t.name, item.noImages ? 'senza foto' : ''].filter(Boolean).join(' · ');
      li.querySelector('[data-h="open"]').onclick = () => openHistory(item);
      const bb = li.querySelector('[data-h="brief"]');
      if (bb) bb.onclick = () => loadBriefFrom(item);
      li.querySelector('[data-h="del"]').onclick = () => { trySave(loadHistory().filter((x) => (item.id ? x.id !== item.id : x.at !== item.at))); renderHistory(); };
      els.historyList.append(li);
    });
  }

  function openHistory(item) {
    if (item.raw) {
      let images = item.images;
      let note = 'Sito caricato dalla cronologia.';
      if (!images) {
        const has = state.logo || state.photos.length;
        images = { logo: state.logo, photos: state.photos.map((p) => ({ src: p.src, caption: p.caption })) };
        note = has ? 'Le foto non erano salvate: ho usato quelle caricate ora.' : 'Le foto di questo sito non erano salvate (spazio esaurito).';
      }
      current = { id: item.id, raw: item.raw, images, engine: item.engine || 'offline', brief: item.brief || { theme: '', category: 'altro' }, title: item.title };
      showCurrent();
      setStatus(note, 'ok');
    } else if (item.html) {
      // voce della versione precedente
      current = { id: 'h' + (item.at || Date.now()).toString(36), raw: item.html, images: { logo: null, photos: [] }, engine: 'claude-sonnet-4', brief: { idea: item.idea, theme: '', category: 'altro' }, title: item.idea };
      showCurrent();
      setStatus('Sito caricato dalla cronologia.', 'ok');
    }
    els.historyDialog.close();
    revealPreviewOnMobile();
  }

  function loadBriefFrom(item) {
    const b = item.brief || {};
    const base = emptyState();
    state = {
      ...state,
      idea: b.idea || '', name: b.name || '', tagline: b.tagline || '', description: b.description || '',
      category: b.category || '', theme: b.theme || '', accentColor: b.accentColor || '',
      sections: Array.isArray(b.sections) ? b.sections.slice() : [], sectionsCustom: Array.isArray(b.sections) && b.sections.length > 0,
      items: b.items || '', contacts: { ...base.contacts, ...(b.contacts || {}) },
    };
    if (item.images) {
      state.logo = item.images.logo || null;
      state.photos = (item.images.photos || []).map((p) => ({ ...p }));
      saveImages();
    }
    state.mode = 'guidata';
    state.step = 0;
    saveState();
    renderAll();
    els.historyDialog.close();
    setStatus('Scheda caricata: modificala e crea una nuova versione.', 'ok');
  }

  $('history-open').addEventListener('click', () => { renderHistory(); els.historyDialog.showModal(); });
  $('history-close').addEventListener('click', () => els.historyDialog.close());
  els.historyDialog.addEventListener('click', (e) => { if (e.target === els.historyDialog) els.historyDialog.close(); });

  // ======================================================================
  // Azioni sul sito
  // ======================================================================
  function slug() {
    const base = (current && (current.brief.name || current.title)) || 'sito';
    return base.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'sito';
  }
  function download() {
    if (!currentHtml) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([currentHtml], { type: 'text/html;charset=utf-8' }));
    a.download = `${slug()}.html`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus(`Scaricato «${slug()}.html» ✓ Aprilo con il browser o pubblicalo gratis (es. GitHub Pages, Netlify Drop).`, 'ok');
  }
  function openNew() {
    if (!currentHtml) return;
    const url = URL.createObjectURL(new Blob([currentHtml], { type: 'text/html;charset=utf-8' }));
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(currentHtml);
      setStatus('Codice copiato negli appunti ✓', 'ok');
    } catch {
      setStatus('Impossibile copiare: usa «Scarica» oppure la scheda «Codice».', 'error');
    }
  }

  // ======================================================================
  // Riempimento dei campi e render generale
  // ======================================================================
  function fillInputs() {
    qsa('[data-bind]').forEach((el) => {
      const v = getPath(state, el.dataset.bind);
      if (document.activeElement !== el) el.value = v == null ? '' : v;
    });
  }

  function renderAll() {
    fillInputs();
    renderMode();
    renderCategories();
    renderCategoryTexts();
    renderSections();
    renderMedia();
    renderThemes();
    renderAccent();
    renderEngines();
    renderStep();
    renderWizardHint();
  }

  // ======================================================================
  // Eventi
  // ======================================================================
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset || !el.dataset.bind) return;
    setPath(state, el.dataset.bind, el.value);
    if (el.dataset.bind === 'items') renderItemsPreview();
    saveState();
    refreshLight();
  });
  const refreshLight = debounce(() => {
    qsa('#stepper li').forEach((li, i) => li.classList.toggle('done', i !== state.step && stepHasData(i)));
    els.next.textContent = stepHasData(state.step) ? 'Avanti →' : 'Salta →';
    if (state.step === STEP_COUNT - 1) renderSummary();
  }, 200);

  qsa('.mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  els.stepper.addEventListener('click', (e) => { const b = e.target.closest('[data-goto]'); if (b) goStep(Number(b.dataset.goto)); });
  els.prev.addEventListener('click', () => goStep(state.step - 1));
  els.next.addEventListener('click', () => goStep(state.step + 1));
  els.generate.addEventListener('click', generateSite);
  els.generateQuick.addEventListener('click', generateSite);
  els.prefill.addEventListener('click', prefillFromIdea);
  els.refineBtn.addEventListener('click', refine);
  els.download.addEventListener('click', download);
  els.open.addEventListener('click', openNew);
  els.copy.addEventListener('click', copy);

  $('use-example').addEventListener('click', () => {
    const ui = catUi(state.category);
    if (!state.description.trim()) state.description = ui.desc;
    if (!state.tagline.trim()) state.tagline = ui.tag;
    if (!state.items.trim()) state.items = ui.ph;
    fillInputs();
    renderItemsPreview();
    renderStep();
    saveState();
    ['f-description', 'f-tagline'].forEach((id) => { const el = $(id); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); });
    toast('Testo d\'esempio inserito: personalizzalo con i tuoi dettagli ✍️');
  });

  qsa('.example').forEach((b) => b.addEventListener('click', () => {
    state.idea = b.dataset.text;
    els.idea.value = state.idea;
    els.idea.focus();
    saveState();
  }));

  $('reset-all').addEventListener('click', () => {
    if (!confirm('Vuoi svuotare la scheda (testi, logo e foto) e ricominciare? I siti già creati restano in «I miei siti».')) return;
    const keepEngine = state.engine;
    state = emptyState();
    state.engine = keepEngine;
    try { localStorage.removeItem(STATE_KEY); } catch { /* ok */ }
    saveImages();
    renderAll();
    setStatus('Scheda svuotata. Si riparte! ✨', 'ok');
  });

  // Ctrl/Cmd + Invio
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !(e.ctrlKey || e.metaKey) || busy) return;
    if (e.target === els.refine) { e.preventDefault(); refine(); return; }
    if (e.target.closest && e.target.closest('.input-panel')) { e.preventDefault(); generateSite(); }
  });

  qsa('.tab').forEach((tab) => tab.addEventListener('click', () => {
    qsa('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    if (!currentHtml && !els.codeText.textContent) return;
    const isPreview = tab.dataset.view === 'preview';
    els.frameWrap.classList.toggle('hidden', !isPreview);
    els.code.classList.toggle('hidden', isPreview);
  }));

  qsa('.device').forEach((d) => d.addEventListener('click', () => {
    qsa('.device').forEach((x) => x.classList.toggle('active', x === d));
    els.preview.style.width = d.dataset.w;
  }));

  // ======================================================================
  // Avvio
  // ======================================================================
  loadState();
  renderAll();
  renderHistory();
  if (!themes().length || !offlineAvailable()) console.warn('IdeaSito: motore offline non disponibile.');
  loadImages().then(() => { renderMedia(); renderStep(); renderWizardHint(); });

  // utile per i test
  window.__ideasito = { getState: () => state, buildBrief, buildPrompt, substitute, toPlaceholders, getCurrent: () => current };
})();
