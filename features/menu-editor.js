/* IdeaSito — «Il tuo menù»: editor strutturato di categorie e voci (nome, descrizione, prezzo, etichette, foto).
   Vive nel passo 2 della scheda guidata. Il testo semplice (state.items) resta sempre sincronizzato,
   così il prompt AI e il vecchio codice continuano a funzionare.
   Stato:  state.menu = [{ id, category, items: [{ id, name, description, price, tags: [] }] }]
           state.menuSrc = il testo di state.items a cui corrisponde state.menu
   Foto:   IndexedDB ('ideasito' / 'kv' / 'menuPhotos') come { [itemId]: dataURL }
   Brief:  brief.menu = [{ category, items: [{ id, name, description, price, tags, photo }] }] */
(function () {
  'use strict';
  const IS = (window.IdeaSito = window.IdeaSito || {});
  if (!IS.getState) { console.warn('menu-editor: app.js non ha esposto window.IdeaSito.getState'); return; }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const st = () => IS.getState();
  const uid = () => 'm' + Math.random().toString(36).slice(2, 9);
  const norm = (s) => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const MAX_CATS = 24;
  const MAX_ITEMS = 200;

  // ───────────────────────── etichette ─────────────────────────
  const TAGS = [
    { id: 'veg', emoji: '🌱', label: 'Vegetariano', short: 'Veg', food: true, re: /\bvegetarian[oaie]\b|\((?:v|veg)\)/i },
    { id: 'vegan', emoji: '🌿', label: 'Vegano', short: 'Vegano', food: true, re: /\bvegan[oaie]?\b|\(vg\)/i },
    { id: 'hot', emoji: '🌶️', label: 'Piccante', short: 'Piccante', food: true, re: /🌶|\(piccante\)|\bmolto piccante\b/i },
    { id: 'gf', emoji: '🚫🌾', label: 'Senza glutine', short: 'No glutine', food: true, re: /senza glutine|gluten[\s-]?free|\(gf\)/i },
    { id: 'star', emoji: '⭐', label: 'Consigliato', short: 'Consigliato', re: /⭐|\(consigliat[oa]\)|\bconsigliat[oa] dallo chef\b/i },
    { id: 'new', emoji: '🆕', label: 'Novità', short: 'Novità', re: /🆕|\(novit[àa]\)|\(new\)|\bnovit[àa]\b\s*[!:]?$/i },
  ];
  const TAG_IDS = TAGS.map((t) => t.id);
  IS.MENU_TAGS = TAGS.map(({ id, emoji, label, short }) => ({ id, emoji, label, short }));

  const FOOD = new Set(['ristorante', 'bar', '']);
  function labels() {
    const c = st().category || '';
    if (c === 'ristorante') return { title: 'Il tuo menù', what: 'piatto', whatPl: 'piatti', ph: 'Es. Margherita', descPh: 'Es. pomodoro San Marzano, fior di latte, basilico', pricePh: '7€', sugg: ['Antipasti', 'Primi', 'Pizze', 'Secondi', 'Dolci', 'Bevande'], intro: 'Dividi i piatti in categorie: sul sito avranno una barra per saltare da una all\'altra.' };
    if (c === 'bar') return { title: 'Il tuo menù', what: 'prodotto', whatPl: 'prodotti', ph: 'Es. Cappuccino', descPh: 'Es. con latte di montagna', pricePh: '1,60€', sugg: ['Caffetteria', 'Colazione', 'Aperitivi', 'Bevande', 'Dolci'], intro: 'Dividi il menù in categorie: caffetteria, colazione, aperitivi…' };
    if (c === 'negozio') return { title: 'I tuoi prodotti', what: 'prodotto', whatPl: 'prodotti', ph: 'Es. Borsa in pelle', descPh: 'Es. pelle conciata al vegetale, fatta a mano', pricePh: '89€', sugg: ['Novità', 'Più venduti', 'Accessori', 'Saldi'], intro: 'Aggiungi i prodotti con prezzo e, se vuoi, una foto.' };
    if (c === 'evento') return { title: 'Il programma', what: 'momento', whatPl: 'momenti', ph: 'Es. 16:00 Cerimonia', descPh: 'Es. nella chiesa di San Rocco', pricePh: '', sugg: ['Sabato', 'Domenica'], intro: 'Scrivi i momenti della giornata, con l\'orario all\'inizio.' };
    if (c === 'portfolio' || c === 'personale') return { title: 'Progetti e servizi', what: 'voce', whatPl: 'voci', ph: 'Es. Reportage di matrimonio', descPh: 'Es. servizio completo, dalla preparazione alla festa', pricePh: 'da 150€', sugg: ['Servizi', 'Progetti'], intro: 'Elenca servizi o progetti, con prezzo se vuoi.' };
    return { title: 'Servizi e listino', what: 'servizio', whatPl: 'servizi', ph: 'Es. Taglio e piega', descPh: 'Es. shampoo, taglio e piega con prodotti naturali', pricePh: 'da 35€', sugg: ['Servizi', 'Pacchetti', 'Abbonamenti'], intro: 'Elenca i tuoi servizi con descrizione e prezzo: diventano il listino del sito.' };
  }
  const tagsForCat = () => (FOOD.has(st().category || '') ? TAGS : TAGS.filter((t) => !t.food));

  // ───────────────────────── parser del testo (incolla / OCR / sincronizzazione) ─────────────────────────
  const PRICE_RE = /(^|[\s\-–—|:·.…_]+)((?:da\s+|a partire da\s+|dai\s+)?(?:€\s?\d{1,4}(?:[.,]\d{1,2})?|\d{1,4}(?:[.,]\d{1,2})?\s?(?:€|euro\b|eur\b)?)(?:\s?(?:\/|al\s|a\s|alla\s)\s?[a-zà]{1,10}\.?)?|gratis|gratuit[oa]|su richiesta|incluso|inclusa|offerta libera)\s*$/i;

  function fmtPrice(p) {
    p = String(p || '').replace(/\s+/g, ' ').trim().replace(/\s*\b(euro|eur)\b/i, '€');
    p = p.replace(/€\s?(\d[\d.,]*)/, '$1€').replace(/(\d)\s+€/, '$1€');
    if (/^(?:da\s+|a partire da\s+|dai\s+)?\d{1,4}(?:[.,]\d{1,2})?$/i.test(p)) p += '€';
    return p;
  }

  function findPrice(l) {
    const m = l.match(PRICE_RE);
    if (!m) return null;
    const start = m.index + m[1].length;
    const before = l.slice(0, m.index + m[1].length);
    const val = m[2];
    if (/\d[:.]$/.test(before.replace(/\s+$/, '')) && !/[€]/.test(val) && !/\s[-–—]\s*$/.test(before)) return null; // orari tipo 16:00
    if (/^(19|20)\d\d$/.test(val.trim())) return null; // anni
    if (!/[\p{L}\p{N}]/u.test(l.slice(0, m.index))) return { price: fmtPrice(val), rest: '' };
    return { price: fmtPrice(val), rest: l.slice(0, start).replace(/[\s\-–—|:·.…_]+$/, '').trim() };
  }

  function extractTags(l) {
    const tags = [];
    TAGS.forEach((t) => { if (t.re.test(l)) tags.push(t.id); });
    let out = l
      .replace(/🌱|🌿|🌶️?|🚫🌾|⭐️?|🆕/g, ' ')
      .replace(/\((?:\s*(?:v|veg|vg|gf|new|piccante|vegetarian[oa]|vegan[oa]|senza glutine|gluten[\s-]?free|novit[àa]|consigliat[oa])\s*[,/]?\s*)+\)/gi, ' ')
      .replace(/\s{2,}/g, ' ').trim();
    return { text: out, tags };
  }

  const isCaps = (l) => { const letters = l.replace(/[^\p{L}]/gu, ''); return letters.length >= 3 && letters === letters.toUpperCase() && letters !== letters.toLowerCase(); };
  const cap1 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const niceCat = (s) => { s = s.replace(/[:\s]+$/, '').trim(); return isCaps(s) ? cap1(s.toLowerCase()) : s; };
  const niceName = (s) => (isCaps(s) && s.length > 3 ? cap1(s.toLowerCase()) : s);

  function parseMenuText(text) {
    const lines = String(text || '').split(/\r?\n/).map((r) => r.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim())
      .map((l) => l.replace(/^(?:[*•·▪◦–]|-(?=\s)|\d{1,2}[.)](?=\s))\s*/, '').trim());
    const priced = lines.map((l) => !!(l && findPrice(l) && findPrice(l).rest));
    const nonEmpty = lines.filter(Boolean).length;
    const pricedRatio = nonEmpty ? priced.filter(Boolean).length / nonEmpty : 0;
    const cats = [];
    let cur = null;
    const newCat = (name) => { cur = { id: uid(), category: niceCat(name), items: [] }; cats.push(cur); };
    const ensureCat = () => { if (!cur) { cur = { id: uid(), category: '', items: [] }; cats.push(cur); } return cur; };
    const nextIdx = (i) => { for (let k = i + 1; k < lines.length; k++) if (lines[k]) return k; return -1; };

    lines.forEach((l, i) => {
      if (!l) return;
      const h = l.match(/^#+\s*(.+)$/) || l.match(/^\[(.+)\]$/) || l.match(/^=+\s*(.+?)\s*=*$/) || l.match(/^([^:]{2,40}):$/);
      if (h) { newCat(h[1]); return; }
      const t = extractTags(l);
      let s = t.text;
      const pr = findPrice(s);
      const last = cur && cur.items[cur.items.length - 1];
      // riga con solo il prezzo (tipico delle foto): va alla voce precedente
      if (pr && !pr.rest) { if (last && !last.price) last.price = pr.price; return; }
      let price = '';
      if (pr) { price = pr.price; s = pr.rest; }
      // titolo di categoria: tutto maiuscolo senza prezzo, oppure riga breve seguita da voci con prezzo
      if (!price && !t.tags.length) {
        const words = s.split(/\s+/).length;
        const nx = nextIdx(i);
        if (isCaps(s) && words <= 5 && s.length <= 40) { newCat(s); return; }
        if (pricedRatio >= 0.5 && words <= 3 && /^[\p{Lu}\d]/u.test(s) && !/[:,;]/.test(s) && nx > -1 && priced[nx]) { newCat(s); return; }
        // riga che continua la descrizione della voce precedente
        if (last && !last.description && (/^[\p{Ll}(]/u.test(s))) { last.description = cap1(s.replace(/^\((.*)\)$/, '$1')); return; }
      }
      // orario in testa (programmi di eventi): resta nel nome
      let pre = '';
      const tm = s.match(/^((?:ore\s+)?\d{1,2}[:.]\d{2}(?:\s*[-–]\s*\d{1,2}[:.]\d{2})?)\s*[-–—|]?\s+(.+)$/i);
      if (tm) { pre = tm[1] + ' '; s = tm[2]; }
      let name = s, description = '';
      const sm = s.match(/^(.{1,90}?)\s*(?::\s+|:(?=\S)|\s[-–—]\s)\s*(.+)$/);
      if (sm && !/^\d{1,2}$/.test(sm[1])) { name = sm[1].trim(); description = sm[2].trim(); }
      else {
        const pm = s.match(/^(.{2,90}?)\s*\(([^)]{3,})\)$/);
        if (pm) { name = pm[1].trim(); description = pm[2].trim(); }
      }
      name = pre + niceName(name.replace(/[\s\-–—:|·.…_]+$/, ''));
      if (!name) return;
      ensureCat().items.push({ id: uid(), name, description: cap1(description), price, tags: t.tags });
    });
    return cats.filter((c) => c.items.length || c.category);
  }

  function serialize(menu) {
    const out = [];
    (menu || []).forEach((c, ci) => {
      const items = (c.items || []).filter((it) => String(it.name || '').trim());
      const cat = String(c.category || '').replace(/[:\n]/g, ' ').trim();
      if (!items.length && !cat) return;
      if (cat) { if (out.length) out.push(''); out.push(cat + ':'); }
      items.forEach((it) => {
        const name = String(it.name).replace(/:(?!\d)|\n/g, ' ').replace(/\s+/g, ' ').trim();
        const d = String(it.description || '').replace(/\n/g, ' ').trim();
        const p = String(it.price || '').replace(/\n/g, ' ').trim();
        out.push(name + (d ? ': ' + d : '') + (p ? ' - ' + p : ''));
      });
    });
    return out.join('\n').trim();
  }

  // ───────────────────────── modello ─────────────────────────
  function cleanMenu(m) {
    return (Array.isArray(m) ? m : []).slice(0, MAX_CATS).map((c) => ({
      id: typeof c.id === 'string' ? c.id : uid(),
      category: String(c.category || ''),
      items: (Array.isArray(c.items) ? c.items : []).slice(0, MAX_ITEMS).map((it) => ({
        id: typeof it.id === 'string' ? it.id : uid(),
        name: String(it.name || ''), description: String(it.description || it.desc || ''), price: String(it.price || ''),
        tags: (Array.isArray(it.tags) ? it.tags : []).filter((x) => TAG_IDS.includes(x)),
      })),
    }));
  }

  // allinea state.menu a state.items quando il testo è cambiato altrove (esempio, cronologia, campo di testo)
  function reconcile() {
    const s = st();
    if (!Array.isArray(s.menu)) s.menu = [];
    const items = String(s.items || '');
    if (s.menuSrc === items) return false;
    if (serialize(s.menu) === items.trim()) { s.menuSrc = items; return false; }
    const old = new Map();
    s.menu.forEach((c) => c.items.forEach((it) => old.set(norm(it.name), it)));
    const parsed = parseMenuText(items);
    parsed.forEach((c) => c.items.forEach((it) => {
      const o = old.get(norm(it.name));
      if (o) { it.id = o.id; it.tags = Array.from(new Set([...(o.tags || []), ...it.tags])); }
    }));
    s.menu = parsed;
    s.menuSrc = items;
    return true;
  }

  function getMenu() { reconcile(); return st().menu; }

  function commit({ rerender = false } = {}) {
    const s = st();
    s.items = serialize(s.menu);
    s.menuSrc = s.items;
    const ta = $('f-items');
    if (ta && document.activeElement !== ta) ta.value = s.items;
    IS.save && IS.save();
    IS.refreshLight && IS.refreshLight();
    if (rerender) render(); else renderCount();
  }

  // ───────────────────────── foto delle voci (IndexedDB) ─────────────────────────
  let photos = {};
  const pdb = {
    open() {
      return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error('no idb'));
        const r = indexedDB.open('ideasito', 1);
        r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv'); };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async get() {
      const db = await this.open();
      return new Promise((resolve) => { const q = db.transaction('kv', 'readonly').objectStore('kv').get('menuPhotos'); q.onsuccess = () => resolve(q.result); q.onerror = () => resolve(null); });
    },
    async set(v) {
      const db = await this.open();
      return new Promise((resolve) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, 'menuPhotos'); tx.oncomplete = resolve; tx.onerror = resolve; });
    },
  };
  function savePhotos() {
    const alive = new Set();
    (st().menu || []).forEach((c) => c.items.forEach((it) => alive.add(it.id)));
    const keep = {};
    Object.keys(photos).forEach((k) => { if (alive.has(k)) keep[k] = photos[k]; });
    photos = keep;
    pdb.set(keep).catch(() => {});
  }

  async function compress(file) {
    if (IS.compressImage) return (await IS.compressImage(file, { max: 600, mime: 'image/jpeg', quality: 0.8, background: '#ffffff' })).src;
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      const sc = Math.min(1, 600 / Math.max(img.naturalWidth, img.naturalHeight));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.naturalWidth * sc); cv.height = Math.round(img.naturalHeight * sc);
      const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height);
      return cv.toDataURL('image/jpeg', 0.8);
    } finally { URL.revokeObjectURL(url); }
  }

  // ───────────────────────── UI ─────────────────────────
  const collapsed = new Set();
  const openTags = new Set();
  let root = null;

  function mount() {
    const ta = $('f-items');
    if (!ta || root) return;
    const field = ta.closest('label') || ta.parentElement;
    const step = ta.closest('.step');
    if (step) step.classList.add('me-on');
    field.classList.add('me-textfield');
    root = document.createElement('div');
    root.className = 'me';
    root.id = 'menu-editor';
    field.parentNode.insertBefore(root, field);
    root.addEventListener('input', onInput);
    root.addEventListener('click', onClick);
    root.addEventListener('change', onChange);
    // il campo di testo nascosto resta come alternativa: ogni modifica lì aggiorna l'editor
    ta.addEventListener('input', () => setTimeout(() => { if (reconcile()) render(); }, 0));
  }

  function tagChip(t, on, ci, ii) {
    return `<button type="button" class="me-tag${on ? ' on' : ''}" data-act="tag" data-ci="${ci}" data-ii="${ii}" data-tag="${t.id}" aria-pressed="${on}" aria-label="${esc(t.label)}" title="${esc(t.label)}"><span aria-hidden="true">${t.emoji}</span><span class="me-tag-l">${esc(t.short)}</span></button>`;
  }

  function itemHTML(it, ci, ii, n, L) {
    const ph = photos[it.id];
    const tl = tagsForCat();
    const extra = (it.tags || []).filter((x) => !tl.some((t) => t.id === x)).map((x) => TAGS.find((t) => t.id === x)).filter(Boolean);
    return `<li class="me-item" data-ci="${ci}" data-ii="${ii}">
<div class="me-r1">
  <div class="me-ph-wrap">${ph
    ? `<button type="button" class="me-ph has" data-act="photo" data-ci="${ci}" data-ii="${ii}" title="Cambia foto" style="background-image:url('${esc(ph)}')"><span class="sr">Cambia foto</span></button><button type="button" class="me-ph-x" data-act="photo-del" data-ci="${ci}" data-ii="${ii}" aria-label="Togli la foto">✕</button>`
    : `<button type="button" class="me-ph" data-act="photo" data-ci="${ci}" data-ii="${ii}" title="Aggiungi una foto (facoltativa)" aria-label="Aggiungi una foto">📷</button>`}</div>
  <input type="text" class="me-name" data-f="name" data-ci="${ci}" data-ii="${ii}" value="${esc(it.name)}" placeholder="${esc(L.ph)}" aria-label="Nome" maxlength="90">
  <input type="text" class="me-price" data-f="price" data-ci="${ci}" data-ii="${ii}" value="${esc(it.price)}" placeholder="${esc(L.pricePh || 'Prezzo')}" aria-label="Prezzo" maxlength="24">
</div>
<input type="text" class="me-desc" data-f="description" data-ci="${ci}" data-ii="${ii}" value="${esc(it.description)}" placeholder="${ci === 0 && ii === 0 ? 'Descrizione (facoltativa) · ' + esc(L.descPh) : 'Descrizione (facoltativa)'}" aria-label="Descrizione" maxlength="220">
<div class="me-r3">
  <div class="me-tags">${openTags.has(it.id)
    ? tl.concat(extra).map((t) => tagChip(t, (it.tags || []).includes(t.id), ci, ii)).join('') + `<button type="button" class="me-tag me-tag-more" data-act="tags" data-ci="${ci}" data-ii="${ii}" aria-expanded="true">Fatto</button>`
    : (it.tags || []).map((x) => TAGS.find((t) => t.id === x)).filter(Boolean).map((t) => tagChip(t, true, ci, ii)).join('') + `<button type="button" class="me-tag me-tag-more" data-act="tags" data-ci="${ci}" data-ii="${ii}" aria-expanded="false">🏷️ ${(it.tags || []).length ? '+' : 'Etichette'}</button>`}</div>
  <div class="me-acts">
    <button type="button" class="mini" data-act="item-up" data-ci="${ci}" data-ii="${ii}" aria-label="Sposta su" ${ii === 0 ? 'disabled' : ''}>↑</button>
    <button type="button" class="mini" data-act="item-down" data-ci="${ci}" data-ii="${ii}" aria-label="Sposta giù" ${ii === n - 1 ? 'disabled' : ''}>↓</button>
    <button type="button" class="mini danger" data-act="item-del" data-ci="${ci}" data-ii="${ii}" aria-label="Elimina">✕</button>
  </div>
</div></li>`;
  }

  function catHTML(c, ci, n, L) {
    const closed = collapsed.has(c.id);
    const cnt = c.items.filter((it) => it.name.trim()).length;
    return `<section class="me-cat${closed ? ' closed' : ''}" data-ci="${ci}">
<div class="me-cat-h">
  <button type="button" class="me-fold" data-act="fold" data-ci="${ci}" aria-expanded="${!closed}" aria-label="${closed ? 'Apri' : 'Chiudi'} la categoria">${closed ? '▸' : '▾'}</button>
  <input type="text" class="me-cat-name" data-f="category" data-ci="${ci}" value="${esc(c.category)}" placeholder="${n > 1 ? 'Nome della categoria' : 'Categoria (facoltativa), es. ' + esc(L.sugg[0])}" aria-label="Nome della categoria" maxlength="40">
  <span class="me-cnt" title="${cnt} ${esc(cnt === 1 ? L.what : L.whatPl)}">${cnt}</span>
  <button type="button" class="mini" data-act="cat-up" data-ci="${ci}" aria-label="Sposta categoria su" ${ci === 0 ? 'disabled' : ''}>↑</button>
  <button type="button" class="mini" data-act="cat-down" data-ci="${ci}" aria-label="Sposta categoria giù" ${ci === n - 1 ? 'disabled' : ''}>↓</button>
  <button type="button" class="mini danger" data-act="cat-del" data-ci="${ci}" aria-label="Elimina categoria">🗑</button>
</div>
<div class="me-cat-b"${closed ? ' hidden' : ''}>
  <ol class="me-items">${c.items.map((it, ii) => itemHTML(it, ci, ii, c.items.length, L)).join('')}</ol>
  <button type="button" class="me-add-item" data-act="item-add" data-ci="${ci}">+ Aggiungi ${esc(L.what)}${c.category.trim() ? ` in «${esc(c.category.trim())}»` : ''}</button>
</div></section>`;
  }

  function counts() {
    const m = st().menu || [];
    const items = m.reduce((a, c) => a + c.items.filter((it) => it.name.trim()).length, 0);
    const cats = m.filter((c) => c.category.trim()).length;
    return { items, cats };
  }
  function countText() {
    const L = labels(); const { items, cats } = counts();
    if (!items) return 'Ancora vuoto';
    return `${items} ${items === 1 ? L.what : L.whatPl}${cats ? ` · ${cats} ${cats === 1 ? 'categoria' : 'categorie'}` : ''}`;
  }
  function renderCount() { const el = root && root.querySelector('.me-sum'); if (el) el.textContent = countText(); }

  function hasOCR() { return !!(window.puter && window.puter.ai && typeof window.puter.ai.img2txt === 'function'); }

  function render() {
    if (!root) return;
    reconcile();
    const L = labels();
    const m = st().menu;
    const active = document.activeElement;
    const keep = active && root.contains(active) && active.dataset && active.dataset.f ? { f: active.dataset.f, ci: active.dataset.ci, ii: active.dataset.ii, pos: active.selectionStart } : null;
    const used = new Set(m.map((c) => norm(c.category)));
    const sugg = L.sugg.filter((s) => !used.has(norm(s))).slice(0, 5);
    const empty = !m.some((c) => c.items.length);
    root.innerHTML = `<div class="me-head">
  <div class="me-ttl"><strong>${esc(L.title)}</strong><small class="me-sum">${esc(countText())}</small></div>
  <div class="me-tools">
    <button type="button" class="btn small" data-act="paste">📋 Incolla il tuo ${esc(L.title.replace(/^(Il tuo |I tuoi |Il )/, '').toLowerCase())}</button>
    <button type="button" class="btn small" data-act="ocr"${hasOCR() ? '' : ' hidden'}>📷 Carica foto del menù</button>
  </div>
</div>
${empty ? `<div class="me-empty"><p>${esc(L.intro)}</p><p class="me-empty-sub">Hai già un ${esc(L.title.includes('menù') ? 'menù' : 'listino')}? Incollalo così com'è: lo sistemo io in categorie e prezzi.</p>
<div class="me-empty-acts"><button type="button" class="btn small primary" data-act="item-add" data-ci="0">+ Aggiungi ${esc(L.what === 'voce' ? 'la prima voce' : 'il primo ' + L.what)}</button><button type="button" class="btn small outline" data-act="paste">📋 Incolla testo</button></div></div>` : ''}
<div class="me-cats">${empty ? '' : m.map((c, ci) => catHTML(c, ci, m.length, L)).join('')}</div>
${empty ? '' : `<div class="me-add-cat"><button type="button" class="btn small ghost" data-act="cat-add">+ Nuova categoria</button>${sugg.map((s) => `<button type="button" class="chip me-sugg" data-act="cat-add" data-name="${esc(s)}">+ ${esc(s)}</button>`).join('')}</div>`}
<div class="me-foot"><button type="button" class="link" data-act="text">${root.classList.contains('show-text') ? 'Nascondi il testo' : '✎ Modifica come testo semplice'}</button>${empty ? '' : '<button type="button" class="link me-clear" data-act="clear">Svuota</button>'}</div>
<input type="file" accept="image/*" class="me-file" hidden>`;
    if (keep) {
      const sel = `[data-f="${keep.f}"][data-ci="${keep.ci}"]` + (keep.ii != null ? `[data-ii="${keep.ii}"]` : ':not([data-ii])');
      const el = root.querySelector(sel);
      if (el) { el.focus(); try { el.setSelectionRange(keep.pos, keep.pos); } catch { /* ok */ } }
    }
  }

  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.f) return;
    const m = st().menu;
    const c = m[+el.dataset.ci];
    if (!c) return;
    if (el.dataset.f === 'category') {
      c.category = el.value;
      const add = el.closest('.me-cat').querySelector('.me-add-item');
      if (add) add.textContent = `+ Aggiungi ${labels().what}${c.category.trim() ? ` in «${c.category.trim()}»` : ''}`;
    } else {
      const it = c.items[+el.dataset.ii];
      if (!it) return;
      it[el.dataset.f] = el.value;
      if (el.dataset.f === 'name') { const cnt = el.closest('.me-cat').querySelector('.me-cnt'); if (cnt) cnt.textContent = c.items.filter((x) => x.name.trim()).length; }
    }
    commit();
  }

  function onChange(e) {
    const el = e.target;
    if (el.classList.contains('me-file') && el.files && el.files[0]) {
      const target = pendingPhoto; pendingPhoto = null;
      const file = el.files[0]; el.value = '';
      if (target === 'ocr') return runOCR(file);
      if (!target) return;
      compress(file).then((src) => {
        photos[target] = src; savePhotos(); render(); commit();
        IS.toast && IS.toast('Foto aggiunta ✓');
      }).catch((err) => IS.toast && IS.toast(err.message || 'Non riesco a leggere la foto', 'error'));
    }
  }

  let pendingPhoto = null;
  function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !root.contains(b)) return;
    const act = b.dataset.act;
    const m = st().menu;
    const ci = +b.dataset.ci, ii = +b.dataset.ii;
    const c = m[ci];
    const swap = (arr, a, z) => { if (z < 0 || z >= arr.length) return; const t = arr[a]; arr[a] = arr[z]; arr[z] = t; };
    const focusLater = (sel) => setTimeout(() => { const el = root.querySelector(sel); if (el) { el.focus(); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); } }, 0);
    switch (act) {
      case 'item-add': {
        let cat = c;
        if (!cat) { cat = { id: uid(), category: '', items: [] }; m.push(cat); }
        if (cat.items.length >= MAX_ITEMS) return;
        cat.items.push({ id: uid(), name: '', description: '', price: '', tags: [] });
        collapsed.delete(cat.id);
        commit({ rerender: true });
        focusLater(`.me-name[data-ci="${m.indexOf(cat)}"][data-ii="${cat.items.length - 1}"]`);
        break;
      }
      case 'item-del': {
        const it = c && c.items[ii];
        if (!it) return;
        if ((it.name.trim() || it.description.trim()) && !confirm(`Eliminare «${it.name.trim() || 'questa voce'}»?`)) return;
        c.items.splice(ii, 1); delete photos[it.id]; savePhotos();
        commit({ rerender: true });
        break;
      }
      case 'item-up': swap(c.items, ii, ii - 1); commit({ rerender: true }); focusLater(`[data-act="item-up"][data-ci="${ci}"][data-ii="${Math.max(0, ii - 1)}"]:not([disabled]), [data-act="item-down"][data-ci="${ci}"][data-ii="${Math.max(0, ii - 1)}"]`); break;
      case 'item-down': swap(c.items, ii, ii + 1); commit({ rerender: true }); focusLater(`[data-act="item-down"][data-ci="${ci}"][data-ii="${ii + 1}"]:not([disabled]), [data-act="item-up"][data-ci="${ci}"][data-ii="${ii + 1}"]`); break;
      case 'tag': {
        const it = c.items[ii]; const t = b.dataset.tag;
        it.tags = it.tags.includes(t) ? it.tags.filter((x) => x !== t) : it.tags.concat(t);
        b.classList.toggle('on'); b.setAttribute('aria-pressed', String(it.tags.includes(t)));
        // le voci senza testo non cambiano il testo: forza comunque l'anteprima
        commit();
        break;
      }
      case 'tags': {
        const id = c.items[ii].id;
        if (openTags.has(id)) openTags.delete(id); else openTags.add(id);
        render();
        focusLater(`[data-act="tags"][data-ci="${ci}"][data-ii="${ii}"]`);
        break;
      }
      case 'photo': pendingPhoto = c.items[ii].id; root.querySelector('.me-file').click(); break;
      case 'photo-del': delete photos[c.items[ii].id]; savePhotos(); commit({ rerender: true }); break;
      case 'cat-add': {
        if (m.length >= MAX_CATS) return;
        const name = b.dataset.name || '';
        // se c'è una sola categoria senza nome, la prima proposta la battezza
        if (name && m.length === 1 && !m[0].category.trim() && m[0].items.length) m[0].category = name;
        else m.push({ id: uid(), category: name, items: [{ id: uid(), name: '', description: '', price: '', tags: [] }] });
        commit({ rerender: true });
        focusLater(name ? `.me-name[data-ci="${m.length - 1}"][data-ii="0"]` : `.me-cat-name[data-ci="${m.length - 1}"]`);
        break;
      }
      case 'cat-del': {
        const n = c.items.filter((x) => x.name.trim()).length;
        if (n && !confirm(`Eliminare la categoria «${c.category.trim() || 'senza nome'}» e le sue ${n} voci?`)) return;
        m.splice(ci, 1); savePhotos(); commit({ rerender: true });
        break;
      }
      case 'cat-up': swap(m, ci, ci - 1); commit({ rerender: true }); break;
      case 'cat-down': swap(m, ci, ci + 1); commit({ rerender: true }); break;
      case 'fold': if (collapsed.has(c.id)) collapsed.delete(c.id); else collapsed.add(c.id); render(); break;
      case 'paste': openPaste(''); break;
      case 'ocr': pendingPhoto = 'ocr'; root.querySelector('.me-file').click(); break;
      case 'text': root.classList.toggle('show-text'); render(); if (root.classList.contains('show-text')) { const ta = $('f-items'); ta.value = st().items; ta.focus(); } break;
      case 'clear':
        if (!confirm('Svuotare tutto l\'elenco? Puoi sempre incollarlo di nuovo.')) return;
        st().menu = []; photos = {}; savePhotos(); commit({ rerender: true });
        break;
      default: break;
    }
  }

  // ───────────────────────── incolla / foto del menù ─────────────────────────
  let dlg = null;
  function ensureDialog() {
    if (dlg) return dlg;
    dlg = document.createElement('dialog');
    dlg.className = 'dialog me-dialog';
    dlg.setAttribute('aria-labelledby', 'me-dlg-t');
    dlg.innerHTML = `<div class="dialog-head"><h2 id="me-dlg-t">Incolla il tuo menù</h2><button type="button" class="icon-btn" data-x aria-label="Chiudi">✕</button></div>
<p class="sub">Copia il testo da un PDF, da Word o da un messaggio: una voce per riga. Le righe in MAIUSCOLO o che finiscono con «:» diventano categorie.</p>
<textarea class="me-paste" rows="8" placeholder="PIZZE&#10;Margherita - pomodoro, mozzarella, basilico - 7€&#10;Diavola 8,50 (piccante)&#10;&#10;Dolci:&#10;Tiramisù della casa 5"></textarea>
<div class="me-pv" aria-live="polite"></div>
<div class="me-dlg-foot"><label class="me-mode"><input type="checkbox" class="me-append"> Aggiungi in fondo invece di sostituire</label><div class="me-dlg-btns"><button type="button" class="btn small ghost" data-x>Annulla</button><button type="button" class="btn small primary me-ok" disabled>Usa questo menù</button></div></div>`;
    document.body.append(dlg);
    const ta = dlg.querySelector('.me-paste');
    ta.addEventListener('input', previewPaste);
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-x]')) dlg.close(); });
    dlg.querySelector('.me-ok').addEventListener('click', () => {
      const parsed = parseMenuText(ta.value).filter((c) => c.items.length);
      if (!parsed.length) return;
      const s = st();
      const append = dlg.querySelector('.me-append').checked;
      if (append) {
        parsed.forEach((pc) => {
          const same = s.menu.find((c) => norm(c.category) === norm(pc.category));
          if (same) same.items.push(...pc.items); else s.menu.push(pc);
        });
      } else { s.menu = parsed; photos = {}; savePhotos(); }
      collapsed.clear();
      commit({ rerender: true });
      dlg.close();
      const n = parsed.reduce((a, c) => a + c.items.length, 0);
      IS.toast && IS.toast(`${n} ${n === 1 ? 'voce importata' : 'voci importate'} ✓ Controlla prezzi ed etichette`);
    });
    return dlg;
  }

  function previewPaste() {
    const ta = dlg.querySelector('.me-paste');
    const pv = dlg.querySelector('.me-pv');
    const ok = dlg.querySelector('.me-ok');
    const parsed = parseMenuText(ta.value).filter((c) => c.items.length);
    const n = parsed.reduce((a, c) => a + c.items.length, 0);
    const app = dlg.querySelector('.me-mode');
    app.hidden = !(st().menu || []).some((c) => c.items.some((it) => it.name.trim()));
    ok.disabled = !n;
    ok.textContent = n ? `Usa questo menù (${n} ${n === 1 ? 'voce' : 'voci'})` : 'Usa questo menù';
    if (!ta.value.trim()) { pv.innerHTML = ''; return; }
    if (!n) { pv.innerHTML = '<p class="me-pv-empty">Non riconosco ancora nessuna voce…</p>'; return; }
    const tagE = (ids) => ids.map((id) => (TAGS.find((t) => t.id === id) || {}).emoji || '').join(' ');
    pv.innerHTML = `<p class="ip-head">✓ Ho capito ${n} ${n === 1 ? 'voce' : 'voci'}${parsed.length > 1 || parsed[0].category ? ` in ${parsed.length} ${parsed.length === 1 ? 'categoria' : 'categorie'}` : ''}:</p>` + parsed.map((c) => `<div class="me-pv-cat">${c.category ? `<h4>${esc(c.category)}</h4>` : ''}<ul>${c.items.map((it) => `<li><span class="ip-name">${esc(it.name)}${it.tags.length ? ` <span class="me-pv-tags">${tagE(it.tags)}</span>` : ''}${it.description ? `<small>${esc(it.description)}</small>` : ''}</span>${it.price ? `<span class="ip-price">${esc(it.price)}</span>` : ''}</li>`).join('')}</ul></div>`).join('');
  }

  function openPaste(text) {
    const d = ensureDialog();
    const L = labels();
    d.querySelector('#me-dlg-t').textContent = L.title.includes('menù') ? 'Incolla il tuo menù' : `Incolla ${L.title.replace(/^I tuoi /, 'i tuoi ').replace(/^Il /, 'il ').replace(/^Servizi/, 'i servizi')}`;
    const ta = d.querySelector('.me-paste');
    ta.value = text || '';
    d.querySelector('.me-append').checked = false;
    previewPaste();
    if (!d.open) d.showModal();
    ta.focus();
  }

  async function runOCR(file) {
    if (!hasOCR()) return;
    IS.setStatus && IS.setStatus('Leggo il testo dalla foto del menù…', '', true);
    try {
      const src = await compress(file).catch(() => null);
      const out = await window.puter.ai.img2txt(src || file);
      const text = typeof out === 'string' ? out : (out && (out.text || out.message || '')) || '';
      IS.setStatus && IS.setStatus('');
      if (!text.trim()) { IS.toast && IS.toast('Non sono riuscito a leggere testo dalla foto. Prova con una foto più nitida.', 'error'); return; }
      openPaste(text.trim());
      IS.toast && IS.toast('Ecco cosa ho letto: controlla e correggi prima di confermare');
    } catch (err) {
      console.warn('OCR menù', err);
      IS.setStatus && IS.setStatus('Non riesco a leggere la foto adesso. Puoi incollare il testo a mano.', 'error');
    }
  }

  // ───────────────────────── API per app.js e gli altri moduli ─────────────────────────
  function menuForBrief() {
    return getMenu().map((c) => ({
      category: c.category.trim(),
      items: c.items.map((it) => ({ id: it.id, name: it.name.trim(), description: it.description.trim(), price: it.price.trim(), tags: it.tags.slice(), photo: photos[it.id] || null })),
    }));
  }
  function menuWithPhotos(menu) {
    return (Array.isArray(menu) ? menu : []).map((c) => ({ ...c, items: (c.items || []).map((it) => ({ ...it, photo: (it.id && photos[it.id]) || (/^data:image\//.test(it.photo || '') ? it.photo : null) })) }));
  }
  function menuForPrompt(menu) {
    const m = (Array.isArray(menu) ? menu : []).map((c) => ({ c: c.category, items: (c.items || []).filter((it) => it.name) })).filter((x) => x.items.length);
    if (!m.length) return '';
    const L = [];
    m.forEach((x) => {
      if (x.c) L.push(`## ${x.c}`);
      x.items.forEach((it) => {
        const tags = (it.tags || []).map((id) => TAGS.find((t) => t.id === id)).filter(Boolean).map((t) => `${t.emoji} ${t.label}`);
        L.push(`- ${it.name}${it.description ? ' — ' + it.description : ''}${it.price ? ' — ' + it.price : ''}${tags.length ? ' [' + tags.join(', ') + ']' : ''}`);
      });
    });
    return L.join('\n');
  }
  function menuLoad(menu) {
    const s = st();
    if (!Array.isArray(menu) || !menu.length) return;
    s.menu = cleanMenu(menu);
    s.menuSrc = String(s.items || '');
    menu.forEach((c, ci) => (c.items || []).forEach((it, ii) => { if (/^data:image\//.test(it.photo || '')) photos[s.menu[ci].items[ii].id] = it.photo; }));
    savePhotos();
  }
  // per il clic-e-modifica: «menu.cat.0», «menu.item.0.2.name|description|price»
  function menuSetField(key, value) {
    const p = String(key || '').split('.');
    if (p[0] !== 'menu') return false;
    const m = getMenu();
    const v = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    if (p[1] === 'cat' && m[+p[2]]) m[+p[2]].category = v;
    else if (p[1] === 'item' && m[+p[2]] && m[+p[2]].items[+p[3]] && ['name', 'description', 'price'].includes(p[4])) m[+p[2]].items[+p[3]][p[4]] = v;
    else return false;
    commit({ rerender: true });
    return true;
  }

  Object.assign(IS, {
    menuForBrief, menuForPrompt, menuLoad, menuWithPhotos, menuSetField,
    menuGet: () => JSON.parse(JSON.stringify(getMenu())),
    menuSet: (m) => { st().menu = cleanMenu(m); commit({ rerender: true }); },
    menuParse: parseMenuText, menuSerialize: serialize, menuOpenPaste: openPaste,
  });

  // ───────────────────────── avvio ─────────────────────────
  const s0 = st();
  s0.menu = cleanMenu(s0.menu);
  mount();
  render();
  IS.on && IS.on('render', () => render());
  pdb.get().then((v) => { if (v && typeof v === 'object') { photos = v; render(); IS.save && IS.save(); } }).catch(() => {});
  // Puter arriva dopo (defer): mostra il pulsante «foto del menù» se c'è l'OCR
  let tries = 0;
  const ocrPoll = setInterval(() => {
    tries++;
    if (hasOCR()) { const b = root && root.querySelector('[data-act="ocr"]'); if (b) b.hidden = false; clearInterval(ocrPoll); }
    else if (tries > 20) clearInterval(ocrPoll);
  }, 500);
})();
