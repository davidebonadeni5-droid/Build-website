// IdeaSito — motore offline. Genera un sito completo (un solo file HTML) da una "scheda" (brief),
// senza AI e senza rete. Espone window.detectBrief(testo) e window.generateOffline(brief).
(function () {
  'use strict';

  /* ═════════════════════════════ UTILITÀ ═════════════════════════════ */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();

  function hash(str) {
    let h = 2166136261 >>> 0;
    const s = String(str);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (arr, r) => arr[Math.floor(r() * arr.length) % arr.length];
  const r1 = (n) => Math.round(n * 10) / 10;

  // ── colori ──
  function hex2rgb(h) {
    h = String(h || '#000').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return isNaN(n) ? [0, 0, 0] : [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb2hex = (r, g, b) => '#' + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function mix(a, b, t) { const A = hex2rgb(a), B = hex2rgb(b); return rgb2hex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  function lum(h) {
    const c = hex2rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function contrast(a, b) { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
  const onColor = (bg) => (contrast(bg, '#ffffff') >= 3.1 ? '#ffffff' : '#141414');
  function ensure(fg, bg, min) {
    min = min || 4.5;
    let c = fg;
    const target = lum(bg) > 0.35 ? '#000000' : '#ffffff';
    for (let i = 0; i < 24 && contrast(c, bg) < min; i++) c = mix(c, target, 0.1);
    return c;
  }
  const rgba = (h, a) => { const c = hex2rgb(h); return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  const isHex = (s) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(s || '').trim());

  // ── testo ──
  function tpl(str, ctx) {
    return String(str || '')
      .replace(/\{name\}/g, ctx.name)
      .replace(/\{city\}/g, ctx.city || 'in città')
      .replace(/\{inCity\}/g, ctx.city ? ' a ' + ctx.city : '');
  }
  function initials(name) {
    const w = clean(name).replace(/[^\p{L}\p{N}&\s]/gu, ' ').split(/\s+/).filter((x) => x && !/^(di|da|del|della|dei|delle|il|lo|la|le|i|gli|e|&|the|of|and)$/i.test(x));
    if (!w.length) return '★';
    if (w.length === 1) return w[0].slice(0, 2).toUpperCase().replace(/^(.)(.)$/, (m, a, b) => a + b.toLowerCase());
    return (w[0][0] + w[1][0]).toUpperCase();
  }
  function titleCase(s) { return s.replace(/(^|[\s'’-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase()); }
  // ultima parola in <em> per i titoli: ogni tema la stilizza a modo suo
  function fancy(title) {
    const t = clean(title);
    const i = t.lastIndexOf(' ');
    if (i < 1) return esc(t);
    return esc(t.slice(0, i)) + ' <em>' + esc(t.slice(i + 1)) + '</em>';
  }
  function safeSrc(src) {
    src = String(src || '').trim();
    if (/^data:image\/(png|jpe?g|webp|gif|avif|svg\+xml)[;,]/i.test(src) || /^https?:\/\//i.test(src) || /^blob:/i.test(src)) return src;
    return '';
  }
  const cssUrl = (src) => 'url("' + src.replace(/["\\\n\r]/g, (c) => ({ '"': '%22', '\\': '%5C', '\n': '', '\r': '' }[c])) + '")';

  /* ═════════════════════════════ PARSING ═════════════════════════════ */

  const PRICE_NUM = /(?:\s[-–—|:·]\s*|\s|^)((?:da\s+|a partire da\s+|dai\s+)?(?:€\s?\d[\d.,]*|\d[\d.,]*\s?(?:€|euro\b|eur\b))(?:\s*(?:\/|a|al|alla|per)\s*[a-zà-ù]{1,14}(?:\s[a-zà-ù]{1,10})?)?)\s*$/i;
  const PRICE_WORD = /\s[-–—|]\s*(gratis|gratuit[oa]|su richiesta|su misura|incluso|inclusa|offerta libera)\s*$/i;

  function fmtPrice(p) {
    p = clean(p).replace(/\s*(euro|eur)\b/i, '€');
    p = p.replace(/€\s?(\d[\d.,]*)/, '$1€').replace(/(\d)\s+€/, '$1€');
    return p;
  }

  function parseItems(text, mode) {
    const groups = [];
    let cur = { title: '', items: [] };
    groups.push(cur);
    String(text || '').split(/\r?\n/).forEach((raw) => {
      let l = clean(raw);
      if (!l) return;
      l = l.replace(/^(?:[-*•·▪◦–]|\d{1,2}[.)])\s+/, '');
      const h = l.match(/^#+\s*(.+)$/) || l.match(/^\[(.+)\]$/) || l.match(/^([^:]{2,40}):$/) || l.match(/^=+\s*(.+?)\s*=*$/);
      if (h) { cur = { title: h[1].trim(), items: [] }; groups.push(cur); return; }
      let time = '', price = '', tag = '';
      if (mode === 'timeline') {
        const tm = l.match(/^((?:ore\s+)?\d{1,2}(?:[:.]\d{2})?(?:\s*[-–]\s*\d{1,2}(?:[:.]\d{2})?)?)(?:\s*[-–—:|]\s*|\s+)(.+)$/i);
        if (tm && /\d/.test(tm[1])) { time = tm[1].replace(/^ore\s+/i, '').replace(/\./g, ':'); l = tm[2]; }
      }
      let pm = l.match(PRICE_WORD);
      if (!pm) pm = l.match(PRICE_NUM);
      if (pm && pm.index > 0) {
        price = fmtPrice(pm[1]);
        l = l.slice(0, pm.index).trim().replace(/[-–—:|·,]\s*$/, '').trim();
      } else {
        const bare = l.match(/\s[-–—|]\s*(\d{1,4}(?:[.,]\d{1,2})?)\s*$/);
        if (bare) {
          if (/^(19|20)\d\d$/.test(bare[1])) tag = bare[1]; else price = bare[1] + '€';
          l = l.slice(0, bare.index).trim();
        }
      }
      let name = l, desc = '';
      const sm = l.match(/^(.{1,90}?)\s*(?::\s+|:(?=\S)|\s[-–—]\s)\s*(.+)$/);
      if (sm && !/^\d+$/.test(sm[1])) { name = sm[1].trim(); desc = sm[2].trim(); }
      if (desc) desc = desc.charAt(0).toUpperCase() + desc.slice(1);
      if (name) cur.items.push({ name, desc, price, time, tag });
    });
    return groups.filter((g) => g.items.length);
  }

  function parseHours(text) {
    return String(text || '').split(/\r?\n/).map(clean).filter(Boolean).map((l) => {
      const m = l.match(/^(.*?[\p{L}.)])\s*[:\-–—]?\s+((?:\d|h24|chius|su appunt|solo|aperto|24|dalle|ore).*)$/iu);
      return m ? { d: m[1].replace(/[:\-–—]\s*$/, '').trim(), t: m[2].trim() } : { d: l, t: '' };
    });
  }

  function contactsOf(c, name) {
    c = c || {};
    const out = {};
    const phone = clean(c.phone);
    if (phone) { out.phone = phone; out.tel = 'tel:' + phone.replace(/[^\d+]/g, ''); }
    let wa = String(c.whatsapp || '').replace(/[^\d+]/g, '');
    if (/^(si|sì|yes|true)$/i.test(clean(c.whatsapp)) && phone) wa = phone.replace(/[^\d+]/g, '');
    if (wa) {
      wa = wa.replace(/^\+/, '').replace(/^00/, '');
      if (/^3\d{8,9}$/.test(wa)) wa = '39' + wa;
      if (wa.length >= 8) {
        out.wa = wa;
        out.waLabel = clean(c.whatsapp);
        out.waHref = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Ciao! Vi scrivo dal sito di ' + name + '. ');
      }
    }
    const email = clean(c.email);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { out.email = email; out.mailto = 'mailto:' + email; }
    const addr = clean(c.address);
    if (addr) {
      out.address = addr;
      out.maps = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(addr);
      out.embed = 'https://maps.google.com/maps?q=' + encodeURIComponent(addr) + '&z=15&output=embed';
    }
    const ig = clean(c.instagram);
    if (ig) {
      const h = (ig.match(/instagram\.com\/([A-Za-z0-9_.]+)/i) || [, ig.replace(/^@/, '')])[1].replace(/[^A-Za-z0-9_.]/g, '');
      if (h) { out.ig = '@' + h; out.igHref = 'https://instagram.com/' + h; }
    }
    const fb = clean(c.facebook);
    if (fb) {
      if (/^https?:\/\//i.test(fb)) { out.fbHref = fb; out.fb = fb.replace(/^https?:\/\/(www\.)?/i, '').replace(/\/$/, ''); }
      else { const h = fb.replace(/^@/, '').replace(/^(www\.)?facebook\.com\//i, '').replace(/\s+/g, ''); out.fbHref = 'https://facebook.com/' + h; out.fb = h; }
    }
    if (clean(c.hours)) out.hours = String(c.hours);
    return out;
  }

  /* ═════════════════════════════ RILEVAMENTO DAL TESTO ═════════════════════════════ */

  const CITIES = ['Roma', 'Milano', 'Napoli', 'Torino', 'Palermo', 'Genova', 'Bologna', 'Firenze', 'Bari', 'Catania', 'Venezia', 'Verona', 'Messina', 'Padova', 'Trieste', 'Brescia', 'Parma', 'Taranto', 'Prato', 'Modena', 'Reggio Calabria', 'Reggio Emilia', 'Perugia', 'Livorno', 'Ravenna', 'Cagliari', 'Foggia', 'Rimini', 'Salerno', 'Ferrara', 'Sassari', 'Latina', 'Monza', 'Siracusa', 'Pescara', 'Bergamo', 'Forlì', 'Trento', 'Vicenza', 'Terni', 'Bolzano', 'Novara', 'Piacenza', 'Ancona', 'Andria', 'Arezzo', 'Udine', 'Cesena', 'Lecce', 'Pesaro', 'La Spezia', 'Como', 'Pisa', 'Lucca', 'Siena', 'Treviso', 'Varese', 'Cuneo', 'Asti', 'Alessandria', 'Mantova', 'Cremona', 'Lecco', 'Pavia', 'Matera', 'Potenza', 'Cosenza', 'Catanzaro', 'Trapani', 'Agrigento', 'Ragusa', 'Olbia', 'Aosta', 'Campobasso', "L'Aquila", 'Caserta', 'Avellino', 'Benevento', 'Sorrento', 'Amalfi', 'Positano', 'Capri', 'Taormina', 'Cortina', 'Portofino', 'Sanremo', 'Viareggio', 'Assisi', 'Orvieto', 'Gubbio', 'Urbino', 'Bra', 'Alba', 'Chianti', 'Langhe', 'Salento', 'Garda', 'Polignano', 'Ostuni', 'Alghero', 'Tropea'];
  const COLORS = [
    [/\bverde salvia\b/, '#7d9a7a'], [/\bverde acqua\b/, '#14b8a6'], [/\bverde bosco\b/, '#2f5d3a'], [/\bblu notte\b/, '#1e3a8a'], [/\bblu navy\b/, '#1e3a8a'],
    [/\bazzurr[oaie]\b/, '#0ea5e9'], [/\bcelest[ei]\b/, '#38bdf8'], [/\bturchese\b/, '#14b8a6'], [/\bottanio\b/, '#0f6e74'], [/\bblu\b/, '#2563eb'],
    [/\bverd[ei]\b/, '#16a34a'], [/\bsmeraldo\b/, '#059669'], [/\bmenta\b/, '#3eb489'], [/\bbordeaux\b/, '#7f1d3a'], [/\bross[oaie]\b/, '#dc2626'],
    [/\bcorallo\b/, '#ff6f61'], [/\bsalmone\b/, '#fa8072'], [/\bfucsia\b/, '#d946ef'], [/\brosa\b/, '#ec4899'], [/\bviola\b/, '#7c3aed'],
    [/\b(lilla|lavanda)\b/, '#a78bfa'], [/\bindaco\b/, '#4f46e5'], [/\barancion[ei]\b/, '#ea580c'], [/\bsenape\b/, '#c99a12'], [/\bgiall[oaie]\b/, '#eab308'],
    [/\b(oro|dorat[oaie])\b/, '#b08d57'], [/\bterracotta\b/, '#c2562d'], [/\bmarron[ei]\b/, '#7c4a2d'], [/\bbeige\b/, '#b8956a'], [/\bner[oaie]\b/, '#111111'],
    [/\bgrigi[oae]?\b/, '#64748b'], [/\bargent[oaie]\b/, '#94a3b8'],
  ];
  const STYLE_WORDS = {
    elegante: [['elegan', 1], ['lusso', 1], ['lussuos', 1], ['raffinat', 1], ['chic', 1], ['di classe', 1], ['prestigi', 1], ['esclusiv', 1], ['sofisticat', 1], ['gourmet', 0.6], ['stellat', 0.6], ['matrimon', 0.4], ['nozze', 0.4]],
    audace: [['audace', 1.2], ['grintos', 1], ["d'impatto", 1], ['impattant', 1], ['potente', 0.8], ['energic', 0.8], ['aggressiv', 1], ['bold', 1], ['urban', 0.8], ['street', 0.6], ['forte', 0.5], ['brutal', 1]],
    magazine: [['rivista', 1], ['magazine', 1.2], ['editorial', 1], ['giornal', 0.8], ['blog', 0.8], ['fashion', 0.8], ['moda', 0.6], ['cultura', 0.5]],
    aurora: [['tecnologic', 1], ['futurist', 1], ['innovativ', 0.7], ['tech', 0.8], ['gradient', 1], ['sfumatur', 0.8], ['neon', 1], ['scuro', 0.6], ['dark', 0.8], ['modern', 0.35]],
    minimal: [['minimal', 1.2], ['essenzial', 1], ['pulit', 0.8], ['semplic', 0.5], ['sobri', 1], ['bianco e nero', 1], ['svizzer', 1], ['professional', 0.4]],
    calore: [['rustic', 1.2], ['calda', 0.8], ['caldo', 0.6], ['accoglient', 1], ['familiar', 0.8], ['tradizion', 0.8], ['casereccio', 1], ['genuin', 0.8], ['campagna', 0.8], ['natural', 0.5], ['vintage', 0.5]],
    giocoso: [['giocos', 1.2], ['colorat', 1], ['divertent', 1], ['allegr', 1], ['vivac', 1], ['bambin', 0.8], ['pop', 0.6], ['simpatic', 0.8], ['festos', 0.8], ['colori', 0.6]],
  };
  const SECTION_WORDS = [
    ['testimonianze', /recension|testimonian|opinion|dicono/], ['prezzi', /prezz|listino|abbonament|tariff|pacchett|piani\b/],
    ['galleria', /\bfoto|galleri|immagin/], ['orari', /\borari/], ['faq', /\bfaq\b|domande/], ['team', /\bteam\b|staff|collaborator|squadra/],
    ['dove', /mappa|indirizz|dove si trova|come arrivare|dove siamo/], ['menu', /\bmen[uù]\b/], ['programma', /programma|scaletta|calendario|timeline/],
    ['prodotti', /prodott|catalogo|vetrina/], ['progetti', /progett|portfolio|lavori/], ['numeri', /numeri|statistic/], ['cta', /prenot|iscri|ordina/],
  ];
  const STOP_CAPS = /^(Voglio|Vorrei|Ciao|Sono|Il|La|Lo|Le|Gli|Un|Una|Uno|Per|Con|Che|Mi|Ci|Un'|Sito|Abbiamo|Siamo|Ho|Crea|Creami|Fai|Fammi|Serve|Mi|Nel|Nella|Dal|Dalla|Ogni|Ecco|Instagram|Facebook|WhatsApp|Whatsapp|Google|Maps|Lunedì|Martedì|Mercoledì|Giovedì|Venerdì|Sabato|Domenica|Italia)$/;

  function catScore(cat, low) {
    let s = 0;
    // Le prime 6 parole chiave di ogni categoria sono le più tipiche: valgono il doppio
    (cat.keywords || []).forEach((k, i) => {
      const kk = k.trim().toLowerCase();
      if (!kk) return;
      const w = i < 6 ? 2 : 1;
      if (kk.length <= 4) {
        const re = new RegExp('(^|[^\\p{L}])' + kk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}])', 'u');
        if (re.test(low)) s += w;
      } else if (low.includes(kk)) s += (kk.length > 6 ? 1.4 : 1) * w;
    });
    return s;
  }

  function guessCity(t) {
    const low = t.toLowerCase();
    let best = null;
    CITIES.forEach((c) => {
      const re = new RegExp('(^|[^\\p{L}])' + c.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\p{L}])', 'u');
      const m = low.match(re);
      if (m && (best === null || m.index < best.i)) best = { c, i: m.index };
    });
    if (best) return best.c;
    const m = t.match(/\b(?:a|ad|in provincia di|vicino a|zona)\s+([A-ZÀ-Ý][a-zà-ù]+(?:\s+(?:di|del|sul|al|in)\s+[A-ZÀ-Ý][a-zà-ù]+)?)/);
    if (m && !STOP_CAPS.test(m[1])) return m[1];
    return '';
  }

  function guessName(t, city) {
    let m = t.match(/(?:chiamat[oa]|si chiama|di nome|nome(?:\s+è)?|denominat[oa]|brand)\s*[:]?\s*["“«]?\s*([^,.;!?\n"”»()]{2,40}?)\s*(?=["”»]|[,.;!?\n()]|\s+(?:a|ad|in|con|che|per|e|dove|sito|nel|nella|vicino)\s|$)/i);
    if (m) { const n = m[1].trim(); return n === n.toLowerCase() ? titleCase(n) : n; }
    m = t.match(/["“«]([^"”»\n]{2,40})["”»]/);
    if (m) return m[1].trim();
    m = t.match(/\b([A-Z][a-z]+[A-Z][A-Za-z0-9]+)\b/);
    if (m) return m[1];
    // sequenza di parole maiuscole a metà frase (es. "la pizzeria Da Mario a Napoli")
    const re = /([\p{L}&'’]+)|([.!?\n]+)/gu;
    const toks = [];
    let x;
    while ((x = re.exec(t))) toks.push(x[1] ? { w: x[1], i: x.index } : { stop: true });
    const NOUNS = /^(pizzeria|ristorante|trattoria|osteria|bar|caffè|pasticceria|gelateria|palestra|studio|hotel|albergo|agriturismo|negozio|boutique|salone|centro|bottega|associazione|circolo|locanda|enoteca|birreria|forno|panificio|b&b|farmacia|atelier|barberia|bistrot|villa|masseria|libreria|club|scuola|accademia)$/i;
    for (let i = 0; i < toks.length; i++) {
      const tk = toks[i];
      if (tk.stop || !/^\p{Lu}/u.test(tk.w)) continue;
      const prev = toks[i - 1];
      if (!prev || prev.stop) continue; // inizio frase
      if (STOP_CAPS.test(tk.w)) continue;
      const parts = [tk.w];
      let j = i + 1;
      while (j < toks.length && !toks[j].stop) {
        if (/^\p{Lu}/u.test(toks[j].w) || /^&$/.test(toks[j].w)) { parts.push(toks[j].w); j++; continue; }
        if (/^(di|da|del|della|dei|delle|e|al|alla)$/.test(toks[j].w) && toks[j + 1] && !toks[j + 1].stop && /^\p{Lu}/u.test(toks[j + 1].w) && toks[j + 1].w !== city) { parts.push(toks[j].w); j++; continue; }
        break;
      }
      const name = parts.join(' ');
      if (city && (name === city || name.startsWith(city + ' '))) { i = j; continue; }
      if (prev && /^(a|ad|in)$/i.test(prev.w) && parts.length === 1) continue;
      if (prev && NOUNS.test(prev.w) && !/^(il|la|lo)$/i.test(prev.w)) return titleCase(prev.w) + ' ' + name;
      return name;
    }
    return '';
  }

  function detectBrief(ideaText) {
    const t = String(ideaText || '');
    const low = ' ' + t.toLowerCase().replace(/\s+/g, ' ') + ' ';
    const cats = window.OFFLINE_CATEGORIES || [];
    let cat = cats.find((c) => c.id === 'altro') || cats[0];
    let best = 0;
    cats.forEach((c) => { const s = catScore(c, low); if (s > best) { best = s; cat = c; } });

    let theme = '', tb = 0;
    Object.keys(STYLE_WORDS).forEach((id) => {
      let s = 0;
      STYLE_WORDS[id].forEach(([w, v]) => { if (low.includes(w)) s += v; });
      if (s > tb) { tb = s; theme = id; }
    });
    if (tb < 0.5) theme = '';
    if (!theme && /matrimon|nozze|sposi/.test(low)) theme = 'elegante';
    if (!theme) theme = cat.defaultTheme;

    let accentColor = '', ci = Infinity;
    COLORS.forEach(([re, hex]) => { const m = low.match(re); if (m && m.index < ci) { ci = m.index; accentColor = hex; } });

    const sections = (cat.defaultSections || []).slice();
    SECTION_WORDS.forEach(([id, re]) => {
      if (re.test(low) && !sections.includes(id)) {
        const at = sections.indexOf('contatti');
        sections.splice(at < 0 ? sections.length : at, 0, id);
      }
    });
    if (!sections.includes('contatti')) sections.push('contatti');

    const city = guessCity(t);
    const name = guessName(t, city);
    const out = { category: cat.id, theme, sections };
    if (name) out.name = name;
    if (city) out.city = city;
    if (accentColor) out.accentColor = accentColor;

    const contacts = {};
    const email = t.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (email) contacts.email = email[0].replace(/[.,;]+$/, '');
    const phone = t.match(/(?:\+39[\s.]?)?(?:3\d{2}|0\d{1,3})[\s.]?\d{3,4}[\s.]?\d{3,4}/);
    if (phone) { contacts.phone = phone[0].trim(); if (/whats\s?app/i.test(t) && /^(\+39[\s.]?)?3/.test(contacts.phone)) contacts.whatsapp = contacts.phone; }
    const ig = t.match(/(?:instagram[^@\n]{0,12})?@([A-Za-z0-9_.]{3,30})/i);
    if (ig && !(email && email[0].includes('@' + ig[1]))) contacts.instagram = '@' + ig[1];
    const addr = t.match(/\b((?:via|viale|piazza|corso|largo|vicolo|strada|contrada|località|loc\.)\s+[^,\n]{2,40}(?:,\s*\d+[a-z]?)?(?:\s*\d+[a-z]?)?)/i);
    if (addr) contacts.address = addr[1].trim() + (city ? ', ' + city : '');
    if (Object.keys(contacts).length) out.contacts = contacts;

    const sl = t.match(/(?:slogan|motto|frase)\s*[:"“«]\s*["“«]?([^"”»\n]{4,90})/i);
    if (sl) out.tagline = sl[1].trim();
    return out;
  }

  /* ═════════════════════════════ ICONE (SVG inline) ═════════════════════════════ */

  const IC = {
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 6-10 7L2 6"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    arrow: '<path d="M5 12h14M13 5l7 7-7 7"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    zap: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    leaf: '<path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/>',
    coffee: '<path d="M18 8h1a4 4 0 0 1 0 8h-1"/><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/><path d="M6 1v3M10 1v3M14 1v3"/>',
    utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
    sparkles: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/><path d="M19 3v4M17 5h4M5 17v4M3 19h4"/>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
    code: '<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>',
    briefcase: '<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>',
    home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
    gift: '<polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><path d="M12 22V7M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>',
    music: '<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    dumbbell: '<path d="M6.5 6.5v11M17.5 6.5v11M3 9v6M21 9v6M6.5 12h11"/>',
    truck: '<rect x="1" y="3" width="15" height="13"/><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    trend: '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>',
    bed: '<path d="M2 4v16M2 17h20M22 20v-8a3 3 0 0 0-3-3H10v8"/><circle cx="6" cy="12" r="2"/>',
    wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01"/>',
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
    layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
    target: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
    instagram: '<rect x="2" y="2" width="20" height="20" rx="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><path d="M17.5 6.5h.01"/>',
    facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    whatsapp: '<path d="M3 21l1.65-4.95A9 9 0 1 1 8 19.5L3 21z"/><path d="M9 8.5c0 3.6 2.9 6.5 6.5 6.5l1-1.6-2.1-1-1 .9a4.4 4.4 0 0 1-2.2-2.2l.9-1-1-2.1z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    left: '<polyline points="15 18 9 12 15 6"/>',
    right: '<polyline points="9 18 15 12 9 6"/>',
    quote: '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
  };
  const icon = (n, cls) => `<svg class="ico${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${IC[n] || IC.sparkles}</svg>`;

  const ICON_RULES = [
    [/yoga|pilates|medit|respir/i, 'leaf'], [/pesi|forza|functional|cross|allenam|palestra|bodybuild/i, 'dumbbell'], [/boxe|kick|marzial|combatt/i, 'target'],
    [/camera|suite|letto|stanz|notte/i, 'bed'], [/colazion|caff|brunch/i, 'coffee'], [/piscina|spa|sauna|giardino|relax|mare|sole/i, 'sun'], [/wi-?fi|internet/i, 'wifi'],
    [/consulen|ascolto|supporto|assistenz/i, 'chat'], [/online|web|digital|sito|seo|remoto|mondo|estero|esperienz|escursion/i, 'globe'], [/sicur|protez|privacy|garanz|assicur/i, 'shield'],
    [/report|dati|analis|crescit|statist|marketing|performance/i, 'trend'], [/team|collabor|gruppo|comunit|insieme|volontar/i, 'users'], [/automaz|veloc|rapid|energia|intens/i, 'zap'],
    [/integraz|livell|design|ui|ux|identit/i, 'layers'], [/foto|shooting|video|ritratt|reportage/i, 'camera'], [/regal|bonus|omaggio|buono/i, 'gift'],
    [/spedizion|consegn|domicilio|asporto|delivery/i, 'truck'], [/event|festa|calendar|appuntament|prenotaz/i, 'calendar'], [/music|dj|concert|band/i, 'music'],
    [/taglio|capell|piega|barba|acconciat|colore|balayage/i, 'scissors'], [/viso|trattament|estet|manicure|unghie|beauty|massagg/i, 'sparkles'],
    [/bambin|ragazz|scuola|doposcuola|corso|corsi|formazion|lezion|laborator|pratiche|document/i, 'book'], [/anzian|aiuto|solidal|cura|benessere|salute/i, 'heart'],
    [/ambient|pulizia|eco|natura|biolog|verde|sostenib|nutriz/i, 'leaf'], [/qualit|premio|eccellen|certific/i, 'award'], [/aziend|impres|business|partita iva|profession/i, 'briefcase'],
    [/cucina|cena|pranzo|menu|piatt|chef|degust/i, 'utensils'], [/codice|svilupp|software|app\b|programm/i, 'code'], [/casa|immobil|struttura|sede/i, 'home'],
    [/mobile|telefon/i, 'phone'], [/obiettiv|risultat|precision/i, 'target'],
  ];
  function iconFor(text, i, fallback) {
    for (const [re, n] of ICON_RULES) if (re.test(text)) return n;
    return [fallback, 'sparkles', 'star', 'award', 'heart', 'zap'][i % 6] || 'sparkles';
  }

  /* ═════════════════════════════ ARTE GENERATIVA (SVG) ═════════════════════════════ */

  let UID = 0;
  const uid = (p) => p + (++UID).toString(36);
  const svgWrap = (w, h, inner, cls) => `<svg class="art${cls ? ' ' + cls : ''}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

  function blobPath(cx, cy, r, R, n, irr) {
    n = n || 7; irr = irr == null ? 0.32 : irr;
    const pts = [];
    const off = R() * Math.PI;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2;
      const rr = r * (1 - irr / 2 + R() * irr);
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    const f = (p) => r1(p[0]) + ' ' + r1(p[1]);
    let d = 'M' + f(pts[0]);
    for (let i = 0; i < n; i++) {
      const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
      const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
      d += 'C' + f(c1) + ' ' + f(c2) + ' ' + f(p2);
    }
    return d + 'Z';
  }
  function wavePath(w, h, y, amp, R, steps) {
    steps = steps || 4;
    let d = `M0 ${r1(y + (R() - 0.5) * amp)}`;
    const seg = w / steps;
    for (let i = 0; i < steps; i++) {
      const x0 = i * seg, x1 = x0 + seg;
      const ya = y + (R() - 0.5) * amp * 2, yb = y + (R() - 0.5) * amp * 2, ye = y + (R() - 0.5) * amp;
      d += ` C${r1(x0 + seg * 0.35)} ${r1(ya)} ${r1(x1 - seg * 0.35)} ${r1(yb)} ${r1(x1)} ${r1(ye)}`;
    }
    return d + ` L${w} ${h} L0 ${h} Z`;
  }

  // v: 'hero' | 'about' | 'tile' | 'wide' ; label: testo per alcune composizioni
  function art(ctx, seed, v, label) {
    const P = ctx.P, R = rng(hash(ctx.th + '|' + seed + '|' + ctx.name));
    const W = 800, H = v === 'wide' ? 450 : v === 'tile' ? 640 : 1000;
    const k = Math.floor(R() * 3);
    const g = uid('a');
    const ini = esc((clean(label || ctx.name)[0] || '·').toUpperCase());
    let s = '';
    switch (ctx.th) {
      case 'elegante': {
        const bg1 = mix(P.inv, P.accent, 0.22);
        s += `<defs><radialGradient id="${g}" cx="${r1(0.25 + R() * 0.5)}" cy="${r1(0.2 + R() * 0.3)}" r="0.95"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${P.inv}"/></radialGradient></defs><rect width="${W}" height="${H}" fill="url(#${g})"/>`;
        const cx = W * (0.3 + R() * 0.4), cy = H * (0.38 + R() * 0.22);
        for (let i = 1; i <= 8; i++) s += `<circle cx="${r1(cx)}" cy="${r1(cy)}" r="${40 + i * 52}" fill="none" stroke="${P.accent}" stroke-width="${i % 3 ? 0.7 : 1.3}" opacity="${r1(0.75 - i * 0.07)}"/>`;
        const aw = W * 0.46, ax = (W - aw) / 2, ay = H * 0.22;
        s += `<path d="M${r1(ax)} ${H} V${r1(ay + aw / 2)} A${r1(aw / 2)} ${r1(aw / 2)} 0 0 1 ${r1(ax + aw)} ${r1(ay + aw / 2)} V${H}" fill="${rgba(P.accent, 0.06)}" stroke="${P.accent}" stroke-width="1.4"/>`;
        s += `<path d="M${r1(ax + 18)} ${H} V${r1(ay + aw / 2)} A${r1(aw / 2 - 18)} ${r1(aw / 2 - 18)} 0 0 1 ${r1(ax + aw - 18)} ${r1(ay + aw / 2)} V${H}" fill="none" stroke="${P.accent}" stroke-width="0.6" opacity=".7"/>`;
        const dy = ay + aw * 0.55;
        s += `<g transform="translate(${W / 2} ${r1(dy)})" fill="none" stroke="${P.accent}" stroke-width="1.2"><path d="M0 -26 L14 0 L0 26 L-14 0Z"/><path d="M0 -12 L6 0 L0 12 L-6 0Z" fill="${P.accent}"/><path d="M-120 0 H-30 M30 0 H120"/></g>`;
        for (let i = 0; i < 46; i++) s += `<circle cx="${r1(R() * W)}" cy="${r1(R() * H)}" r="${r1(0.6 + R() * 1.6)}" fill="${P.invText}" opacity="${r1(0.15 + R() * 0.5)}"/>`;
        break;
      }
      case 'audace': {
        const bgs = [P.accent, P.text, P.bg2];
        const bg = bgs[k], fg1 = bg === P.text ? P.accent : P.text, fg2 = bg === P.bg2 ? P.accent : P.bg;
        s += `<defs><pattern id="${g}" width="22" height="22" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="9" height="22" fill="${fg1}"/></pattern></defs><rect width="${W}" height="${H}" fill="${bg}"/>`;
        const cr = W * (0.34 + R() * 0.1);
        s += `<circle cx="${r1(W * (0.55 + R() * 0.2))}" cy="${r1(H * (0.3 + R() * 0.15))}" r="${r1(cr)}" fill="${fg1}"/>`;
        s += `<rect x="${r1(-40)}" y="${r1(H * 0.62)}" width="${r1(W * 0.62)}" height="${r1(H * 0.2)}" fill="url(#${g})"/>`;
        const hx = W * (0.15 + R() * 0.3), hy = H * 0.86;
        s += `<path d="M${r1(hx - 170)} ${r1(hy)} A170 170 0 0 1 ${r1(hx + 170)} ${r1(hy)} Z" fill="${fg2}"/>`;
        s += `<rect x="${r1(W * 0.68)}" y="${r1(H * 0.66)}" width="120" height="120" fill="none" stroke="${fg2}" stroke-width="14" transform="rotate(${Math.round(R() * 40 - 20)} ${r1(W * 0.68 + 60)} ${r1(H * 0.66 + 60)})"/>`;
        for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) s += `<circle cx="${70 + i * 26}" cy="${70 + j * 26}" r="4" fill="${fg2}"/>`;
        break;
      }
      case 'magazine': {
        const bgs = [P.bg2, mix(P.accent, P.bg, 0.86), P.inv];
        const bg = bgs[k], ink = k === 2 ? P.invText : P.text;
        s += `<rect width="${W}" height="${H}" fill="${bg}"/>`;
        s += `<circle cx="${r1(W * (0.62 + R() * 0.15))}" cy="${r1(H * (0.32 + R() * 0.2))}" r="${r1(W * 0.3)}" fill="${P.accent}" opacity="${k === 1 ? 0.9 : 0.95}"/>`;
        s += `<text x="${r1(W * 0.06)}" y="${r1(H * 0.93)}" font-family="'Playfair Display', Didot, Georgia, serif" font-style="italic" font-weight="700" font-size="${r1(H * 0.82)}" fill="${ink}" opacity="${k === 2 ? 0.9 : 0.88}">${ini}</text>`;
        s += `<g stroke="${ink}" stroke-width="1.2" opacity=".55"><path d="M40 60 H${W - 40}"/><path d="M40 68 H${W - 40}"/></g>`;
        s += `<text x="40" y="44" font-family="'Libre Franklin', Arial, sans-serif" font-weight="700" font-size="18" letter-spacing="4" fill="${ink}" opacity=".7">N° ${String((hash(seed) % 90) + 10)}</text>`;
        break;
      }
      case 'aurora': {
        const b = uid('b'), gr = uid('g');
        s += `<defs><filter id="${b}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${v === 'tile' ? 50 : 70}"/></filter><pattern id="${gr}" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#fff" stroke-opacity=".06"/></pattern></defs>`;
        s += `<rect width="${W}" height="${H}" fill="${mix(P.bg, '#000', 0.2)}"/><g filter="url(#${b})">`;
        [P.accent, P.a2, P.a3, P.accent].forEach((c, i) => { s += `<circle cx="${r1(W * R())}" cy="${r1(H * R())}" r="${r1(W * (0.18 + R() * 0.2))}" fill="${c}" opacity="${i === 3 ? 0.5 : 0.85}"/>`; });
        s += `</g><rect width="${W}" height="${H}" fill="url(#${gr})"/>`;
        const cx = W / 2, cy = H / 2, rr = Math.min(W, H) * 0.2;
        s += `<circle cx="${cx}" cy="${cy}" r="${r1(rr)}" fill="#ffffff" fill-opacity=".07" stroke="#ffffff" stroke-opacity=".25"/>`;
        s += `<circle cx="${cx}" cy="${cy}" r="${r1(rr * 1.7)}" fill="none" stroke="#ffffff" stroke-opacity=".1" stroke-dasharray="4 8"/>`;
        s += `<g transform="translate(${r1(cx - 36)} ${r1(cy - 36)}) scale(3)" fill="none" stroke="#fff" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" opacity=".9">${IC[ctx.c.icon] || IC.sparkles}</g>`;
        break;
      }
      case 'minimal': {
        s += `<rect width="${W}" height="${H}" fill="${mix(P.bg2, P.text, 0.03)}"/><g stroke="${P.text}" stroke-opacity=".12">`;
        for (let x = 50; x < W; x += 50) s += `<path d="M${x} 0V${H}"/>`;
        for (let y = 50; y < H; y += 50) s += `<path d="M0 ${y}H${W}"/>`;
        s += '</g>';
        const gx = 100 + Math.floor(R() * ((W - 300) / 50)) * 50, gy = 100 + Math.floor(R() * ((H - 400) / 50)) * 50;
        const cr = 100 + Math.floor(R() * 3) * 50;
        s += `<circle cx="${gx + 50}" cy="${gy + 50}" r="${cr}" fill="${P.accent}"/>`;
        s += `<rect x="${k === 0 ? 0 : W - 300}" y="${H - 250}" width="300" height="50" fill="${P.text}"/>`;
        s += `<circle cx="${W - 200}" cy="${150 + k * 50}" r="100" fill="none" stroke="${P.text}" stroke-width="2"/>`;
        s += `<path d="M${W - 200} ${50 + k * 50}V${250 + k * 50}M${W - 300} ${150 + k * 50}H${W - 100}" stroke="${P.text}" stroke-width="2"/>`;
        s += `<text x="24" y="${H - 24}" font-family="'JetBrains Mono', Menlo, monospace" font-size="18" fill="${P.text}" letter-spacing="1">FIG. ${String((hash(seed) % 9) + 1).padStart(2, '0')} — ${esc(clean(label || ctx.c.noun).toUpperCase().slice(0, 28))}</text>`;
        break;
      }
      case 'calore': {
        const sky = [mix(P.a3, P.bg, 0.55), mix(P.accent, P.bg, 0.72), mix(P.a2, P.bg, 0.7)][k];
        s += `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${sky}"/><stop offset="1" stop-color="${P.bg2}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#${g})"/>`;
        if (k === 1) {
          s += `<path d="${blobPath(W * 0.55, H * 0.45, W * 0.34, R, 8, 0.3)}" fill="${P.accent}"/>`;
          s += `<path d="${blobPath(W * 0.3, H * 0.7, W * 0.2, R, 7, 0.4)}" fill="${P.a2}"/>`;
          s += `<circle cx="${r1(W * 0.72)}" cy="${r1(H * 0.22)}" r="${r1(W * 0.1)}" fill="${P.a3}"/>`;
          for (let i = 0; i < 7; i++) for (let j = 0; j < 4; j++) s += `<circle cx="${r1(W * 0.08 + i * 22)}" cy="${r1(H * 0.1 + j * 22)}" r="3.5" fill="${P.text}" opacity=".35"/>`;
          s += `<path d="M${r1(W * 0.62)} ${r1(H * 0.9)} q60 -160 200 -190 q-40 150 -200 190z" fill="${mix(P.a2, '#000', 0.15)}"/>`;
        } else {
          s += `<circle cx="${r1(W * (0.25 + R() * 0.5))}" cy="${r1(H * 0.32)}" r="${r1(W * 0.14)}" fill="${k === 2 ? P.accent : P.a3}"/>`;
          s += `<path d="${wavePath(W, H, H * 0.55, 60, R, 3)}" fill="${mix(P.a2, P.bg, 0.35)}"/>`;
          s += `<path d="${wavePath(W, H, H * 0.68, 50, R, 4)}" fill="${P.a2}"/>`;
          s += `<path d="${wavePath(W, H, H * 0.8, 40, R, 3)}" fill="${P.accent}"/>`;
          s += `<path d="${wavePath(W, H, H * 0.9, 30, R, 5)}" fill="${mix(P.accent, P.inv, 0.35)}"/>`;
        }
        break;
      }
      case 'giocoso':
      default: {
        const pas = ctx.pastels;
        const bg = pas[Math.floor(R() * pas.length)];
        s += `<rect width="${W}" height="${H}" fill="${bg}"/>`;
        const cols = [P.accent, P.a2, P.a3, P.a4].filter(Boolean);
        for (let i = 0; i < 4; i++) {
          const c = cols[(i + k) % cols.length];
          s += `<path d="${blobPath(W * (0.15 + R() * 0.7), H * (0.15 + R() * 0.7), W * (0.14 + R() * 0.14), R, 6, 0.45)}" fill="${c}"/>`;
        }
        s += `<path d="M${r1(W * 0.1)} ${r1(H * 0.82)} q40 -60 80 0 t80 0 t80 0 t80 0" fill="none" stroke="${P.text}" stroke-width="12" stroke-linecap="round"/>`;
        const sx = W * (0.6 + R() * 0.25), sy = H * (0.15 + R() * 0.2);
        let st = '';
        for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? 26 : 60; st += (i ? 'L' : 'M') + r1(sx + Math.cos(a) * rr) + ' ' + r1(sy + Math.sin(a) * rr); }
        s += `<path d="${st}Z" fill="${P.bg}" stroke="${P.text}" stroke-width="6" stroke-linejoin="round"/>`;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) s += `<circle cx="${r1(W * 0.75 + i * 20)}" cy="${r1(H * 0.72 + j * 20)}" r="5" fill="${P.text}"/>`;
        s += `<circle cx="${r1(W * 0.2)}" cy="${r1(H * 0.22)}" r="38" fill="none" stroke="${P.text}" stroke-width="7"/>`;
        break;
      }
    }
    return svgWrap(W, H, s);
  }

  // finestra di applicazione stilizzata (hero Aurora per app/startup)
  function mockupArt(ctx) {
    const P = ctx.P, W = 1200, H = 720, g = uid('m'), g2 = uid('m');
    const R = rng(hash(ctx.name + 'mock'));
    let pts = [], x = 0;
    for (let i = 0; i <= 12; i++) { pts.push([380 + i * 60, 560 - (i * 18 + R() * 70)]); x++; }
    const line = pts.map((p, i) => (i ? 'L' : 'M') + r1(p[0]) + ' ' + r1(p[1])).join(' ');
    let s = `<defs><linearGradient id="${g}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${P.accent}" stop-opacity=".55"/><stop offset="1" stop-color="${P.accent}" stop-opacity="0"/></linearGradient><linearGradient id="${g2}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${P.accent}"/><stop offset="1" stop-color="${P.a2}"/></linearGradient></defs>`;
    s += `<rect width="${W}" height="${H}" fill="#0d0d26"/><rect width="${W}" height="54" fill="#121233"/>`;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => { s += `<circle cx="${30 + i * 22}" cy="27" r="7" fill="${c}"/>`; });
    s += `<rect x="440" y="16" width="320" height="22" rx="11" fill="#1b1b44"/>`;
    s += `<rect x="0" y="54" width="250" height="${H - 54}" fill="#10102c"/>`;
    s += `<rect x="28" y="84" width="34" height="34" rx="10" fill="url(#${g2})"/><rect x="74" y="92" width="120" height="16" rx="8" fill="#2a2a5a"/>`;
    for (let i = 0; i < 6; i++) s += `<rect x="28" y="${160 + i * 46}" width="${150 - (i % 3) * 25}" height="14" rx="7" fill="${i === 0 ? P.accent : '#23234d'}" opacity="${i === 0 ? 0.9 : 1}"/>`;
    s += `<text x="290" y="112" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="700" fill="#eef0ff">Buongiorno 👋</text>`;
    const kpis = [['Attività', '1.284', '+12%'], ['Ore risparmiate', '326', '+28%'], ['Soddisfazione', '98%', '+4%']];
    kpis.forEach((kp, i) => {
      const kx = 290 + i * 300;
      s += `<rect x="${kx}" y="140" width="276" height="120" rx="18" fill="#15153a" stroke="#2a2a5a"/>`;
      s += `<text x="${kx + 22}" y="180" font-family="Inter, system-ui, sans-serif" font-size="17" fill="#a3a7cc">${kp[0]}</text>`;
      s += `<text x="${kx + 22}" y="230" font-family="Inter, system-ui, sans-serif" font-size="38" font-weight="700" fill="#ffffff">${kp[1]}</text>`;
      s += `<rect x="${kx + 186}" y="204" width="70" height="30" rx="15" fill="${rgba(P.a2, 0.18)}"/><text x="${kx + 221}" y="225" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="15" font-weight="600" fill="${P.a2}">${kp[2]}</text>`;
    });
    s += `<rect x="290" y="284" width="876" height="400" rx="18" fill="#15153a" stroke="#2a2a5a"/>`;
    for (let i = 0; i < 5; i++) s += `<path d="M330 ${360 + i * 60}H1130" stroke="#24244f"/>`;
    s += `<path d="${line} L${r1(pts[pts.length - 1][0])} 640 L380 640Z" fill="url(#${g})"/>`;
    s += `<path d="${line}" fill="none" stroke="url(#${g2})" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
    const lp = pts[pts.length - 1];
    s += `<circle cx="${r1(lp[0])}" cy="${r1(lp[1])}" r="10" fill="#fff" stroke="${P.a2}" stroke-width="5"/>`;
    s += `<text x="320" y="326" font-family="Inter, system-ui, sans-serif" font-size="19" font-weight="600" fill="#eef0ff">Andamento</text>`;
    return svgWrap(W, H, s, 'mock');
  }

  function mapArt(ctx) {
    const P = ctx.P, W = 800, H = 600, R = rng(hash(ctx.name + 'map'));
    const dark = lum(P.bg) < 0.2 || ctx.th === 'elegante';
    const base = dark ? mix(P.bg, '#ffffff', 0.06) : mix(P.bg2, '#ffffff', 0.35);
    const block = dark ? mix(P.bg, '#ffffff', 0.1) : mix(P.bg2, P.text, 0.06);
    const road = dark ? mix(P.bg, '#ffffff', 0.2) : '#ffffff';
    let s = `<rect width="${W}" height="${H}" fill="${base}"/>`;
    for (let i = 0; i < 26; i++) s += `<rect x="${r1(R() * W)}" y="${r1(R() * H)}" width="${r1(50 + R() * 110)}" height="${r1(40 + R() * 90)}" rx="6" fill="${block}"/>`;
    s += `<path d="${blobPath(W * 0.18, H * 0.25, 90, R, 7, 0.4)}" fill="${dark ? mix(P.bg, '#3b8f5a', 0.35) : '#cfe3c4'}"/>`;
    s += `<path d="M-20 ${r1(H * 0.8)} C${r1(W * 0.3)} ${r1(H * 0.6)} ${r1(W * 0.6)} ${r1(H * 1.0)} ${W + 20} ${r1(H * 0.7)}" stroke="${dark ? mix(P.bg, '#5aa9e6', 0.4) : '#bcdcf0'}" stroke-width="34" fill="none"/>`;
    for (let i = 0; i < 4; i++) { const y = r1(H * (0.15 + i * 0.22) + R() * 30); s += `<path d="M0 ${y} L${W} ${r1(y + (R() - 0.5) * 120)}" stroke="${road}" stroke-width="${i === 1 ? 16 : 9}"/>`; }
    for (let i = 0; i < 5; i++) { const x = r1(W * (0.1 + i * 0.2) + R() * 30); s += `<path d="M${x} 0 L${r1(x + (R() - 0.5) * 140)} ${H}" stroke="${road}" stroke-width="${i === 2 ? 16 : 8}"/>`; }
    s += `<circle cx="${W / 2}" cy="${H / 2 + 20}" r="46" fill="${P.accent}" opacity=".18"/><circle cx="${W / 2}" cy="${H / 2 + 20}" r="22" fill="${P.accent}" opacity=".25"/>`;
    s += `<g transform="translate(${W / 2 - 24} ${H / 2 - 44})"><path d="M24 0C10.7 0 0 10.4 0 23.3 0 40.8 24 64 24 64s24-23.2 24-40.7C48 10.4 37.3 0 24 0z" fill="${P.accent}" stroke="#fff" stroke-width="3"/><circle cx="24" cy="23" r="8" fill="#fff"/></g>`;
    return svgWrap(W, H, s, 'map-art');
  }

  function avatar(ctx, name, i, big) {
    const P = ctx.P;
    const ini = esc(initials(name));
    const cols = {
      elegante: [P.inv, mix(P.inv, P.accent, 0.3), mix(P.accent, P.inv, 0.25)],
      audace: [P.accent, P.text, mix(P.accent, P.text, 0.5)],
      magazine: [P.accent, P.inv, mix(P.accent, P.inv, 0.5)],
      aurora: [P.accent, P.a2, P.a3],
      minimal: [P.text, P.accent, mix(P.text, P.bg, 0.4)],
      calore: [P.accent, P.a2, P.a3],
      giocoso: [P.accent, P.a3, P.a4, P.a2],
    }[ctx.th] || [P.accent];
    const c = cols[i % cols.length];
    if (!big) return `<span class="av" style="background:${c};color:${onColor(c)}" aria-hidden="true">${ini}</span>`;
    const R = rng(hash(name + i));
    const W = 400, H = 480;
    let s = `<rect width="${W}" height="${H}" fill="${c}"/>`;
    const fg = onColor(c);
    s += `<path d="${blobPath(W * (0.3 + R() * 0.4), H * (0.3 + R() * 0.4), W * 0.45, R, 7, 0.35)}" fill="${fg}" opacity=".08"/>`;
    s += `<circle cx="${W / 2}" cy="${H * 0.36}" r="${W * 0.17}" fill="${fg}" opacity=".16"/><path d="M${W * 0.14} ${H} C${W * 0.14} ${H * 0.62} ${W * 0.86} ${H * 0.62} ${W * 0.86} ${H}Z" fill="${fg}" opacity=".16"/>`;
    s += `<text x="${W / 2}" y="${H * 0.42}" text-anchor="middle" font-family="${esc(ctx.t.fonts.display)}" font-size="96" font-weight="700" fill="${fg}" ${ctx.th === 'elegante' || ctx.th === 'magazine' ? 'font-style="italic"' : ''}>${ini}</text>`;
    return svgWrap(W, H, s, 'av-art');
  }

  /* ═════════════════════════════ CSS ═════════════════════════════ */

  const BASE_CSS = `
*,*::before,*::after{box-sizing:border-box}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%;scroll-padding-top:calc(var(--navh) + 8px)}
body{margin:0;background:var(--bg);color:var(--text);font-family:var(--fb);font-size:var(--fs,17px);line-height:1.7;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;overflow-x:hidden;overflow-x:clip}
html{overflow-x:clip}
img,svg{display:block;max-width:100%}
a{color:inherit;text-underline-offset:3px}
h1,h2,h3,h4{font-family:var(--fd);font-weight:var(--hw,700);line-height:1.08;margin:0;letter-spacing:var(--hls,-.01em);text-wrap:balance;overflow-wrap:break-word}
p{margin:0 0 1em}p:last-child{margin-bottom:0}
ul,ol{margin:0;padding:0;list-style:none}
button{font:inherit;color:inherit}
[hidden]{display:none!important}
::selection{background:var(--accent);color:var(--accent-ink)}
:focus-visible{outline:2px solid var(--accent-text);outline-offset:3px}
.wrap{width:min(var(--maxw),calc(100% - var(--gut) * 2));margin-inline:auto}
.skip{position:absolute;left:-9999px;top:8px;z-index:999;background:#fff;color:#000;padding:10px 16px;border-radius:8px}.skip:focus{left:12px}
.sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.ico{width:1em;height:1em;flex:none;stroke:currentColor;fill:none;stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.img{background-color:var(--bg2);background-position:center;background-size:cover;background-repeat:no-repeat}
.art{width:100%;height:100%}
.fill{position:absolute;inset:0;width:100%;height:100%}
.sec{position:relative;padding-block:var(--sy);background:var(--bg);color:var(--text)}
.t-alt{--bg:var(--bg2)}
.t-inv{--bg:var(--inv);--bg2:var(--inv2);--text:var(--inv-text);--muted:var(--inv-muted);--line:var(--inv-line);--surface:var(--inv-surface);--accent-text:var(--inv-accent-text);--field:var(--inv2)}
.sec.compact{padding-block:calc(var(--sy) * .62)}
/* nav */
.nav{position:sticky;top:0;z-index:60;background:var(--nav-bg,var(--bg));color:var(--nav-text,var(--text));transition:background .35s,box-shadow .35s,color .35s,border-color .35s}
.nav-in{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:var(--navh)}
.brand{display:inline-flex;align-items:center;gap:12px;text-decoration:none;color:inherit;min-width:0}
.brand-logo{height:var(--logoh,44px);width:auto;max-width:170px;object-fit:contain}
.brand-name{font-family:var(--fd);font-weight:var(--bw,700);font-size:var(--bfs,1.3rem);line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:min(52vw,360px)}
.mono{display:none;flex:none;place-items:center;width:42px;height:42px;font:700 1rem/1 var(--fd)}
.menu{display:flex;align-items:center;gap:clamp(18px,2.4vw,36px)}
.menu a{text-decoration:none;font-family:var(--fu);font-size:.93rem;font-weight:500;opacity:.82;transition:opacity .2s,color .2s}
.menu a:hover{opacity:1}
.menu .btn{opacity:1}
.burger{display:none;width:46px;height:46px;border:0;background:transparent;border-radius:12px;cursor:pointer;place-items:center;color:inherit;flex:none}
.burger span,.burger span::before,.burger span::after{display:block;width:22px;height:2px;background:currentColor;border-radius:2px;transition:transform .3s,background .3s}
.burger span{position:relative}.burger span::before,.burger span::after{content:'';position:absolute;left:0}
.burger span::before{top:-7px}.burger span::after{top:7px}
.nav.open .burger span{background:transparent}.nav.open .burger span::before{transform:translateY(7px) rotate(45deg)}.nav.open .burger span::after{transform:translateY(-7px) rotate(-45deg)}
@media(max-width:960px){
.burger{display:grid}
.menu{position:absolute;left:0;right:0;top:100%;flex-direction:column;align-items:stretch;gap:0;padding:8px var(--gut) 24px;background:var(--menu-bg,var(--bg));color:var(--menu-text,var(--text));box-shadow:0 30px 40px -24px rgba(0,0,0,.35);opacity:0;visibility:hidden;transform:translateY(-8px);transition:opacity .3s,transform .3s,visibility .3s;max-height:calc(100vh - var(--navh));overflow:auto}
.nav.open .menu{opacity:1;visibility:visible;transform:none}
.menu a{padding:15px 0;border-bottom:1px solid var(--line);font-size:1.05rem;opacity:1}
.menu .btn{margin-top:18px;border-bottom:1px solid transparent}
}
/* bottoni */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:.6em;padding:var(--btn-pad,15px 28px);border-radius:var(--btn-r,999px);font-family:var(--fu);font-weight:var(--btn-fw,600);font-size:var(--btn-fs,.95rem);line-height:1.15;letter-spacing:var(--btn-ls,0);text-transform:var(--btn-tt,none);text-decoration:none;border:var(--btn-bw,1.5px) solid transparent;cursor:pointer;transition:transform .25s,box-shadow .25s,background .25s,color .25s,border-color .25s;white-space:nowrap;max-width:100%}
.btn .ico{width:1.15em;height:1.15em}
.btn-p{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn-p:hover{transform:translateY(-2px);box-shadow:0 14px 30px -12px var(--accent)}
.btn-s{background:transparent;color:inherit;border-color:currentColor}
.btn-s:hover{background:var(--text);color:var(--bg);border-color:var(--text)}
.btns{display:flex;flex-wrap:wrap;gap:12px}
@media(max-width:520px){.btn{white-space:normal;text-align:center}.btns .btn{flex:1 1 100%}}
/* titoli di sezione */
.sh{margin-bottom:clamp(40px,6vw,76px);max-width:780px}
.sh-k{display:inline-flex;align-items:center;gap:10px;font-family:var(--fu);font-weight:600;font-size:.78rem;line-height:1.3;letter-spacing:.16em;text-transform:uppercase;color:var(--accent-text);margin-bottom:18px}
.sh-n{display:none}
.sh-t{font-size:var(--h2)}
.sh-t em{font-style:var(--em-style,italic);color:var(--em-color,inherit)}
.sh-p{margin-top:22px;color:var(--muted);font-size:1.12rem;max-width:620px}
.sh.c{text-align:center;margin-inline:auto}.sh.c .sh-p{margin-inline:auto}
.split{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);gap:clamp(40px,7vw,110px);align-items:start}
.split .sh{margin-bottom:0}
@media(max-width:880px){.split{grid-template-columns:minmax(0,1fr)}}
/* animazioni */
.js .rv{opacity:0;translate:0 26px;transition:opacity 1s cubic-bezier(.16,1,.3,1),translate 1s cubic-bezier(.16,1,.3,1);transition-delay:calc(var(--d,0) * 100ms)}
.js .rv.in{opacity:1;translate:none}
/* chi siamo */
.chi-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.05fr);gap:clamp(40px,7vw,104px);align-items:center}
.chi-media{position:relative;margin:0;aspect-ratio:4/5}
.chi-media>.m{position:absolute;inset:0;overflow:hidden;border-radius:var(--r-lg)}
.chi-body .sh{margin-bottom:28px}
.prose p{color:var(--muted);font-size:1.06rem}
.prose p:first-child{color:var(--text);font-size:1.2rem;line-height:1.65}
.ticks{display:grid;gap:14px;margin-top:30px}
.ticks li{display:flex;gap:12px;align-items:flex-start;font-weight:500}
.ticks .ico{color:var(--accent-text);margin-top:.32em}
.sign{display:none;margin-top:30px;font-family:var(--fd);font-style:italic;font-size:1.5rem;color:var(--accent-text)}
@media(max-width:880px){.chi-grid{grid-template-columns:minmax(0,1fr)}.chi-media{aspect-ratio:4/3}}
/* card servizi */
.cards{display:grid;gap:var(--cg,24px);grid-template-columns:repeat(3,minmax(0,1fr))}
.cards.k2{grid-template-columns:repeat(2,minmax(0,1fr))}.cards.k1{grid-template-columns:minmax(0,1fr);max-width:640px}
.cards .wide{grid-column:span 2}
.card{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--r);padding:clamp(26px,3vw,40px);transition:transform .4s cubic-bezier(.16,1,.3,1),box-shadow .4s,border-color .4s,background .4s}
.card h3{font-size:var(--h3,1.4rem);margin-bottom:10px}
.card p{color:var(--muted);margin:0}
.c-i{display:inline-grid;place-items:center;width:56px;height:56px;border-radius:calc(var(--r) * .8 + 4px);background:var(--accent-soft);color:var(--accent-text);font-size:25px;margin-bottom:24px}
.c-n{position:absolute;top:26px;right:28px;font-family:var(--fu);font-size:.8rem;font-weight:600;letter-spacing:.1em;color:var(--muted)}
.c-price{display:inline-block;margin-top:18px;font-family:var(--fu);font-weight:700;font-size:1.02rem;color:var(--accent-text)}
@media(max-width:1000px){.cards,.cards.k3{grid-template-columns:repeat(2,minmax(0,1fr))}.cards .wide{grid-column:auto}}
@media(max-width:640px){.cards,.cards.k2,.cards.k3{grid-template-columns:minmax(0,1fr)}}
/* menù */
.menu-wrap{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(40px,5vw,64px) clamp(40px,7vw,96px)}
.mg-h{font-size:1.65rem;margin-bottom:10px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.mi{padding:16px 0}
.mi-top{display:flex;align-items:baseline;gap:12px}
.mi-n{font-family:var(--fd);font-weight:600;font-size:1.2rem;line-height:1.3}
.mi-dots{flex:1;min-width:24px;border-bottom:1.5px dotted var(--line);transform:translateY(-5px)}
.mi-p{font-family:var(--fu);font-weight:700;color:var(--accent-text);white-space:nowrap}
.mi-d{color:var(--muted);font-size:.96rem;margin:4px 0 0;max-width:48ch}
@media(max-width:820px){.menu-wrap{grid-template-columns:minmax(0,1fr)}}
/* galleria */
.gal{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-auto-rows:clamp(170px,21vw,290px);gap:var(--gg,14px);grid-auto-flow:dense}
.g-it{position:relative;overflow:hidden;border-radius:var(--r);border:0;padding:0;margin:0;background:var(--bg2);cursor:zoom-in;display:block;text-align:left;width:100%;height:100%}
.g-it.is-art{cursor:default}
.g-it .m{position:absolute;inset:0;transition:transform 1.4s cubic-bezier(.16,1,.3,1)}
.g-it:hover .m{transform:scale(1.045)}
.g-cap{position:absolute;left:0;right:0;bottom:0;padding:48px 20px 16px;color:#fff;font-family:var(--fu);font-weight:500;font-size:.92rem;line-height:1.35;background:linear-gradient(transparent,rgba(0,0,0,.62));opacity:0;translate:0 8px;transition:opacity .4s,translate .4s}
.g-it:hover .g-cap,.g-it:focus-visible .g-cap,.g-it.is-art .g-cap{opacity:1;translate:none}
.g-it.w2{grid-column:span 2}.g-it.w3{grid-column:span 3}.g-it.h2{grid-row:span 2}
@media(hover:none){.g-cap{opacity:1;translate:none}}
@media(max-width:760px){.gal{grid-template-columns:repeat(2,minmax(0,1fr));grid-auto-rows:clamp(150px,44vw,240px)}.g-it.w2,.g-it.w3,.g-it.h2{grid-column:auto;grid-row:auto}.g-it:nth-child(3n+1){grid-column:span 2}}
/* lightbox */
.lb{position:fixed;inset:0;z-index:200;background:rgba(8,8,10,.94);display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:8px;padding:20px}
.lb-f{margin:0;display:grid;gap:14px;justify-items:center;min-width:0}
.lb-img{width:100%;height:min(80vh,900px);background:center/contain no-repeat}
.lb-cap{color:#eee;font-family:var(--fu);font-size:.95rem;text-align:center}
.lb button{width:52px;height:52px;border-radius:50%;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.06);color:#fff;cursor:pointer;display:grid;place-items:center;font-size:22px;transition:background .2s}
.lb button:hover{background:rgba(255,255,255,.18)}
.lb .lb-x{position:absolute;top:16px;right:16px}
@media(max-width:640px){.lb{grid-template-columns:1fr;padding:70px 12px 20px}.lb .lb-p,.lb .lb-n{position:absolute;bottom:20px}.lb .lb-p{left:calc(50% - 62px)}.lb .lb-n{right:calc(50% - 62px)}.lb-img{height:68vh}}
/* prezzi */
.plans{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px;align-items:stretch}
.plan{position:relative;display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:clamp(30px,3vw,42px)}
.plan-n{font-family:var(--fu);font-weight:700;font-size:.82rem;letter-spacing:.14em;text-transform:uppercase}
.plan-p{font-family:var(--fd);font-size:clamp(2.4rem,4vw,3.3rem);font-weight:var(--hw,700);margin:18px 0 6px;line-height:1;letter-spacing:-.02em}
.plan-per{color:var(--muted);font-size:.95rem;min-height:1.6em}
.plan ul{margin:28px 0 32px;display:grid;gap:12px;flex:1;align-content:start}
.plan li{display:flex;gap:10px;align-items:flex-start}
.plan li .ico{color:var(--accent-text);margin-top:.35em}
.plan .btn{width:100%}
.plan.ft{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.plan.ft .plan-per,.plan.ft li .ico{color:inherit;opacity:.85}
.plan.ft .btn-p{background:var(--accent-ink);color:var(--accent);border-color:var(--accent-ink)}
.badge{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);font-family:var(--fu);font-weight:700;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px;white-space:nowrap}
@media(max-width:900px){.plans{grid-template-columns:minmax(0,1fr);max-width:500px;margin-inline:auto}}
/* recensioni */
.quotes{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:24px}
.q{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:clamp(28px,3vw,38px);display:flex;flex-direction:column;gap:22px}
.q-s{color:var(--star);letter-spacing:4px;font-size:1rem;line-height:1}
.q blockquote{margin:0;font-size:1.08rem;line-height:1.65;flex:1}
.q-a{display:flex;align-items:center;gap:14px}
.av{width:46px;height:46px;border-radius:50%;display:grid;place-items:center;font-family:var(--fu);font-weight:700;font-size:.92rem;flex:none}
.q-a b{display:block;font-weight:600;line-height:1.3}.q-a small{color:var(--muted);font-size:.88rem}
@media(max-width:900px){.quotes{grid-template-columns:minmax(0,1fr)}}
/* team */
.team{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:clamp(20px,3vw,32px)}
.tm-m{position:relative;aspect-ratio:5/6;overflow:hidden;border-radius:var(--r);margin-bottom:18px}
.tm h3{font-size:1.25rem}.tm p{color:var(--muted);margin-top:4px;font-size:.96rem}
/* faq */
.faq-l{display:grid;gap:0;border-top:1px solid var(--line)}
.faq-l details{border-bottom:1px solid var(--line)}
.faq-l summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;align-items:center;gap:20px;padding:24px 0;font-family:var(--fd);font-weight:var(--hw,600);font-size:1.18rem;line-height:1.35}
.faq-l summary::-webkit-details-marker{display:none}
.faq-l summary .ico{font-size:22px;transition:transform .35s;color:var(--accent-text)}
.faq-l details[open] summary .ico{transform:rotate(45deg)}
.faq-l details p{color:var(--muted);padding:0 48px 26px 0;margin:0}
/* numeri */
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:clamp(20px,3vw,40px)}
.st-n{font-family:var(--fd);font-weight:var(--hw,700);font-size:clamp(2.6rem,5.4vw,4.6rem);line-height:1;letter-spacing:-.03em;white-space:nowrap}
.st-n small{font-size:.5em;margin-left:.08em;color:var(--accent-text);letter-spacing:0}
.st-l{color:var(--muted);margin-top:12px;font-size:1rem}
@media(max-width:860px){.stats{grid-template-columns:repeat(2,minmax(0,1fr));row-gap:44px}}
/* orari */
.hours{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:clamp(18px,3vw,36px) clamp(22px,3.4vw,44px)}
.hr{display:flex;justify-content:space-between;align-items:baseline;gap:18px;padding:18px 0;border-bottom:1px solid var(--line)}
.hr:last-child{border-bottom:0}
.hr b{font-weight:600}.hr span{color:var(--muted);text-align:right}
.hr.off span{color:var(--accent-text)}
.note{margin-top:26px;color:var(--muted)}
.side-btns{margin-top:30px}
/* dove */
.map{position:relative;aspect-ratio:4/3;border-radius:var(--r-lg);overflow:hidden;background:var(--bg2);border:1px solid var(--line)}
.map iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.addr{display:grid;gap:18px;margin-top:8px}
.addr li{display:flex;gap:14px;align-items:flex-start}
.addr .ico{font-size:20px;color:var(--accent-text);margin-top:.25em}
.addr b{display:block;font-weight:600}
.addr span{color:var(--muted)}
/* contatti */
.ct-list{display:grid;margin-top:32px;border-top:1px solid var(--line)}
.ct-list a,.ct-list div{display:flex;align-items:center;gap:16px;padding:18px 0;border-bottom:1px solid var(--line);text-decoration:none;min-width:0}
.ct-i{display:grid;place-items:center;width:46px;height:46px;border-radius:calc(var(--r) * .7 + 4px);background:var(--accent-soft);color:var(--accent-text);font-size:20px;flex:none}
.ct-list small{display:block;color:var(--muted);font-size:.8rem;letter-spacing:.06em;text-transform:uppercase;font-family:var(--fu)}
.ct-list strong{font-weight:600;overflow-wrap:anywhere}
.ct-list a:hover strong{color:var(--accent-text)}
.form{position:relative;background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:clamp(24px,4vw,46px);display:grid;gap:18px}
.f2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.fld{display:grid;gap:8px}
.fld span{font-family:var(--fu);font-weight:600;font-size:.84rem;letter-spacing:.02em}
.fld input,.fld textarea{width:100%;font:inherit;font-size:1rem;color:var(--text);background:var(--field,var(--bg));border:1px solid var(--line);border-radius:var(--fr,10px);padding:14px 16px;transition:border-color .2s,box-shadow .2s;min-width:0}
.fld textarea{resize:vertical;min-height:130px}
.fld input:focus,.fld textarea:focus{outline:none;border-color:var(--accent-text);box-shadow:0 0 0 4px var(--accent-soft)}
.form .btn{justify-self:start}
.form-ok{display:grid;gap:10px;text-align:center;padding:30px 10px}
.form-ok .ico{font-size:44px;margin:0 auto;color:var(--accent-text)}
.form-ok b{font-family:var(--fd);font-size:1.6rem}
.form.sent>:not(.form-ok){display:none}
.form .fine{color:var(--muted);font-size:.85rem;margin:0}
@media(max-width:560px){.f2{grid-template-columns:minmax(0,1fr)}.form .btn{justify-self:stretch}}
/* call to action */
.cta-box{position:relative;overflow:hidden;isolation:isolate;border-radius:var(--r-lg);padding:clamp(56px,8vw,112px) clamp(24px,6vw,96px);background:var(--accent);color:var(--accent-ink);text-align:center}
.cta-box h2{font-size:clamp(2.2rem,5.6vw,4.6rem);position:relative}
.cta-box p{font-size:1.16rem;opacity:.9;max-width:580px;margin:20px auto 36px;position:relative}
.cta-box .btns{justify-content:center;position:relative}
.cta-box .btn-p{background:var(--accent-ink);color:var(--accent);border-color:var(--accent-ink)}
.cta-box .btn-s{color:var(--accent-ink)}
.cta-art{position:absolute;inset:0;z-index:-1;opacity:.3;pointer-events:none}
/* progetti */
.works{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:clamp(40px,5vw,72px) clamp(24px,3.4vw,48px)}
.work{display:block;text-decoration:none;color:inherit}
.work-m{position:relative;aspect-ratio:4/3;border-radius:var(--r);overflow:hidden;margin-bottom:22px;background:var(--bg2)}
.work-m .m{position:absolute;inset:0;transition:transform 1.2s cubic-bezier(.16,1,.3,1)}
.work:hover .work-m .m{transform:scale(1.04)}
.work-meta{display:flex;justify-content:space-between;gap:16px;font-family:var(--fu);font-weight:600;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
.work h3{font-size:clamp(1.4rem,2.2vw,1.85rem)}
.work p{color:var(--muted);margin-top:8px;max-width:52ch}
@media(min-width:861px){.works .work:nth-child(even){margin-top:clamp(40px,8vw,120px)}}
@media(max-width:860px){.works{grid-template-columns:minmax(0,1fr)}}
/* prodotti */
.prods{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:clamp(24px,3vw,36px) clamp(18px,2.4vw,30px)}
.prod{display:flex;flex-direction:column}
.prod-m{position:relative;aspect-ratio:4/5;border-radius:var(--r);overflow:hidden;margin-bottom:20px;background:var(--bg2)}
.prod-m .m{position:absolute;inset:0;transition:transform 1.2s cubic-bezier(.16,1,.3,1)}
.prod:hover .prod-m .m{transform:scale(1.04)}
.prod-top{display:flex;justify-content:space-between;gap:12px;align-items:baseline}
.prod h3{font-size:1.25rem}
.prod-p{font-family:var(--fu);font-weight:700;color:var(--accent-text);white-space:nowrap}
.prod p{color:var(--muted);font-size:.96rem;margin:8px 0 16px}
.lnk{margin-top:auto;display:inline-flex;gap:8px;align-items:center;font-family:var(--fu);font-weight:600;font-size:.95rem;text-decoration:none;color:var(--accent-text)}
.lnk .ico{transition:transform .25s}.lnk:hover .ico{transform:translateX(4px)}
@media(max-width:900px){.prods{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:540px){.prods{grid-template-columns:minmax(0,1fr)}}
/* programma */
.tl{position:relative;max-width:860px;margin-inline:auto;--tlx:120px}
.tl::before{content:'';position:absolute;left:var(--tlx);top:10px;bottom:10px;width:2px;background:var(--line);transform:translateX(-1px)}
.tl-i{position:relative;display:grid;grid-template-columns:var(--tlx) minmax(0,1fr);padding:22px 0}
.tl-i::before{content:'';position:absolute;left:var(--tlx);top:33px;width:14px;height:14px;border-radius:50%;background:var(--accent);transform:translateX(-7px);box-shadow:0 0 0 6px var(--bg)}
.tl-t{font-family:var(--fd);font-weight:700;font-size:1.2rem;color:var(--accent-text);text-align:right;padding:4px 36px 0 0;line-height:1.3}
.tl-b{padding-left:40px}
.tl-b h3{font-size:1.45rem}
.tl-b p{color:var(--muted);margin-top:6px}
@media(max-width:600px){.tl{--tlx:74px}.tl-t{font-size:1rem;padding-right:22px}.tl-b{padding-left:26px}}
/* footer */
.foot{padding:clamp(64px,8vw,104px) 0 30px;background:var(--bg);color:var(--text)}
.foot-g{display:grid;grid-template-columns:1.5fr 1fr 1.2fr 1.1fr;gap:clamp(32px,4vw,56px)}
.foot .brand{margin-bottom:18px}
.foot-tag{color:var(--muted);max-width:34ch}
.foot h4{font-family:var(--fu);font-weight:600;font-size:.76rem;letter-spacing:.16em;text-transform:uppercase;color:var(--muted);margin-bottom:18px}
.foot li{margin-bottom:10px;color:var(--muted)}
.foot a{text-decoration:none;transition:color .2s}.foot a:hover{color:var(--accent-text)}
.foot li a{color:var(--text);overflow-wrap:anywhere}
.soc{display:flex;gap:10px;margin-top:24px}
.soc a{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;border:1px solid var(--line);font-size:19px;transition:background .25s,color .25s,border-color .25s}
.soc a:hover{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.foot-b{margin-top:clamp(48px,6vw,80px);padding-top:26px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-size:.88rem;color:var(--muted)}
.foot-big{display:none}
@media(max-width:900px){.foot-g{grid-template-columns:1fr 1fr}}
@media(max-width:560px){.foot-g{grid-template-columns:minmax(0,1fr)}}
/* whatsapp */
.wa-f{position:fixed;right:18px;bottom:18px;z-index:80;width:60px;height:60px;border-radius:50%;background:#25d366;color:#fff;display:grid;place-items:center;box-shadow:0 12px 30px -8px rgba(0,0,0,.45);font-size:30px;transition:transform .25s}
.wa-f:hover{transform:scale(1.08)}
.wa-f::after{content:'';position:absolute;inset:0;border-radius:50%;border:2px solid #25d366;animation:pulse 2.4s ease-out infinite}
.wa-f .ico{stroke-width:1.9}
@keyframes pulse{from{transform:scale(1);opacity:.8}to{transform:scale(1.7);opacity:0}}
/* marquee */
.mq{overflow:hidden;white-space:nowrap;position:relative}
.mq-t{display:inline-flex;align-items:center;gap:var(--mqg,44px);padding-right:var(--mqg,44px);animation:mq var(--mqd,38s) linear infinite}
.mq-t span{display:inline-flex;align-items:center;gap:var(--mqg,44px)}
@keyframes mq{to{transform:translateX(-50%)}}
.divider{position:absolute;left:0;right:0;top:-1px;height:clamp(36px,6vw,80px);transform:translateY(-99%);pointer-events:none;z-index:2}
.divider svg{width:100%;height:100%}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.js .rv{opacity:1;translate:none;transition:none}*,*::before,*::after{animation:none!important;transition-duration:.01ms!important}}
`;

  // ── stili dei temi ──
  const THEME_CSS = {
    elegante: (ctx) => `
:root{--r:2px;--r-lg:2px;--hw:500;--hls:-.01em;--fs:17px;--h2:clamp(2.5rem,5.4vw,4.3rem);--h3:1.6rem;--btn-r:0;--btn-tt:uppercase;--btn-ls:.2em;--btn-fs:.74rem;--btn-pad:19px 34px;--btn-fw:500;--btn-bw:1px;--navh:84px;--em-color:var(--accent-text)}
body{font-weight:400}
.sh{text-align:center;margin-inline:auto}.sh .sh-p{margin-inline:auto}
.sh-k{letter-spacing:.38em;font-weight:500;font-size:.72rem}
.sh-t{font-weight:400;line-height:1.02}
.sh-t::after{content:'';display:block;width:150px;height:16px;margin:26px auto 0;background:${ctx.orn} center/contain no-repeat}
.split .sh,.chi-body .sh{text-align:left;margin-inline:0}.split .sh-t::after,.chi-body .sh-t::after{margin-left:0}
.nav{position:fixed;left:0;right:0;--nav-bg:transparent;--nav-text:#f6efe2}
.nav .menu a{font-size:.72rem;letter-spacing:.24em;text-transform:uppercase;font-weight:500}
.nav.scrolled,.nav.open{--nav-bg:${rgba(ctx.P.bg, 0.94)};--nav-text:var(--text);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);box-shadow:0 1px 0 var(--line)}
.nav .btn-s{border-color:currentColor}
.nav .btn-s:hover{background:var(--accent);border-color:var(--accent);color:var(--accent-ink)}
.brand-name{font-weight:500;font-size:1.65rem;letter-spacing:.02em}
.mono{display:grid;border:1px solid currentColor;border-radius:50%;font-style:italic;font-weight:500;font-size:1.05rem}
.btn-p:hover{box-shadow:none;background:transparent;color:inherit;border-color:currentColor}
.hero{position:relative;min-height:100vh;min-height:100svh;display:grid;place-items:center;text-align:center;color:#f6efe2;background:var(--inv);overflow:hidden;isolation:isolate;padding:calc(var(--navh) + 40px) 0 110px}
.h-bg{position:absolute;inset:0;z-index:-2}
.h-bg .img{position:absolute;inset:0;animation:kb 26s ease-out both}
@keyframes kb{from{transform:scale(1.12)}to{transform:scale(1)}}
.h-veil{position:absolute;inset:0;z-index:-1;background:radial-gradient(ellipse at center,rgba(12,10,8,.35),rgba(12,10,8,.78)),linear-gradient(180deg,rgba(12,10,8,.55),transparent 30%,transparent 65%,rgba(12,10,8,.7))}
.hero::after{content:'';position:absolute;inset:clamp(10px,2vw,26px);border:1px solid rgba(246,239,226,.22);pointer-events:none}
.h-c{max-width:980px}
.h-k{font-family:var(--fu);font-size:.74rem;letter-spacing:.46em;text-transform:uppercase;color:${ctx.P.accentLight};margin-bottom:28px}
.h-t{font-weight:400;font-size:clamp(3.3rem,10vw,8.4rem);line-height:.92;letter-spacing:-.015em}
.h-t.t-l{font-size:clamp(2.6rem,7vw,5.8rem)}
.h-t em{font-style:italic;color:${ctx.P.accentLight}}
.orn{width:180px;height:18px;margin:34px auto;background:${ctx.ornLight} center/contain no-repeat}
.h-s{font-family:var(--fd);font-style:italic;font-size:clamp(1.25rem,2.4vw,1.75rem);line-height:1.45;max-width:640px;margin:0 auto 44px;color:rgba(246,239,226,.88)}
.hero .btns{justify-content:center}
.hero .btn-p{background:${ctx.P.accentLight};border-color:${ctx.P.accentLight};color:#16130f}
.hero .btn-s{color:#f6efe2}
.hero .btn-s:hover{background:#f6efe2;color:#16130f;border-color:#f6efe2}
.h-scroll{position:absolute;bottom:42px;left:50%;transform:translateX(-50%);font-family:var(--fu);font-size:.66rem;letter-spacing:.4em;text-transform:uppercase;text-decoration:none;color:rgba(246,239,226,.7);display:grid;justify-items:center;gap:12px}
.h-scroll::after{content:'';width:1px;height:46px;background:linear-gradient(rgba(246,239,226,.7),transparent);animation:drip 2.2s ease-in-out infinite}
@keyframes drip{0%{transform:scaleY(0);transform-origin:top}50%{transform:scaleY(1);transform-origin:top}51%{transform-origin:bottom}100%{transform:scaleY(0);transform-origin:bottom}}
.card{text-align:center;background:transparent;border-color:var(--line);padding:clamp(34px,3.6vw,52px) clamp(24px,3vw,40px)}
.card:hover{border-color:var(--accent);background:var(--surface)}
.c-i{background:transparent;border:1px solid var(--accent);border-radius:50%;width:64px;height:64px;font-size:24px}
.c-n{position:static;display:block;font-family:var(--fd);font-style:italic;font-size:1rem;letter-spacing:.05em;color:var(--accent-text);margin-bottom:6px}
.c-price{font-family:var(--fd);font-size:1.3rem;font-weight:500}
.chi-media>.m{border-radius:0}
.chi-media::before{content:'';position:absolute;inset:-18px 18px 18px -18px;border:1px solid var(--accent);z-index:0}
.chi-media>.m{z-index:1}
.sign{display:block}
.menu-wrap{gap:clamp(48px,6vw,80px) clamp(48px,8vw,120px)}
.mg-h{text-align:center;font-style:italic;font-weight:400;font-size:2rem;border:0;padding:0;margin-bottom:18px}
.mg-h::after{content:'';display:block;width:110px;height:12px;margin:14px auto 0;background:${ctx.orn} center/contain no-repeat}
.mi-n{font-size:1.4rem;font-weight:500}
.mi-p{font-family:var(--fd);font-size:1.3rem;font-weight:500}
.mi-d{font-style:italic;font-family:var(--fd);font-size:1.08rem}
.gal{--gg:10px}
.t-inv .q{background:transparent;border:0;text-align:center;align-items:center;padding:10px}
.q{border:0;background:transparent;text-align:center;align-items:center}
.q::before{content:'\\201C';font-family:var(--fd);font-size:5.5rem;line-height:.6;height:.5em;color:var(--accent-text)}
.q blockquote{font-family:var(--fd);font-style:italic;font-size:1.45rem;line-height:1.45}
.q-a{flex-direction:column;gap:10px}
.q-a b{font-family:var(--fu);letter-spacing:.2em;text-transform:uppercase;font-size:.78rem}
.q-s{color:var(--accent-text)}
.stats{text-align:center}
.st-n{font-weight:400}
.st-n small{color:var(--accent-text)}
.st-l{font-family:var(--fu);letter-spacing:.2em;text-transform:uppercase;font-size:.72rem}
.plan{border-radius:0;text-align:center;background:transparent}
.plan ul{justify-items:center}
.plan.ft{background:var(--inv);color:var(--inv-text);border-color:var(--inv);outline:1px solid var(--accent);outline-offset:-10px}
.plan.ft .btn-p{background:${ctx.P.accentLight};border-color:${ctx.P.accentLight};color:#16130f}
.badge{background:var(--accent);color:var(--accent-ink);border-radius:0}
.plan-p{font-weight:400}
.cta-box{background:var(--inv);color:var(--inv-text);border-radius:0;outline:1px solid ${rgba(ctx.P.accent, 0.6)};outline-offset:-14px}
.cta-box h2{font-weight:400}
.cta-box h2 em{color:${ctx.P.accentLight}}
.cta-box .btn-p{background:${ctx.P.accentLight};border-color:${ctx.P.accentLight};color:#16130f}
.cta-box .btn-s{color:var(--inv-text)}
.cta-art{opacity:.5}
.cta-photo{opacity:1}.cta-photo::after{content:'';position:absolute;inset:0;background:rgba(16,13,10,.72)}
.faq-l summary{font-weight:500;font-size:1.4rem}
.tm{text-align:center}.tm-m{border-radius:0}
.tm h3{font-weight:500;font-size:1.5rem}
.work-m,.prod-m{border-radius:0}
.prod{text-align:center}.prod-top{flex-direction:column;align-items:center;gap:4px}.prod-p{font-family:var(--fd);font-size:1.3rem;font-weight:500}.lnk{align-self:center}
.foot{background:var(--inv);color:var(--inv-text);--text:var(--inv-text);--muted:var(--inv-muted);--line:var(--inv-line);--accent-text:var(--inv-accent-text);text-align:left}
.foot .brand-name{font-size:2rem}
.form{background:transparent;border-color:var(--line)}
.fld input,.fld textarea{border-radius:0;background:transparent;border-width:0 0 1px;padding-inline:0}
.fld input:focus,.fld textarea:focus{box-shadow:none}
.ct-i{border-radius:50%;background:transparent;border:1px solid var(--accent)}
.map,.hours{border-radius:0}
.tl-t{font-style:italic;font-weight:500;font-size:1.4rem}
`,
    audace: (ctx) => `
:root{--r:0px;--r-lg:0px;--hw:400;--hls:.004em;--fs:17px;--h2:clamp(3rem,8.4vw,7rem);--h3:1.5rem;--btn-r:0;--btn-tt:uppercase;--btn-fw:800;--btn-ls:.04em;--btn-bw:2px;--btn-pad:17px 28px;--navh:78px;--star:var(--text);--em-style:normal;--em-color:var(--accent-text)}
h1,h2,.mg-h{text-transform:uppercase;line-height:.92}
h3{font-family:var(--fb);font-weight:800;letter-spacing:-.01em;line-height:1.2}
.nav{border-bottom:2px solid var(--text)}
.brand-name{font-weight:400;text-transform:uppercase;font-size:1.75rem;letter-spacing:.01em}
.menu a{font-weight:700;text-transform:uppercase;font-size:.82rem;letter-spacing:.06em;opacity:1}
.menu a:hover{color:var(--accent-text)}
.menu .btn-s{background:var(--text);color:var(--bg);border-color:var(--text)}
.menu .btn-s:hover{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.btn{box-shadow:5px 5px 0 var(--text)}
.btn:hover{transform:translate(-2px,-2px);box-shadow:7px 7px 0 var(--text)}
.btn-p{border-color:var(--text)}
.btn-s{background:var(--surface);color:var(--text);border-color:var(--text)}
.btn-s:hover{background:var(--surface);color:var(--text)}
.t-inv .btn{box-shadow:5px 5px 0 var(--accent)}
.hero{position:relative;padding:clamp(48px,7vw,96px) 0 clamp(64px,8vw,110px);overflow:hidden}
.hero::before{content:'';position:absolute;inset:0;background-image:radial-gradient(${rgba(ctx.P.text, 0.13)} 1.5px,transparent 1.6px);background-size:26px 26px;mask-image:linear-gradient(90deg,#000,transparent 60%);-webkit-mask-image:linear-gradient(90deg,#000,transparent 60%);pointer-events:none}
.h-g{position:relative;display:grid;grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr);gap:clamp(36px,5vw,72px);align-items:center}
.h-tag{display:inline-flex;align-items:center;gap:10px;background:var(--text);color:var(--bg);font-family:var(--fu);font-weight:800;font-size:.78rem;letter-spacing:.14em;text-transform:uppercase;padding:9px 14px;margin-bottom:26px}
.h-tag i{width:9px;height:9px;border-radius:50%;background:var(--accent);display:block}
.h-t{font-size:var(--tsize);line-height:.86;letter-spacing:-.005em;margin-bottom:28px;overflow-wrap:anywhere}
.h-t em{font-style:normal;color:var(--accent);-webkit-text-stroke:0}
.h-s{font-size:clamp(1.12rem,1.6vw,1.32rem);max-width:520px;font-weight:500;margin-bottom:36px}
.h-media{position:relative}
.h-frame{position:relative;aspect-ratio:4/5;border:3px solid var(--text);box-shadow:16px 16px 0 var(--accent);overflow:hidden;background:var(--bg2)}
.h-frame>.m{position:absolute;inset:0}
.h-stamp{position:absolute;left:-26px;bottom:34px;background:var(--accent);color:var(--accent-ink);border:3px solid var(--text);font:400 1.5rem/1 var(--fd);text-transform:uppercase;padding:14px 18px;transform:rotate(-6deg);box-shadow:6px 6px 0 var(--text);max-width:80%}
.h-num{position:absolute;right:-14px;top:-18px;width:96px;height:96px;border-radius:50%;background:var(--text);color:var(--bg);display:grid;place-items:center;text-align:center;font:800 .7rem/1.15 var(--fu);letter-spacing:.08em;text-transform:uppercase;transform:rotate(10deg);border:3px solid var(--text)}
.h-num b{display:block;font:400 1.9rem/1 var(--fd);color:var(--accent)}
@media(max-width:880px){.h-g{grid-template-columns:minmax(0,1fr)}.h-media{max-width:440px;margin-right:16px}.h-stamp{left:-8px}}
.mq{background:var(--accent);color:var(--accent-ink);border-block:2px solid var(--text);--mqg:34px}
.mq-t{padding-block:16px;font:400 clamp(1.5rem,3vw,2.3rem)/1 var(--fd);text-transform:uppercase}
.mq-t i{font-style:normal;color:var(--text)}
.sh{max-width:none}
.sh-k{background:var(--text);color:var(--bg);padding:7px 12px;letter-spacing:.12em;font-weight:800}
.t-inv .sh-k{background:var(--accent);color:var(--accent-ink)}
.sh-n{display:block;font:400 1rem/1 var(--fd);color:var(--accent-text);margin-bottom:12px;letter-spacing:.1em}
.sh-t{max-width:14ch}
.sh-p{font-size:1.15rem;font-weight:500}
.sh.c .sh-t{margin-inline:auto}
.card{border:2px solid var(--text);background:var(--surface)}
.card:hover{transform:translate(-5px,-5px);box-shadow:10px 10px 0 var(--text)}
.c-i{background:var(--text);color:var(--accent);border-radius:0}
.c-n{font:400 2.6rem/1 var(--fd);color:var(--accent-text);letter-spacing:0;top:22px}
.card h3{text-transform:uppercase;font-size:1.3rem}
.c-price{background:var(--accent);color:var(--accent-ink);padding:6px 10px;border:2px solid var(--text)}
.t-inv .card{background:transparent;border-color:var(--inv-text)}
.chi-media>.m{border:3px solid var(--text)}
.chi-media::after{content:'';position:absolute;inset:22px -22px -22px 22px;background:var(--accent);z-index:-1;border:3px solid var(--text)}
.chi-media{z-index:0}
.prose p:first-child{font-weight:600;font-size:1.3rem}
.ticks li{font-weight:700;text-transform:uppercase;font-size:.9rem;letter-spacing:.04em}
.ticks .ico{background:var(--accent);color:var(--accent-ink);border-radius:50%;padding:3px;width:1.3em;height:1.3em;margin-top:.05em;stroke-width:3}
.mg-h{font-size:2.6rem;border-bottom:3px solid var(--text)}
.mi-n{font-family:var(--fb);font-weight:800;text-transform:uppercase;font-size:1.02rem;letter-spacing:.02em}
.mi-dots{border-bottom:2px solid var(--text);opacity:.2}
.mi-p{background:var(--text);color:var(--bg);padding:4px 8px;font-size:.95rem}
.gal{--gg:3px;background:var(--text);border:3px solid var(--text)}
.g-it{border-radius:0}
.g-cap{background:var(--accent);color:var(--accent-ink);padding:10px 14px;left:auto;right:auto;bottom:12px;left:12px;font-weight:800;text-transform:uppercase;font-size:.78rem;letter-spacing:.06em;border:2px solid var(--text)}
.stats{border-top:2px solid var(--line)}
.stats>div{padding-top:24px}
.st-n{color:var(--accent);font-size:clamp(3.2rem,7.5vw,6.6rem);letter-spacing:0}
.st-n small{color:var(--inv-text)}
.st-l{text-transform:uppercase;font-weight:700;letter-spacing:.06em;font-size:.88rem}
.q{border:2px solid var(--text);box-shadow:8px 8px 0 var(--accent)}
.q blockquote{font-weight:500;font-size:1.12rem}
.av{border-radius:0;border:2px solid var(--text)}
.plan{border:2px solid var(--text)}
.plan.ft{background:var(--text);color:var(--bg);border-color:var(--text);box-shadow:10px 10px 0 var(--accent)}
.plan.ft .btn-p{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.plan.ft li .ico{color:var(--accent)}
.badge{background:var(--accent);color:var(--accent-ink);border:2px solid var(--text);border-radius:0}
.plan-p{font-size:clamp(3rem,5vw,4.2rem)}
.cta-box{border:3px solid var(--text);box-shadow:14px 14px 0 var(--text);text-align:left}
.cta-box h2{font-size:clamp(2.6rem,7.6vw,6.4rem);max-width:13ch}
.cta-box p{margin-left:0;font-weight:500}
.cta-box .btns{justify-content:flex-start}
.cta-box .btn{box-shadow:5px 5px 0 var(--text)}
.cta-box .btn-p{background:var(--text);color:var(--bg);border-color:var(--text)}
.cta-box .btn-s{background:var(--surface);color:var(--text);border-color:var(--text)}
.cta-art{opacity:.22;left:45%}
.faq-l{border-top:3px solid var(--text)}
.faq-l details{border-bottom:2px solid var(--text)}
.faq-l summary{font-family:var(--fb);font-weight:800;text-transform:uppercase;font-size:1.02rem;letter-spacing:.02em}
.hours,.map,.form{border:2px solid var(--text);box-shadow:8px 8px 0 var(--accent)}
.hr b{text-transform:uppercase;font-weight:800;font-size:.92rem}
.fld input,.fld textarea{border:2px solid var(--text);border-radius:0}
.fld input:focus,.fld textarea:focus{box-shadow:4px 4px 0 var(--accent)}
.ct-i{background:var(--text);color:var(--accent);border-radius:0}
.tm-m{border:2px solid var(--text)}
.tm h3{text-transform:uppercase}
.work-m,.prod-m{border:2px solid var(--text)}
.work h3,.prod h3{text-transform:uppercase}
.tl::before{background:var(--text)}
.tl-i::before{border-radius:0;background:var(--accent);border:2px solid var(--text);width:18px;height:18px;transform:translateX(-9px) rotate(45deg)}
.tl-t{font-size:1.6rem;font-weight:400}
.tl-b h3{text-transform:uppercase}
.foot{background:var(--inv);--text:var(--inv-text);--muted:var(--inv-muted);--line:var(--inv-line);--accent-text:var(--inv-accent-text);color:var(--text);padding-bottom:0;overflow:hidden}
.foot .brand-name{font-size:2rem}
.foot-big{display:block;font:400 var(--fbig)/0.84 var(--fd);text-transform:uppercase;color:var(--accent);margin-top:clamp(40px,6vw,80px);white-space:nowrap;letter-spacing:-.01em;overflow:hidden}
.foot-b{margin-top:30px;padding-bottom:24px}
.wa-f{border:2px solid var(--text);box-shadow:4px 4px 0 var(--text);border-radius:0}
.wa-f::after{border-radius:0}
`,
    magazine: (ctx) => `
:root{--r:0px;--r-lg:0px;--hw:700;--hls:-.015em;--fs:18px;--h2:clamp(2.5rem,5.6vw,4.6rem);--h3:1.55rem;--btn-r:0;--btn-tt:uppercase;--btn-ls:.14em;--btn-fs:.74rem;--btn-fw:700;--btn-pad:17px 28px;--navh:58px;--em-color:var(--accent-text)}
body{line-height:1.68}
.mast{background:var(--bg);border-bottom:1px solid var(--text)}
.mast-top{display:flex;justify-content:space-between;gap:16px;padding:12px 0;border-bottom:1px solid var(--line);font:600 .7rem/1.3 var(--fu);letter-spacing:.18em;text-transform:uppercase;color:var(--muted)}
.mast-top span:nth-child(2){color:var(--accent-text)}
.mast-b{display:flex;justify-content:center;padding:clamp(18px,3vw,30px) 0}
.mast-b .brand-name{font-size:var(--mfs);font-weight:800;letter-spacing:-.03em;max-width:none;white-space:normal;text-align:center;line-height:.95}
.mast-b .brand-logo{height:clamp(56px,8vw,96px);max-width:320px}
.nav{border-bottom:3px double var(--text);background:${rgba(ctx.P.bg, 0.96)};backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.nav-in{justify-content:center;position:relative}
.nav .brand-sm{position:absolute;left:0;opacity:0;pointer-events:none;transition:opacity .3s}
.nav .brand-sm .brand-name{font-size:1.25rem;font-weight:800}
.nav.scrolled .brand-sm{opacity:1;pointer-events:auto}
.nav.scrolled .menu{padding-left:min(260px,22vw)}
.menu{gap:clamp(18px,2.6vw,40px)}
.menu a{font-family:var(--fu);font-weight:600;font-size:.74rem;letter-spacing:.18em;text-transform:uppercase;opacity:1}
.menu a:hover{color:var(--accent-text)}
.menu .btn{padding:10px 16px;box-shadow:none}
@media(max-width:960px){.nav-in{justify-content:space-between}.nav .brand-sm{position:static;opacity:1;pointer-events:auto}.nav.scrolled .menu{padding-left:var(--gut)}.mast-top span:nth-child(3){display:none}}
@media(max-width:560px){.mast-top span:nth-child(1){display:none}.mast-top{justify-content:center}}
.hero{padding:clamp(36px,5vw,64px) 0 clamp(56px,7vw,96px)}
.h-g{display:grid;grid-template-columns:minmax(0,5fr) minmax(0,7fr);gap:clamp(28px,4vw,64px);align-items:start}
.h-txt{padding-top:clamp(0px,2vw,24px);border-top:3px solid var(--text)}
.h-k{display:block;font:700 .74rem/1 var(--fu);letter-spacing:.2em;text-transform:uppercase;color:var(--accent-text);margin:18px 0 22px}
.h-t{font-size:clamp(2.6rem,5.4vw,4.9rem);line-height:1.02;font-weight:700;letter-spacing:-.025em;margin-bottom:28px}
.h-t em{font-weight:400;color:var(--accent-text)}
.h-d{font-size:1.12rem;color:var(--muted);margin-bottom:22px}
.h-d::first-letter{float:left;font:700 4.6rem/.82 var(--fd);margin:6px 12px 0 0;color:var(--accent-text)}
.h-by{font:600 .78rem/1.4 var(--fu);letter-spacing:.12em;text-transform:uppercase;border-top:1px solid var(--line);padding-top:16px;margin:28px 0 30px;color:var(--muted)}
.h-by b{color:var(--text)}
.h-fig{margin:0}
.h-img{position:relative;aspect-ratio:5/6;overflow:hidden;background:var(--bg2)}
.h-img>.m{position:absolute;inset:0}
.h-fig figcaption{font:italic 400 .95rem/1.4 var(--fb);color:var(--muted);margin-top:12px;display:flex;gap:10px}
.h-fig figcaption b{font:700 .7rem/1.8 var(--fu);letter-spacing:.16em;text-transform:uppercase;color:var(--accent-text);font-style:normal}
.h-idx{display:grid;grid-template-columns:repeat(var(--n),minmax(0,1fr));border-top:1px solid var(--text);border-bottom:1px solid var(--text);margin-top:clamp(40px,5vw,64px)}
.h-idx a{display:block;padding:18px 18px 18px 0;text-decoration:none;border-right:1px solid var(--line);font-family:var(--fd);font-size:1.1rem;line-height:1.3}
.h-idx a+a{padding-left:18px}
.h-idx a:last-child{border-right:0}
.h-idx small{display:block;font:700 .66rem/1 var(--fu);letter-spacing:.2em;text-transform:uppercase;color:var(--accent-text);margin-bottom:8px}
.h-idx a:hover{color:var(--accent-text)}
@media(max-width:880px){.h-g{grid-template-columns:minmax(0,1fr)}.h-fig{order:-1}.h-img{aspect-ratio:4/3}.h-idx{grid-template-columns:repeat(2,minmax(0,1fr))}.h-idx a:nth-child(n){padding-left:14px;border-bottom:1px solid var(--line)}}
.sh{max-width:none;border-top:3px solid var(--text);padding-top:16px;position:relative}
.sh::before{content:'';position:absolute;left:0;right:0;top:3px;border-top:1px solid var(--text)}
.sh-k{font-weight:700;letter-spacing:.2em;font-size:.72rem;margin-top:8px}
.sh-t{max-width:18ch}
.sh-p{font-style:italic;font-size:1.18rem}
.sh.c{text-align:left}
.split .sh{border-top:3px solid var(--text)}
.t-inv .sh,.t-inv .sh::before{border-color:var(--inv-text)}
.cards{gap:0;border-top:1px solid var(--line)}
.card{background:transparent;border:0;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:34px 30px 38px}
.cards .card:nth-child(3n){border-right:0}
.cards.k2 .card:nth-child(3n){border-right:1px solid var(--line)}.cards.k2 .card:nth-child(2n){border-right:0}
.c-i{display:none}
.c-n{position:static;display:block;font:700 .7rem/1 var(--fu);letter-spacing:.2em;color:var(--accent-text);margin-bottom:22px}
.card h3{font-size:1.7rem;line-height:1.12}
.card p{font-size:1.02rem}
.c-price{font-family:var(--fd);font-style:italic;font-size:1.25rem;font-weight:400}
@media(max-width:1000px){.cards .card{border-right:0}}
.chi-media{aspect-ratio:3/4}
.prose p:first-child::first-letter{float:left;font:700 5rem/.8 var(--fd);margin:8px 14px 0 0;color:var(--accent-text)}
.prose p:first-child{font-size:1.24rem}
.chi-cap{font:italic .92rem var(--fb);color:var(--muted);margin-top:12px}
.ticks{border-top:1px solid var(--line);padding-top:24px}
.mg-h{font-style:italic;font-weight:400;font-size:2rem;border-bottom:1px solid var(--text)}
.mi-n{font-weight:700;font-size:1.25rem}
.mi-p{font-family:var(--fd);font-style:italic;font-weight:400;font-size:1.2rem}
.gal{--gg:18px}
.g-cap{background:none;padding:0;position:absolute;left:0;bottom:0;right:auto;opacity:1;translate:none}
.g-cap span{display:inline-block;background:var(--bg);color:var(--text);font:600 .7rem/1 var(--fu);letter-spacing:.16em;text-transform:uppercase;padding:9px 12px}
.quotes{gap:clamp(28px,4vw,56px)}
.q{background:transparent;border:0;border-left:3px solid var(--accent);padding:4px 0 4px 28px}
.q-s{display:none}
.q blockquote{font-family:var(--fd);font-style:italic;font-size:1.42rem;line-height:1.38}
.q:first-child blockquote{font-size:1.6rem}
.av{display:none}
.q-a b{font:700 .74rem/1.4 var(--fu);letter-spacing:.16em;text-transform:uppercase}
.st-n{font-style:italic;font-weight:400}
.stats>div{border-left:1px solid var(--line);padding-left:24px}
.st-l{font-family:var(--fu);font-size:.8rem;letter-spacing:.12em;text-transform:uppercase}
.plan{background:transparent;border:1px solid var(--text)}
.plan.ft{background:var(--text);color:var(--bg);border-color:var(--text)}
.plan.ft .btn-p{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.badge{background:var(--accent);color:var(--accent-ink);border-radius:0}
.plan-p{font-style:italic;font-weight:400}
.cta-box{background:var(--inv);color:var(--inv-text);text-align:left;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:40px;align-items:end;padding:clamp(48px,6vw,88px)}
.cta-box h2 em{color:${ctx.P.accentOnInv};font-weight:400}
.cta-box p{margin:0 0 28px;font-style:italic}
.cta-box .btns{justify-content:flex-start}
.cta-box .btn-p{background:${ctx.P.accentOnInv};color:var(--inv);border-color:${ctx.P.accentOnInv}}
.cta-box .btn-s{color:var(--inv-text)}
.cta-art{display:none}
@media(max-width:820px){.cta-box{grid-template-columns:minmax(0,1fr)}}
.faq-l summary{font-size:1.3rem}
.tm-m{aspect-ratio:3/4}
.tm h3{font-style:italic;font-weight:400;font-size:1.5rem}
.tm p{font:600 .74rem/1.4 var(--fu);letter-spacing:.14em;text-transform:uppercase}
.works{grid-template-columns:repeat(12,minmax(0,1fr))}
.works .work{grid-column:span 6;margin-top:0!important}
.works .work:nth-child(3n+1){grid-column:span 7}.works .work:nth-child(3n+2){grid-column:span 5}.works .work:nth-child(3n){grid-column:2 / span 10}
.works .work:nth-child(3n) .work-m{aspect-ratio:21/9}
.works .work:nth-child(3n+2) .work-m{aspect-ratio:4/5}
.work h3{font-size:clamp(1.6rem,2.6vw,2.2rem)}
.work-meta{color:var(--accent-text)}
@media(max-width:860px){.works .work:nth-child(n){grid-column:1 / -1}.works .work:nth-child(n) .work-m{aspect-ratio:4/3}}
.prods{gap:48px 30px}
.prod h3{font-size:1.45rem}
.prod-p{font-family:var(--fd);font-style:italic;font-weight:400;font-size:1.25rem;color:var(--text)}
.prod:nth-child(3n+2){margin-top:40px}
@media(max-width:900px){.prod:nth-child(n){margin-top:0}}
.foot{background:var(--inv);--text:var(--inv-text);--muted:var(--inv-muted);--line:var(--inv-line);--accent-text:var(--inv-accent-text);color:var(--text)}
.foot .brand-name{font-size:2.2rem;font-weight:800}
.form{background:transparent;border:1px solid var(--text)}
.fld input,.fld textarea{border-radius:0;background:var(--surface)}
.ct-i{background:transparent;border:1px solid var(--line);border-radius:0}
.hours{border:1px solid var(--text)}
.tl-t{font-style:italic;font-weight:400;font-size:1.4rem}
`,
    aurora: (ctx) => `
:root{--r:18px;--r-lg:26px;--hw:700;--hls:-.035em;--fs:16.5px;--h2:clamp(2.3rem,4.8vw,3.8rem);--h3:1.3rem;--btn-r:999px;--btn-fw:600;--navh:76px;--surface:rgba(255,255,255,.045);--line:rgba(255,255,255,.1);--field:rgba(255,255,255,.04);--em-style:normal}
body{background:radial-gradient(1100px 700px at 8% -10%,${rgba(ctx.P.accent, 0.28)},transparent 60%),radial-gradient(900px 600px at 105% 8%,${rgba(ctx.P.a2, 0.16)},transparent 60%),radial-gradient(900px 700px at 50% 110%,${rgba(ctx.P.a3, 0.12)},transparent 60%),var(--bg);background-attachment:fixed}
h1,h2,h3{letter-spacing:-.035em}
.sec{background:transparent}
.t-alt{background:linear-gradient(180deg,transparent,rgba(255,255,255,.025) 20%,rgba(255,255,255,.025) 80%,transparent)}
.sh-t em,.h-t em,.cta-box h2 em{background:linear-gradient(100deg,${ctx.P.accentLight},${ctx.P.a2} 50%,${ctx.P.a3});-webkit-background-clip:text;background-clip:text;color:transparent;padding-right:.04em}
.sh-k{display:inline-flex;padding:7px 14px;border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.04);letter-spacing:.12em;color:${ctx.P.accentLight}}
.sh{text-align:center;margin-inline:auto}.sh .sh-p{margin-inline:auto}
.split .sh,.chi-body .sh{text-align:left;margin-inline:0}
.nav{position:fixed;top:14px;left:0;right:0;background:transparent}
.nav-in{background:rgba(14,14,40,.55);backdrop-filter:blur(18px) saturate(1.4);-webkit-backdrop-filter:blur(18px) saturate(1.4);border:1px solid rgba(255,255,255,.1);border-radius:999px;padding:0 10px 0 20px;min-height:62px;box-shadow:0 20px 50px -20px rgba(0,0,0,.6)}
.menu a:hover{color:#fff}
.mono{display:grid;border-radius:11px;width:34px;height:34px;background:linear-gradient(135deg,var(--accent),var(--a2));color:#fff;font-family:var(--fd);font-size:.85rem}
.brand-name{font-size:1.18rem;letter-spacing:-.02em}
.menu .btn{padding:11px 20px}
@media(max-width:960px){.menu{top:calc(100% + 10px);border-radius:22px;border:1px solid var(--line);background:rgba(14,14,40,.96);backdrop-filter:blur(18px);left:var(--gut);right:var(--gut);padding:8px 22px 22px}}
.btn-p{background:linear-gradient(135deg,${ctx.P.accent},${mix(ctx.P.accent, ctx.P.a3, 0.45)});border-color:transparent;color:#fff;box-shadow:0 10px 30px -10px ${rgba(ctx.P.accent, 0.8)},inset 0 1px 0 rgba(255,255,255,.25)}
.btn-s{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.04)}
.btn-s:hover{background:rgba(255,255,255,.1);color:#fff;border-color:rgba(255,255,255,.3)}
.hero{position:relative;padding:calc(var(--navh) + 90px) 0 clamp(70px,9vw,120px);text-align:center;overflow:hidden}
.h-mesh{position:absolute;inset:-10% -10% auto;height:120%;z-index:0;pointer-events:none}
.h-mesh i{position:absolute;border-radius:50%;filter:blur(80px);opacity:.55;animation:float 16s ease-in-out infinite alternate}
.h-mesh i:nth-child(1){width:46vw;height:46vw;left:-8vw;top:0;background:var(--accent)}
.h-mesh i:nth-child(2){width:36vw;height:36vw;right:-6vw;top:6%;background:var(--a2);animation-delay:-5s;opacity:.35}
.h-mesh i:nth-child(3){width:30vw;height:30vw;left:35%;top:30%;background:var(--a3);animation-delay:-9s;opacity:.3}
@keyframes float{to{transform:translate(4vw,6vh) scale(1.1)}}
.h-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:64px 64px;mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 75%);-webkit-mask-image:radial-gradient(ellipse 70% 60% at 50% 30%,#000 30%,transparent 75%);pointer-events:none}
.h-c{position:relative;z-index:1}
.pill{display:inline-flex;align-items:center;gap:10px;padding:7px 16px 7px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.05);backdrop-filter:blur(8px);font-size:.88rem;color:var(--muted);text-decoration:none;margin-bottom:30px;max-width:100%}
.pill b{background:linear-gradient(135deg,var(--accent),var(--a2));color:#fff;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;padding:4px 10px;border-radius:999px;flex:none}
.pill span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.h-t{font-size:clamp(2.9rem,8.4vw,6.6rem);line-height:.98;letter-spacing:-.045em;background:linear-gradient(180deg,#fff 35%,rgba(255,255,255,.62));-webkit-background-clip:text;background-clip:text;color:transparent;max-width:15ch;margin:0 auto 26px;padding-bottom:.06em}
.h-t.t-l{font-size:clamp(2.4rem,6vw,4.8rem);max-width:20ch}
.h-s{font-size:clamp(1.1rem,1.8vw,1.32rem);color:var(--muted);max-width:620px;margin:0 auto 38px}
.hero .btns{justify-content:center}
.h-trust{display:flex;justify-content:center;flex-wrap:wrap;gap:8px 22px;margin-top:30px;color:var(--muted);font-size:.9rem}
.h-trust b{color:var(--text)}
.h-trust .st{color:#fbbf24;letter-spacing:2px}
.h-shot{position:relative;margin:clamp(56px,7vw,90px) auto 0;max-width:1080px;perspective:1800px}
.h-shot::before{content:'';position:absolute;inset:10% 6% -4%;background:linear-gradient(90deg,var(--accent),var(--a2),var(--a3));filter:blur(70px);opacity:.45;border-radius:40px}
.h-win{position:relative;aspect-ratio:16/9.6;border-radius:22px;overflow:hidden;border:1px solid rgba(255,255,255,.14);background:#0d0d26;box-shadow:0 40px 100px -30px rgba(0,0,0,.8),inset 0 1px 0 rgba(255,255,255,.1);transform:rotateX(10deg);transform-origin:50% 100%}
.h-win>.m{position:absolute;inset:0}
.card{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid rgba(255,255,255,.09);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.card:hover{transform:translateY(-4px);border-color:${rgba(ctx.P.accent, 0.55)};box-shadow:0 30px 60px -30px ${rgba(ctx.P.accent, 0.6)}}
.card.wide{background:radial-gradient(600px 260px at 100% 0%,${rgba(ctx.P.accent, 0.22)},transparent 70%),linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02))}
.c-i{background:linear-gradient(135deg,var(--accent),var(--a2));color:#fff;border-radius:16px;box-shadow:0 10px 24px -8px ${rgba(ctx.P.accent, 0.7)}}
.c-n{color:rgba(255,255,255,.3)}
.c-price{color:${ctx.P.a2}}
.chi-media>.m{border:1px solid rgba(255,255,255,.12)}
.chi-media::before{content:'';position:absolute;inset:8%;background:linear-gradient(135deg,var(--accent),var(--a3));filter:blur(60px);opacity:.45;z-index:-1}
.chi-media{z-index:0}
.ticks .ico{color:${ctx.P.a2}}
.mi-p{color:${ctx.P.a2}}
.menu-wrap .mg{background:var(--surface);border:1px solid var(--line);border-radius:var(--r-lg);padding:30px 34px}
.gal{--gg:16px}
.g-it{border:1px solid rgba(255,255,255,.08)}
.stats{background:linear-gradient(180deg,rgba(255,255,255,.06),rgba(255,255,255,.02));border:1px solid var(--line);border-radius:var(--r-lg);padding:clamp(30px,4vw,54px);text-align:center}
.st-n{background:linear-gradient(180deg,#fff,${rgba('#ffffff', 0.55)});-webkit-background-clip:text;background-clip:text;color:transparent}
.st-n small{-webkit-text-fill-color:${ctx.P.a2};color:${ctx.P.a2}}
.q{background:linear-gradient(180deg,rgba(255,255,255,.055),rgba(255,255,255,.015))}
.q:nth-child(2){transform:translateY(28px)}
@media(max-width:900px){.q:nth-child(2){transform:none}}
.q-s{color:#fbbf24}
.plan{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015))}
.plan.ft{background:linear-gradient(${mix(ctx.P.bg, ctx.P.accent, 0.16)},${mix(ctx.P.bg, ctx.P.accent, 0.06)}) padding-box,linear-gradient(135deg,var(--accent),var(--a2),var(--a3)) border-box;border:1.5px solid transparent;color:var(--text);box-shadow:0 40px 80px -40px ${rgba(ctx.P.accent, 0.8)}}
.plan.ft .plan-per{color:var(--muted)}.plan.ft li .ico{color:${ctx.P.a2};opacity:1}
.plan.ft .btn-p{background:linear-gradient(135deg,${ctx.P.accent},${mix(ctx.P.accent, ctx.P.a3, 0.45)});color:#fff;border-color:transparent}
.badge{background:linear-gradient(135deg,var(--accent),var(--a2));color:#fff}
.cta-box{background:radial-gradient(700px 400px at 0% 0%,${rgba(ctx.P.accent, 0.55)},transparent 60%),radial-gradient(600px 400px at 100% 100%,${rgba(ctx.P.a2, 0.4)},transparent 60%),#12123a;color:#fff;border:1px solid rgba(255,255,255,.12)}
.cta-box .btn-p{background:#fff;color:#0b0b22;border-color:#fff;box-shadow:none}
.cta-box .btn-s{color:#fff}
.cta-art{opacity:.25;mix-blend-mode:screen}
.faq-l{border-top:0;gap:12px}
.faq-l details{border:1px solid var(--line);border-radius:18px;background:var(--surface);padding:0 24px}
.faq-l summary{font-size:1.08rem;padding:20px 0}
.hours,.map,.form{background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(255,255,255,.015))}
.ct-i{background:linear-gradient(135deg,${rgba(ctx.P.accent, 0.35)},${rgba(ctx.P.a2, 0.25)});color:#fff}
.fld input,.fld textarea{background:rgba(255,255,255,.04)}
.tm-m{border-radius:22px}
.work-m,.prod-m{border:1px solid rgba(255,255,255,.08)}
.tl::before{background:linear-gradient(var(--accent),var(--a2),var(--a3))}
.tl-i::before{background:var(--bg);border:3px solid var(--a2)}
.foot{background:transparent;border-top:1px solid var(--line)}
.wa-f{box-shadow:0 12px 40px -6px rgba(37,211,102,.6)}
`,
    minimal: (ctx) => `
:root{--r:0px;--r-lg:0px;--hw:500;--hls:-.035em;--fs:16.5px;--h2:clamp(2.3rem,5.4vw,4.4rem);--h3:1.35rem;--btn-r:0;--btn-fw:500;--btn-pad:16px 22px;--btn-bw:1px;--navh:68px;--maxw:1280px;--em-style:normal;--em-color:var(--muted)}
body{letter-spacing:-.005em}
h1,h2,h3{letter-spacing:-.04em}
.nav{border-bottom:1px solid var(--line);background:${rgba(ctx.P.bg, 0.92)};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.brand-name{font-weight:600;font-size:1.15rem;letter-spacing:-.03em}
.brand-name::after{content:'';display:inline-block;width:.42em;height:.42em;background:var(--accent);margin-left:.18em;vertical-align:baseline}
.menu a{font-family:var(--fu);font-size:.74rem;letter-spacing:.04em;text-transform:uppercase;opacity:.7}
.menu a b{font-weight:400;color:var(--muted);margin-right:6px}
.menu a:hover{opacity:1;color:var(--accent-text)}
.btn{font-family:var(--fu);font-size:.8rem;text-transform:uppercase;letter-spacing:.04em}
.btn-p{background:var(--text);border-color:var(--text);color:var(--bg)}
.btn-p:hover{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);box-shadow:none;transform:none}
.btn .ico{transition:transform .25s}.btn:hover .ico{transform:translateX(4px)}
.btn-s:hover{background:transparent;color:var(--accent-text);border-color:var(--accent-text)}
.hero{position:relative;padding:clamp(36px,5vw,64px) 0 clamp(40px,6vw,80px)}
.h-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;font:400 .74rem/1.4 var(--fu);text-transform:uppercase;letter-spacing:.04em;color:var(--muted);padding-bottom:18px;border-bottom:1px solid var(--line)}
.h-meta span:nth-child(2){text-align:center}.h-meta span:nth-child(3){text-align:right}
.h-t{font-size:var(--tsize);line-height:.88;letter-spacing:-.06em;font-weight:500;margin:clamp(36px,6vw,80px) 0 clamp(32px,5vw,64px);overflow-wrap:anywhere}
.h-t .dot{color:var(--accent)}
.h-row{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:clamp(24px,5vw,80px);align-items:end;padding-bottom:clamp(36px,5vw,64px)}
.h-s{font-size:clamp(1.4rem,2.6vw,2.15rem);line-height:1.2;letter-spacing:-.025em;margin:0;max-width:22ch}
.h-d{color:var(--muted);max-width:46ch;margin-bottom:26px}
.h-img{position:relative;aspect-ratio:21/9;overflow:hidden;background:var(--bg2)}
.h-img>.m{position:absolute;inset:0}
.h-img figcaption{position:absolute;left:0;bottom:0;background:var(--bg);font:400 .72rem/1 var(--fu);text-transform:uppercase;padding:10px 12px 0 0;color:var(--muted)}
@media(max-width:760px){.h-row{grid-template-columns:minmax(0,1fr)}.h-meta{grid-template-columns:1fr 1fr}.h-meta span:nth-child(3){display:none}.h-meta span:nth-child(2){text-align:right}.h-img{aspect-ratio:4/3}}
.sh{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,2fr);column-gap:clamp(24px,4vw,64px);max-width:none;border-top:1px solid var(--text);padding-top:22px}
.sh-k{grid-column:1;grid-row:1 / span 2;align-self:start;font-weight:400;letter-spacing:.04em;color:var(--text);font-size:.74rem}
.sh-k::before{content:attr(data-n);color:var(--muted);margin-right:4px}
.sh-t{grid-column:2;font-weight:500}
.sh-p{grid-column:2;max-width:56ch}
.sh.c{text-align:left}.sh.c .sh-p{margin-inline:0}
.t-inv .sh{border-color:var(--inv-text)}.t-inv .sh-k{color:var(--inv-text)}
.split .sh,.chi-body .sh{display:block;border-top:1px solid var(--text)}
.split .sh-k,.chi-body .sh-k{margin-bottom:22px}
@media(max-width:760px){.sh{grid-template-columns:minmax(0,1fr)}.sh-k,.sh-t,.sh-p{grid-column:1;grid-row:auto}.sh-k{margin-bottom:16px}}
.cards{display:block;border-top:1px solid var(--line)}
.card{display:grid;grid-template-columns:70px minmax(0,1fr) minmax(0,1.3fr) minmax(90px,auto);gap:24px;align-items:baseline;background:none;border:0;border-bottom:1px solid var(--line);border-radius:0;padding:30px 0}
.card:hover{padding-left:12px;background:transparent}
.card:hover h3{color:var(--accent-text)}
.c-i{display:none}
.c-n{position:static;font-family:var(--fu);font-weight:400;font-size:.8rem;color:var(--muted)}
.card h3{font-weight:500;margin:0;font-size:1.5rem;transition:color .25s}
.c-price{margin:0;text-align:right;font-family:var(--fu);font-weight:400;color:var(--text)}
.cards .wide{grid-column:auto}
@media(max-width:760px){.card{grid-template-columns:46px minmax(0,1fr);gap:8px 14px}.card p,.c-price{grid-column:2;text-align:left}}
.chi-media>.m{filter:grayscale(.15)}
.chi-media::after{content:'';position:absolute;right:-14px;bottom:-14px;width:28%;aspect-ratio:1;background:var(--accent);z-index:-1}
.chi-media{z-index:0}
.ticks{border-top:1px solid var(--line);padding-top:0;gap:0}
.ticks li{padding:14px 0;border-bottom:1px solid var(--line);font-weight:400}
.ticks .ico{color:var(--accent-text)}
.mg-h{font-weight:500;font-size:1.1rem;font-family:var(--fu);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--text)}
.mi-n{font-weight:500}
.mi-dots{border-bottom:1px solid var(--line)}
.mi-p{font-weight:400;color:var(--text)}
.gal{--gg:8px}
.g-cap{background:none;padding:0;left:0;bottom:0;right:auto;opacity:1;translate:none}
.g-cap span{display:inline-block;background:var(--bg);color:var(--text);font:400 .7rem/1 var(--fu);text-transform:uppercase;padding:10px 12px 0 0}
.stats{border-top:1px solid var(--line)}
.stats>div{padding-top:22px;border-right:1px solid var(--line)}
.stats>div:last-child{border-right:0}
.st-n{font-weight:500;letter-spacing:-.06em;font-size:clamp(3rem,7vw,6.4rem)}
.st-n small{color:var(--accent)}
.st-l{font-family:var(--fu);font-size:.76rem;text-transform:uppercase;letter-spacing:.04em}
@media(max-width:860px){.stats>div:nth-child(2n){border-right:0}}
.quotes{gap:0;border-top:1px solid var(--line)}
.q{background:none;border:0;border-right:1px solid var(--line);border-radius:0;padding:32px 32px 32px 0}
.q+.q{padding-left:32px}
.q:last-child{border-right:0}
.q-s{display:none}
.q blockquote{font-size:1.32rem;line-height:1.4;letter-spacing:-.02em}
.av{border-radius:0;width:38px;height:38px;font-family:var(--fu);font-weight:400}
@media(max-width:900px){.q,.q+.q{border-right:0;border-bottom:1px solid var(--line);padding:28px 0}}
.plans{gap:0;border:1px solid var(--line)}
.plan{border:0;border-right:1px solid var(--line);border-radius:0;background:transparent}
.plan:last-child{border-right:0}
.plan.ft{background:var(--text);color:var(--bg)}
.plan.ft .btn-p{background:var(--accent);color:var(--accent-ink);border-color:var(--accent)}
.plan.ft li .ico{color:var(--accent);opacity:1}
.plan-n{font-weight:400;font-family:var(--fu)}
.plan-p{font-weight:500;letter-spacing:-.05em}
.badge{background:var(--accent);color:var(--accent-ink);border-radius:0;font-weight:400;left:auto;right:16px;top:16px;transform:none}
@media(max-width:900px){.plan{border-right:0;border-bottom:1px solid var(--line)}}
.cta-box{text-align:left;padding:clamp(48px,7vw,100px) clamp(24px,5vw,72px)}
.cta-box h2{font-weight:500;letter-spacing:-.05em;font-size:clamp(2.4rem,7vw,6rem);max-width:14ch}
.cta-box p{margin-left:0}
.cta-box .btns{justify-content:flex-start}
.cta-art{display:none}
.cta-box .btn-p:hover{background:var(--accent-ink);color:var(--accent)}
.faq-l summary{font-family:var(--fb);font-weight:500;letter-spacing:-.02em}
.hours,.map,.form{border:1px solid var(--line);background:transparent}
.hours{padding-block:8px}
.fld span{font-family:var(--fu);font-weight:400;text-transform:uppercase;font-size:.72rem;letter-spacing:.04em}
.fld input,.fld textarea{border-radius:0;background:transparent;border-width:0 0 1px;padding-inline:0}
.fld input:focus,.fld textarea:focus{box-shadow:none}
.ct-i{background:transparent;border:1px solid var(--line);border-radius:0}
.tm-m{filter:grayscale(1)}
.tm h3{font-weight:500}
.tm p{font-family:var(--fu);font-size:.76rem;text-transform:uppercase}
.work-meta{font-weight:400}
.work h3{font-weight:500}
.prod h3{font-weight:500}
.prod-p{font-weight:400;color:var(--text)}
.tl::before{width:1px}
.tl-i::before{border-radius:0;width:9px;height:9px;transform:translateX(-4.5px);top:36px}
.tl-t{font-family:var(--fu);font-weight:400;font-size:.95rem;color:var(--text)}
.foot{border-top:1px solid var(--text)}
.foot-big{display:block;font:500 var(--fbig)/.86 var(--fd);letter-spacing:-.06em;margin-top:clamp(48px,6vw,88px);white-space:nowrap;overflow:hidden}
.foot-big .dot{color:var(--accent)}
.wa-f{border-radius:0}
.wa-f::after{border-radius:0}
`,
    calore: (ctx) => `
:root{--r:22px;--r-lg:34px;--hw:600;--hls:-.02em;--fs:17px;--h2:clamp(2.4rem,5vw,4rem);--h3:1.45rem;--btn-r:999px;--btn-fw:700;--navh:80px;--fr:14px;--star:${ctx.P.a3};--em-color:var(--accent-text)}
h1,h2,h3{font-variation-settings:'SOFT' 100,'WONK' 1}
.nav{background:${rgba(ctx.P.bg, 0.9)};backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}
.nav.scrolled{box-shadow:0 10px 30px -18px rgba(80,40,10,.4)}
.mono{display:grid;width:46px;height:46px;background:var(--accent);color:var(--accent-ink);border-radius:58% 42% 55% 45% / 50% 55% 45% 50%;font-style:italic;font-size:1.05rem}
.brand-name{font-weight:600;font-size:1.4rem;letter-spacing:-.02em}
.menu a{font-weight:500}
.menu a:hover{color:var(--accent-text)}
.btn-p{box-shadow:0 10px 24px -10px ${rgba(ctx.P.accent, 0.8)}}
.btn-s{border-color:${rgba(ctx.P.text, 0.25)}}
.btn-s:hover{background:var(--text);color:var(--bg)}
.hero{position:relative;padding:clamp(40px,6vw,80px) 0 clamp(110px,12vw,170px);overflow:hidden}
.h-blob{position:absolute;pointer-events:none;z-index:0}
.h-blob.b1{width:48vw;max-width:680px;right:-12vw;top:-10vw;color:${mix(ctx.P.a3, ctx.P.bg, 0.55)}}
.h-blob.b2{width:24vw;max-width:340px;left:-8vw;bottom:2vw;color:${mix(ctx.P.a2, ctx.P.bg, 0.72)}}
.h-g{position:relative;z-index:1;display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,.9fr);gap:clamp(40px,6vw,90px);align-items:center}
.h-k{display:inline-flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line);color:var(--accent-text);font:700 .78rem/1 var(--fu);letter-spacing:.1em;text-transform:uppercase;padding:10px 16px;border-radius:999px;margin-bottom:26px}
.h-k .ico{font-size:16px;color:var(--a2)}
.h-t{font-size:clamp(3rem,7.6vw,6.4rem);line-height:.98;font-weight:600;letter-spacing:-.035em;margin-bottom:28px}
.h-t.t-l{font-size:clamp(2.5rem,5.6vw,4.6rem)}
.h-t em{font-style:italic;font-weight:400;color:var(--accent-text);position:relative;white-space:nowrap}
.h-t em svg{position:absolute;left:-2%;bottom:-.12em;width:104%;height:.3em;color:${ctx.P.a3}}
.h-s{font-size:clamp(1.12rem,1.7vw,1.3rem);color:var(--muted);max-width:520px;margin-bottom:36px}
.h-mini{display:flex;flex-wrap:wrap;gap:10px 22px;margin-top:34px;font-weight:500;font-size:.95rem}
.h-mini span{display:inline-flex;align-items:center;gap:8px}
.h-mini .ico{color:var(--a2)}
.h-media{position:relative;justify-self:center;width:min(100%,480px)}
.arch{position:relative;aspect-ratio:4/5;border-radius:999px 999px 34px 34px;overflow:hidden;background:var(--bg2);box-shadow:0 40px 80px -40px rgba(80,40,10,.55)}
.arch>.m{position:absolute;inset:0}
.h-media::before{content:'';position:absolute;inset:-16px 16px 16px -16px;border:2px solid var(--a2);border-radius:999px 999px 40px 40px;z-index:-1}
.stamp{position:absolute;left:-46px;bottom:60px;width:132px;height:132px;border-radius:50%;background:var(--a3);color:var(--text);display:grid;place-items:center;box-shadow:0 20px 40px -18px rgba(80,40,10,.6)}
.stamp svg.ring{position:absolute;inset:0;width:100%;height:100%;animation:spin 22s linear infinite}
.stamp .ico{font-size:30px}
@keyframes spin{to{transform:rotate(360deg)}}
.h-note{position:absolute;right:-26px;top:54px;background:var(--surface);border-radius:20px;padding:14px 18px;box-shadow:0 20px 40px -20px rgba(80,40,10,.45);display:flex;gap:12px;align-items:center;font-size:.86rem;line-height:1.3;color:var(--muted)}
.h-note b{display:block;font-family:var(--fd);font-size:1.5rem;color:var(--text);line-height:1}
.h-note .st{color:${ctx.P.a3};font-size:1.3rem}
@media(max-width:880px){.h-g{grid-template-columns:minmax(0,1fr)}.h-media{width:min(86%,420px)}.stamp{left:-20px;width:110px;height:110px}.h-note{right:-14px}}
.wave{position:absolute;left:0;right:0;bottom:-1px;height:clamp(50px,7vw,100px);color:var(--bg2);pointer-events:none}
.wave svg{width:100%;height:100%}
.sh{text-align:center;margin-inline:auto}.sh .sh-p{margin-inline:auto}
.split .sh,.chi-body .sh{text-align:left;margin-inline:0}
.sh-k{background:var(--accent-soft);padding:9px 16px;border-radius:999px;letter-spacing:.12em}
.t-inv .sh-k{background:rgba(255,255,255,.1)}
.card{border:0;box-shadow:0 18px 44px -26px rgba(90,50,20,.45);border-radius:28px}
.card:hover{transform:translateY(-6px) rotate(-.4deg);box-shadow:0 30px 60px -30px rgba(90,50,20,.55)}
.c-i{border-radius:58% 42% 55% 45% / 50% 55% 45% 50%;width:64px;height:64px;font-size:26px}
.cards .card:nth-child(3n+2) .c-i{background:${mix(ctx.P.a2, ctx.P.bg, 0.8)};color:${ensure(ctx.P.a2, ctx.P.surface, 4.5)}}
.cards .card:nth-child(3n) .c-i{background:${mix(ctx.P.a3, ctx.P.bg, 0.7)};color:${ensure(mix(ctx.P.a3, '#000', 0.3), ctx.P.surface, 4.5)}}
.c-n{display:none}
.chi-media>.m{border-radius:${'48% 52% 46% 54% / 42% 44% 56% 58%'}}
.chi-media::after{content:'';position:absolute;width:38%;aspect-ratio:1;right:-6%;bottom:-4%;background:var(--a3);border-radius:50%;z-index:-1}
.chi-media::before{content:'';position:absolute;width:22%;aspect-ratio:1;left:-4%;top:6%;background:var(--a2);border-radius:50%;z-index:-1;opacity:.8}
.chi-media{z-index:0}
.sign{display:block}
.menu-wrap{background:var(--surface);border-radius:var(--r-lg);padding:clamp(28px,5vw,64px);box-shadow:0 30px 60px -40px rgba(90,50,20,.45);position:relative}
.menu-wrap::before{content:'';position:absolute;inset:12px;border:1.5px dashed var(--line);border-radius:26px;pointer-events:none}
.mg-h{font-style:italic;font-weight:600;color:var(--accent-text);border-bottom:1.5px dashed var(--line)}
.mi-dots{border-bottom:2px dotted ${rgba(ctx.P.text, 0.25)}}
.gal{--gg:16px}
.g-it{border-radius:24px}
.g-it:nth-child(3n+2){border-radius:120px 120px 24px 24px}
.stats>div{background:var(--surface);border-radius:28px;padding:30px 26px;text-align:center}
.t-inv .stats>div{background:rgba(255,255,255,.06)}
.st-n{color:var(--accent-text)}
.t-inv .st-n{color:${ctx.P.a3}}
.st-n small{color:inherit}
.q{border:0;box-shadow:0 18px 44px -26px rgba(90,50,20,.45);position:relative;overflow:hidden}
.q::before{content:'\\201C';position:absolute;right:22px;top:-8px;font:italic 600 8rem/1 var(--fd);color:var(--accent-soft)}
.q blockquote{font-family:var(--fd);font-size:1.22rem;line-height:1.5;position:relative}
.plan{border:0;box-shadow:0 18px 44px -26px rgba(90,50,20,.45)}
.plan.ft{transform:scale(1.03)}
.badge{background:var(--a3);color:var(--text)}
.cta-box{border-radius:48px;background:var(--accent)}
.cta-box h2 em{font-style:italic;font-weight:400}
.cta-art{opacity:.25;mix-blend-mode:multiply}
.faq-l{border-top:0;gap:14px}
.faq-l details{border:0;background:var(--surface);border-radius:22px;padding:0 26px;box-shadow:0 14px 34px -26px rgba(90,50,20,.45)}
.faq-l summary{font-weight:600}
.hours,.form,.map{border:0;box-shadow:0 24px 54px -32px rgba(90,50,20,.5)}
.hr b{font-family:var(--fd);font-size:1.1rem}
.ct-i{border-radius:50%}
.tm-m{border-radius:999px 999px 26px 26px}
.tm{text-align:center}
.work-m,.prod-m{border-radius:26px}
.prod-m{border-radius:200px 200px 26px 26px}
.tl::before{background:repeating-linear-gradient(var(--line) 0 8px,transparent 8px 14px)}
.tl-t{font-style:italic}
.foot{background:var(--inv);--text:var(--inv-text);--muted:var(--inv-muted);--line:var(--inv-line);--accent-text:${ctx.P.a3};color:var(--text);position:relative}
.foot .brand-name{font-size:1.8rem}
`,
    giocoso: (ctx) => `
:root{--r:24px;--r-lg:32px;--hw:700;--hls:-.015em;--fs:17px;--h2:clamp(2.5rem,5.6vw,4.4rem);--h3:1.45rem;--btn-r:999px;--btn-fw:800;--btn-bw:2.5px;--navh:80px;--fr:16px;--star:${ctx.P.a2};--em-style:normal}
h1,h2,h3{font-weight:700}
.nav{background:${rgba(ctx.P.bg, 0.92)};backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px)}
.nav.scrolled{box-shadow:0 3px 0 var(--text)}
.mono{display:grid;width:46px;height:46px;background:var(--a2);color:var(--text);border:2.5px solid var(--text);border-radius:42% 58% 50% 50% / 55% 45% 55% 45%;transform:rotate(-8deg);font-size:1.05rem}
.brand-name{font-size:1.5rem}
.menu a{font-weight:700;opacity:1}
.menu a:hover{color:var(--accent-text)}
.btn{border-color:var(--text);box-shadow:0 5px 0 var(--text)}
.btn:hover{transform:translateY(3px);box-shadow:0 2px 0 var(--text)}
.btn-p{color:#fff;background:var(--accent);border-color:var(--text)}
.btn-s{background:var(--surface);color:var(--text);border-color:var(--text)}
.btn-s:hover{background:var(--a2);color:var(--text);border-color:var(--text)}
.sh-t em,.h-t em,.cta-box h2 em{position:relative;z-index:0;white-space:nowrap}
.sh-t em::before,.h-t em::before{content:'';position:absolute;left:-.12em;right:-.12em;bottom:.04em;height:.42em;background:var(--a2);border-radius:999px;z-index:-1;transform:rotate(-1.5deg)}
.hero{position:relative;padding:clamp(48px,7vw,96px) 0 clamp(60px,7vw,100px);text-align:center;overflow:hidden}
.fl{position:absolute;pointer-events:none;animation:bob 6s ease-in-out infinite alternate}
.fl svg{width:100%;height:100%}
@keyframes bob{to{transform:translateY(-18px) rotate(8deg)}}
.fl.f1{width:clamp(70px,10vw,140px);left:4%;top:12%}
.fl.f2{width:clamp(50px,7vw,96px);right:6%;top:9%;animation-delay:-2s}
.fl.f3{width:clamp(60px,8vw,120px);left:8%;bottom:16%;animation-delay:-4s}
.fl.f4{width:clamp(56px,7vw,110px);right:5%;bottom:22%;animation-delay:-1s}
.h-c{position:relative;z-index:1}
.sticker{display:inline-block;background:var(--a2);color:var(--text);border:2.5px solid var(--text);border-radius:999px;padding:9px 20px;font:800 .9rem/1 var(--fu);transform:rotate(-3deg);box-shadow:0 4px 0 var(--text);margin-bottom:26px}
.h-t{font-size:clamp(3rem,9vw,7.2rem);line-height:.98;letter-spacing:-.025em;max-width:13ch;margin:0 auto 24px}
.h-t.t-l{font-size:clamp(2.5rem,6.4vw,5.2rem);max-width:18ch}
.h-s{font-size:clamp(1.12rem,1.8vw,1.35rem);color:var(--muted);max-width:600px;margin:0 auto 36px;font-weight:600}
.hero .btns{justify-content:center}
.h-pics{display:flex;justify-content:center;align-items:flex-end;gap:clamp(10px,2vw,24px);margin-top:clamp(48px,6vw,76px)}
.pic{position:relative;flex:0 1 300px;aspect-ratio:4/5;border:3px solid var(--text);border-radius:28px;overflow:hidden;box-shadow:8px 8px 0 var(--text);background:var(--surface)}
.pic>.m{position:absolute;inset:0}
.pic:nth-child(1){transform:rotate(-6deg) translateY(10px)}.pic:nth-child(2){flex-basis:360px;transform:rotate(2deg);z-index:1}.pic:nth-child(3){transform:rotate(7deg) translateY(16px)}
@media(max-width:640px){.pic:nth-child(1),.pic:nth-child(3){display:none}.pic:nth-child(2){flex-basis:86%}}
.mq{background:var(--text);color:var(--bg);transform:rotate(-1.5deg);margin:10px -20px 0;--mqg:30px}
.mq-t{padding-block:16px;font:700 clamp(1.2rem,2.4vw,1.8rem)/1 var(--fd)}
.mq-t i{font-style:normal;color:var(--a2)}
.sh{text-align:center;margin-inline:auto}.sh .sh-p{margin-inline:auto}
.split .sh,.chi-body .sh{text-align:left;margin-inline:0}
.sh-k{background:var(--surface);color:var(--text);border:2px solid var(--text);border-radius:999px;padding:7px 14px;letter-spacing:.06em;box-shadow:0 3px 0 var(--text)}
.sh-p{font-weight:600}
.card{border:2.5px solid var(--text);box-shadow:6px 6px 0 var(--text);border-radius:28px}
.card:hover{transform:translate(-3px,-3px) rotate(-1deg);box-shadow:9px 9px 0 var(--text)}
.c-i{border:2.5px solid var(--text);border-radius:18px;color:var(--text);background:var(--a2)}
.cards .card:nth-child(4n+2) .c-i{background:${ctx.pastels[0]}}
.cards .card:nth-child(4n+3) .c-i{background:${ctx.pastels[2]}}
.cards .card:nth-child(4n) .c-i{background:${ctx.pastels[3]}}
.c-n{display:none}
.c-price{background:var(--a2);color:var(--text);padding:5px 14px;border-radius:999px;border:2px solid var(--text)}
.chi-media>.m{border:3px solid var(--text);border-radius:40px;box-shadow:10px 10px 0 var(--text);transform:rotate(-2deg)}
.chi-media::after{content:'';position:absolute;width:90px;height:90px;right:-24px;top:-24px;background:var(--a3);border:3px solid var(--text);border-radius:50%;z-index:2}
.ticks .ico{background:var(--a4);color:var(--text);border-radius:50%;padding:3px;width:1.35em;height:1.35em;border:2px solid var(--text);stroke-width:3;margin-top:.1em}
.menu-wrap .mg{background:var(--surface);border:2.5px solid var(--text);border-radius:28px;padding:28px 32px;box-shadow:6px 6px 0 var(--text)}
.mg-h{border-bottom:2.5px dashed var(--text)}
.mi-p{background:var(--a2);color:var(--text);padding:3px 10px;border-radius:999px;border:2px solid var(--text);font-size:.9rem}
.gal{--gg:16px}
.g-it{border:3px solid var(--text);box-shadow:5px 5px 0 var(--text);border-radius:26px}
.g-cap{opacity:1;translate:none;background:none;padding:0;left:12px;bottom:12px;right:auto}
.g-cap span{display:inline-block;background:var(--surface);color:var(--text);border:2px solid var(--text);border-radius:999px;padding:6px 12px;font-weight:800;font-size:.8rem}
.stats>div{border:2.5px solid var(--text);border-radius:28px;padding:28px 22px;text-align:center;box-shadow:6px 6px 0 var(--text);background:${ctx.pastels[0]};color:${ctx.P.text}}
.stats>div:nth-child(2){background:${ctx.pastels[1]};transform:rotate(1.5deg)}.stats>div:nth-child(3){background:${ctx.pastels[2]};transform:rotate(-1deg)}.stats>div:nth-child(4){background:${ctx.pastels[3]}}
.st-n small{color:var(--text)}
.st-l{color:${ctx.P.text};font-weight:700}
.q{border:2.5px solid var(--text);box-shadow:6px 6px 0 var(--text);border-radius:28px 28px 28px 6px;position:relative}
.q:nth-child(2){transform:rotate(1deg);background:${ctx.pastels[1]}}
.q blockquote{font-weight:600}
.av{border:2px solid var(--text)}
.plan{border:2.5px solid var(--text);box-shadow:6px 6px 0 var(--text)}
.plan.ft{background:var(--a2);color:var(--text);border-color:var(--text);transform:rotate(-1.5deg)}
.plan.ft .btn-p{background:var(--accent);color:#fff;border-color:var(--text)}
.plan.ft li .ico{color:var(--text)}
.badge{background:var(--accent);color:#fff;border:2px solid var(--text)}
.cta-box{border:3px solid var(--text);box-shadow:10px 10px 0 var(--text);border-radius:40px;color:#fff}
.cta-box h2 em{color:var(--a2)}
.cta-box .btn-p{background:var(--a2);color:var(--text);border-color:var(--text)}
.cta-box .btn-s{background:var(--surface);color:var(--text)}
.cta-art{opacity:.35}
.faq-l{border-top:0;gap:14px}
.faq-l details{border:2.5px solid var(--text);border-radius:22px;padding:0 24px;background:var(--surface);box-shadow:4px 4px 0 var(--text)}
.faq-l summary{font-family:var(--fd)}
.faq-l summary .ico{color:var(--text)}
.hours,.form,.map{border:2.5px solid var(--text);box-shadow:8px 8px 0 var(--text)}
.fld input,.fld textarea{border:2px solid var(--text)}
.ct-i{border:2px solid var(--text);background:var(--a2);color:var(--text)}
.tm-m{border:3px solid var(--text);border-radius:50%;aspect-ratio:1;box-shadow:5px 5px 0 var(--text)}
.tm{text-align:center}
.work-m,.prod-m{border:3px solid var(--text);box-shadow:6px 6px 0 var(--text);border-radius:26px}
.prod-p{background:var(--a2);color:var(--text);border:2px solid var(--text);padding:2px 10px;border-radius:999px}
.tl::before{background:var(--text);width:3px}
.tl-i::before{width:20px;height:20px;border:3px solid var(--text);transform:translateX(-10px);background:var(--a2)}
.tl-i:nth-child(3n+2)::before{background:var(--accent)}.tl-i:nth-child(3n)::before{background:var(--a4)}
.tl-t{color:var(--text);font-family:var(--fd)}
.foot{background:var(--inv);--text:var(--inv-text);--muted:var(--inv-muted);--line:var(--inv-line);--accent-text:var(--a2);color:var(--text)}
.wa-f{border:2.5px solid var(--text);box-shadow:0 5px 0 var(--text)}
`,
  };

  /* ═════════════════════════════ COSTRUZIONE ═════════════════════════════ */

  const SEC_LABEL = { chi: 'Chi siamo', servizi: 'Servizi', menu: 'Menù', prodotti: 'Prodotti', progetti: 'Progetti', programma: 'Programma', galleria: 'Galleria', prezzi: 'Prezzi', testimonianze: 'Recensioni', team: 'Team', faq: 'FAQ', orari: 'Orari', dove: 'Dove siamo', contatti: 'Contatti' };

  // [kicker, titolo, intro] — versione "noi" e versione "io"
  const SEC_COPY = {
    chi: [['Chi siamo', '', ''], ['Chi sono', '', '']],
    servizi: [['Servizi', 'Cosa possiamo fare per te', 'Ogni servizio è pensato per darti il massimo, con cura e attenzione ai dettagli.'], ['Servizi', 'Come posso aiutarti', 'Un approccio su misura, dalla prima idea al risultato finale.']],
    menu: [['Menù', 'I nostri piatti', 'Ingredienti di stagione, ricette di famiglia e un pizzico di fantasia.'], ['Menù', 'Il menù', 'Ingredienti di stagione e tanta passione.']],
    prodotti: [['Prodotti', 'In vetrina', 'Una selezione di pezzi scelti con cura. Scrivici per disponibilità, taglie e colori.'], ['Prodotti', 'In vetrina', 'Pezzi scelti con cura. Scrivimi per disponibilità.']],
    progetti: [['Progetti', 'Lavori selezionati', 'Alcuni dei progetti di cui andiamo più fieri.'], ['Progetti', 'Lavori selezionati', 'Alcuni dei progetti di cui vado più fiero.']],
    programma: [['Programma', 'Il programma', 'Tutti i momenti della giornata, ora per ora.'], ['Programma', 'Il programma', 'Tutti i momenti, ora per ora.']],
    galleria: [['Galleria', 'Uno sguardo da vicino', 'Qualche immagine per farti un\'idea, prima di vederci di persona.'], ['Galleria', 'Uno sguardo da vicino', 'Qualche immagine per farti un\'idea.']],
    prezzi: [['Prezzi', 'Scegli la soluzione per te', 'Prezzi chiari, nessun costo nascosto. Hai bisogno di qualcosa su misura? Chiedici pure.'], ['Prezzi', 'Tariffe chiare', 'Nessun costo nascosto. Hai bisogno di qualcosa su misura? Chiedimi pure.']],
    testimonianze: [['Recensioni', 'Cosa dicono di noi', 'Le parole di chi ci ha già scelto valgono più di mille promesse.'], ['Recensioni', 'Cosa dicono di me', 'Le parole di chi ha già lavorato con me.']],
    team: [['Team', 'Le persone dietro {name}', 'Professionisti appassionati, pronti ad accoglierti.'], ['Team', 'Con chi lavoro', 'Le persone che rendono possibile ogni progetto.']],
    faq: [['FAQ', 'Domande frequenti', 'Non trovi la risposta che cerchi? Scrivici, ti rispondiamo in giornata.'], ['FAQ', 'Domande frequenti', 'Non trovi la risposta? Scrivimi pure.']],
    orari: [['Orari', 'Quando trovarci', 'Passa a trovarci: ti aspettiamo con il sorriso.'], ['Orari', 'Quando trovarmi', 'Ecco quando puoi trovarmi.']],
    dove: [['Dove siamo', 'Vieni a trovarci', ''], ['Dove sono', 'Vieni a trovarmi', '']],
    contatti: [['Contatti', 'Parliamone', 'Scrivici per informazioni, prenotazioni o preventivi: ti rispondiamo entro 24 ore.'], ['Contatti', 'Parliamone', 'Scrivimi per informazioni o preventivi: ti rispondo entro 24 ore.']],
  };

  function themeById(id) {
    const list = window.OFFLINE_THEMES || [];
    return list.find((t) => t.id === id) || list[0];
  }
  function catById(id) {
    const list = window.OFFLINE_CATEGORIES || [];
    return list.find((c) => c.id === id) || list.find((c) => c.id === 'altro') || list[0];
  }

  function normalizeBrief(input) {
    let b = input;
    if (typeof b === 'string') b = { idea: b };
    b = Object.assign({}, b || {});
    const legacyStyle = arguments[1];
    const idea = String(b.idea || '');
    const det = idea ? detectBrief(idea + (legacyStyle ? ' ' + legacyStyle : '')) : {};
    const out = {
      idea,
      name: clean(b.name) || det.name || '',
      tagline: clean(b.tagline) || det.tagline || '',
      description: String(b.description || '').trim(),
      category: (window.OFFLINE_CATEGORIES || []).some((c) => c.id === b.category) ? b.category : (det.category || 'altro'),
      theme: (window.OFFLINE_THEMES || []).some((t) => t.id === b.theme) ? b.theme : '',
      accentColor: isHex(b.accentColor) ? b.accentColor.trim() : (det.accentColor || ''),
      sections: Array.isArray(b.sections) ? b.sections.slice() : [],
      items: String(b.items || ''),
      contacts: Object.assign({}, det.contacts || {}, b.contacts || {}),
      logo: safeSrc(b.logo) || null,
      photos: (Array.isArray(b.photos) ? b.photos : []).map((p) => (typeof p === 'string' ? { src: p, caption: '' } : p || {})).map((p) => ({ src: safeSrc(p.src), caption: clean(p.caption) })).filter((p) => p.src),
      city: clean(b.city) || det.city || '',
    };
    if (!out.contacts.hours && b.hours) out.contacts.hours = b.hours;
    const cat = catById(out.category);
    if (!out.theme) out.theme = (det.category === out.category && det.theme) ? det.theme : cat.defaultTheme;
    if (!out.sections.length) out.sections = det.category === out.category && det.sections ? det.sections : cat.defaultSections.slice();
    const valid = new Set((window.OFFLINE_SECTIONS || []).map((s) => s.id));
    const seen = new Set();
    out.sections = out.sections.filter((s) => valid.has(s) && !seen.has(s) && seen.add(s));
    if (!out.sections.length) out.sections = ['chi', 'servizi', 'contatti'];
    // città dall'indirizzo, se non c'è
    if (!out.city && out.contacts.address) { const c = guessCity(out.contacts.address); if (c) out.city = c; }
    return out;
  }

  function buildCtx(b) {
    const cat = catById(b.category);
    const c = Object.assign({}, catById('altro').content || {}, cat.content || {});
    const t = themeById(b.theme);
    const th = t.id;
    const tc = t.colors;
    const R = rng(hash(b.idea + b.name + b.category));
    const name = b.name || pick(c.sampleNames || ['Il tuo progetto'], R);
    const city = b.city;
    const ctx = { b, cat, c, t, th, name, city, R };
    ctx.first = !!c.firstPerson;
    ctx.tagline = b.tagline || tpl(pick(c.taglines || [''], R), ctx);
    // palette
    const P = Object.assign({}, tc);
    P.a2 = tc.accent2 || mix(tc.accent, tc.text, 0.4);
    P.a3 = tc.accent3 || mix(tc.accent, tc.bg, 0.4);
    P.a4 = tc.accent4 || P.a2;
    if (b.accentColor) {
      P.accent = b.accentColor;
      if (th === 'aurora' || th === 'giocoso' || th === 'calore') { /* mantiene gli accenti secondari del tema */ }
    }
    if (contrast(P.accent, P.bg) < 1.5) P.accent = mix(P.accent, lum(P.bg) < 0.3 ? '#ffffff' : '#000000', 0.45);
    P.accentText = ensure(P.accent, P.bg, 4.5);
    P.accentInk = onColor(P.accent);
    P.accentLight = ensure(mix(P.accent, '#ffffff', 0.18), '#16130f', 6);
    P.accentOnInv = ensure(P.accent, tc.inv, 4.5);
    ctx.P = P;
    ctx.pastels = [mix(P.accent, '#ffffff', 0.8), mix(P.a2, '#ffffff', 0.62), mix(P.a3, '#ffffff', 0.8), mix(P.a4, '#ffffff', 0.78)];
    const ornSvg = (col) => cssUrl('data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 16"><g fill="none" stroke="${col}" stroke-width="1"><path d="M0 8h58M92 8h58"/><path d="M75 1l7 7-7 7-7-7z"/><circle cx="64" cy="8" r="1.6" fill="${col}"/><circle cx="86" cy="8" r="1.6" fill="${col}"/></g></svg>`));
    ctx.orn = ornSvg(P.accentText);
    ctx.ornLight = ornSvg(P.accentLight);
    // contatti
    ctx.k = contactsOf(b.contacts, name);
    ctx.hoursList = parseHours(ctx.k.hours || '');
    ctx.hoursUser = ctx.hoursList.length > 0;
    if (!ctx.hoursUser && c.hours) ctx.hoursList = parseHours(c.hours);
    // foto
    ctx.photos = b.photos.map((p, i) => ({ v: `--ph${i + 1}`, n: i + 1, cap: p.caption, src: p.src }));
    ctx.logo = b.logo;
    // contenuti
    ctx.desc = b.description;
    ctx.sections = b.sections;
    ctx.has = (id) => ctx.sections.includes(id);
    const target = (b.items.trim() && (ctx.has(cat.itemsSection) ? cat.itemsSection : ['menu', 'prodotti', 'servizi', 'progetti', 'programma'].find(ctx.has))) || null;
    ctx.itemsFor = (sec) => {
      const mode = sec === 'programma' ? 'timeline' : '';
      if (sec === target) return { groups: parseItems(b.items, mode), user: true };
      if (sec === cat.itemsSection) return { groups: parseItems(tpl(c.items, ctx), mode), user: false };
      const donor = { menu: 'ristorante', prodotti: 'negozio', progetti: 'portfolio', programma: 'evento', servizi: 'altro' }[sec];
      if (sec === 'servizi' && c.services && c.services.length) return { services: c.services, user: false };
      return { groups: parseItems(tpl(catById(donor).content.items, ctx), mode), user: false };
    };
    // azioni principali
    const k = ctx.k;
    const contactHref = k.waHref || k.tel || (ctx.has('contatti') ? '#contatti' : k.mailto || '#top');
    const browse = { negozio: 'prodotti', portfolio: 'progetti', prodotto: 'prezzi' }[cat.id];
    ctx.primary = { label: c.heroCta || 'Contattaci', href: browse && ctx.has(browse) ? '#' + browse : contactHref, ext: !!(contactHref.startsWith('http')) && !(browse && ctx.has(browse)) };
    const secId = [cat.itemsSection, 'menu', 'servizi', 'prodotti', 'progetti', 'programma', 'chi', 'galleria'].find((s) => ctx.has(s) && '#' + s !== ctx.primary.href);
    ctx.secondary = secId ? { label: c.heroCta2 && secId === cat.itemsSection ? c.heroCta2 : 'Scopri di più', href: '#' + secId } : null;
    ctx.contactAction = { href: contactHref, ext: contactHref.startsWith('http'), label: k.wa ? 'Scrivici su WhatsApp' : k.tel ? 'Chiamaci' : 'Contattaci' };
    if (ctx.first) ctx.contactAction.label = k.wa ? 'Scrivimi su WhatsApp' : k.tel ? 'Chiamami' : 'Contattami';
    return ctx;
  }

  const ext = (href) => (/^https?:/.test(href) ? ' target="_blank" rel="noopener"' : '');

  // immagine: foto caricata (via variabile CSS, senza duplicare i dati) oppure arte generata
  function media(ctx, photo, seed, v, label, alt) {
    if (photo) return `<div class="m img" role="img" aria-label="${esc(alt || photo.cap || ctx.name)}" style="background-image:var(${photo.v})"></div>`;
    return `<div class="m">${art(ctx, seed, v, label)}</div>`;
  }

  function sectionHead(ctx, id, idx, opts) {
    opts = opts || {};
    const copy = (SEC_COPY[id] || [['', '', '']])[ctx.first ? 1 : 0];
    const over = (ctx.c.titles || {})[id] || [];
    const k = over[0] || copy[0];
    let title = opts.title || over[1] || copy[1];
    const intro = opts.intro != null ? opts.intro : copy[2];
    title = tpl(title, ctx);
    const n = String(idx + 1).padStart(2, '0');
    return `<div class="sh rv${opts.center ? ' c' : ''}"><span class="sh-n">${n}</span><span class="sh-k" data-n="(${n})">${esc(k)}</span><h2 class="sh-t">${fancy(title)}</h2>${intro ? `<p class="sh-p">${esc(tpl(intro, ctx))}</p>` : ''}</div>`;
  }

  /* ── NAV ── */
  function brandHTML(ctx, cls) {
    const inner = ctx.logo
      ? `<img class="brand-logo" src="${esc(ctx.logo)}" alt="${esc(ctx.name)}">`
      : `<span class="mono" aria-hidden="true">${esc(initials(ctx.name))}</span><span class="brand-name">${esc(ctx.name)}</span>`;
    return `<a class="brand${cls ? ' ' + cls : ''}" href="#top" aria-label="${esc(ctx.name)} — torna su">${inner}</a>`;
  }
  function navLinks(ctx) {
    const ids = ctx.sections.filter((s) => SEC_LABEL[s] && s !== 'contatti');
    const lab = (s) => {
      const over = (ctx.c.titles || {})[s];
      const l = over && over[0] ? over[0] : SEC_LABEL[s];
      return s === 'chi' && ctx.first ? 'Chi sono' : s === 'dove' && ctx.first ? 'Dove sono' : l;
    };
    return ids.slice(0, 5).map((s, i) => `<a href="#${s}">${ctx.th === 'minimal' ? `<b>0${i + 1}</b>` : ''}${esc(lab(s))}</a>`).join('');
  }
  function navHTML(ctx) {
    const ctaHref = ctx.has('contatti') ? '#contatti' : ctx.contactAction.href;
    const ctaLabel = ctx.has('contatti') ? (ctx.first ? 'Contattami' : 'Contattaci') : ctx.contactAction.label;
    const btnCls = { elegante: 'btn btn-s', audace: 'btn btn-s', magazine: 'btn btn-p', aurora: 'btn btn-p', minimal: 'btn btn-p', calore: 'btn btn-p', giocoso: 'btn btn-p' }[ctx.th];
    const menu = `<div class="menu" id="menu">${navLinks(ctx)}<a class="${btnCls}" href="${esc(ctaHref)}"${ext(ctaHref)}>${esc(ctaLabel)}</a></div>`;
    const burger = `<button class="burger" type="button" aria-label="Apri il menu" aria-expanded="false" aria-controls="menu"><span></span></button>`;
    if (ctx.th === 'magazine') {
      const d = new Date();
      const date = d.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
      const len = ctx.name.length;
      const mfs = `clamp(2.4rem, ${Math.max(4, Math.min(11, 120 / Math.max(len, 6)))}vw, ${len > 18 ? 4.6 : 7}rem)`;
      return `<div class="mast" style="--mfs:${mfs}"><div class="wrap mast-top"><span>${esc(date)}</span><span>${esc(ctx.c.eyebrow || ctx.cat.label)}</span><span>${esc(ctx.city || 'Edizione speciale')}</span></div><div class="wrap mast-b">${brandHTML(ctx)}</div></div>
<nav class="nav" aria-label="Principale"><div class="wrap nav-in">${brandHTML(ctx, 'brand-sm')}${menu}${burger}</div></nav>`;
    }
    return `<nav class="nav" aria-label="Principale"><div class="wrap nav-in">${brandHTML(ctx)}${menu}${burger}</div></nav>`;
  }

  /* ── HERO ── */
  function heroBtns(ctx, cls) {
    const p = ctx.primary, s = ctx.secondary;
    const arrow = ctx.th === 'minimal' || ctx.th === 'audace' || ctx.th === 'aurora' ? icon('arrow') : '';
    return `<div class="btns ${cls || ''}"><a class="btn btn-p" href="${esc(p.href)}"${ext(p.href)}>${esc(p.label)}${arrow}</a>${s ? `<a class="btn btn-s" href="${esc(s.href)}">${esc(s.label)}</a>` : ''}</div>`;
  }
  function eyebrow(ctx) {
    const e = ctx.c.eyebrow || ctx.cat.label;
    return ctx.city && !e.includes(ctx.city) ? `${e} · ${ctx.city}` : e;
  }
  function stat0(ctx) { const s = (ctx.c.stats || [])[3] || (ctx.c.stats || [])[0]; return s; }

  const HERO = {
    elegante(ctx) {
      const ph = ctx.photos[0];
      const t = ctx.name.length > 20 ? ' t-l' : '';
      return `<header class="hero" id="top">
<div class="h-bg">${ph ? `<div class="img" role="img" aria-label="${esc(ph.cap || ctx.name)}" style="background-image:var(${ph.v})"></div>` : art(ctx, 'hero', 'hero')}</div><div class="h-veil"></div>
<div class="wrap h-c"><p class="h-k rv">${esc(eyebrow(ctx))}</p><h1 class="h-t rv${t}" style="--d:1">${fancy(ctx.name)}</h1><div class="orn rv" style="--d:2" aria-hidden="true"></div><p class="h-s rv" style="--d:2">${esc(ctx.tagline)}</p>${heroBtns(ctx, 'rv" style="--d:3')}</div>
<a class="h-scroll" href="#${esc(ctx.sections[0])}">Scopri</a></header>`;
    },
    audace(ctx) {
      const ph = ctx.photos[0];
      const len = ctx.name.length;
      const vw = Math.max(5, Math.min(12.5, 118 / Math.max(len, 5)));
      const st = stat0(ctx);
      const stamp = ctx.city ? ctx.city : (ctx.c.noun || '').toUpperCase();
      return `<header class="hero" id="top"><div class="wrap h-g">
<div class="h-txt"><span class="h-tag rv"><i></i>${esc(eyebrow(ctx))}</span><h1 class="h-t rv" style="--d:1;--tsize:clamp(2.8rem,${vw.toFixed(1)}vw,${len > 16 ? 7 : 10}rem)">${fancy(ctx.name)}</h1><p class="h-s rv" style="--d:2">${esc(ctx.tagline)}</p>${heroBtns(ctx, 'rv" style="--d:3')}</div>
<div class="h-media rv" style="--d:2"><div class="h-frame">${media(ctx, ph, 'hero', 'hero', ctx.name)}</div>${stamp ? `<div class="h-stamp">${esc(stamp)}</div>` : ''}${st ? `<div class="h-num"><span><b>${esc(fmtNum(st.n))}${esc(st.s)}</b>${esc(st.l.split(' ').slice(0, 2).join(' '))}</span></div>` : ''}</div>
</div></header>${marquee(ctx)}`;
    },
    magazine(ctx) {
      const ph = ctx.photos[0];
      const deck = ctx.desc ? ctx.desc.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') : tpl((ctx.c.about.text || [''])[0], ctx);
      const idx = ctx.sections.filter((s) => SEC_LABEL[s] && s !== 'contatti').slice(0, 4);
      return `<header class="hero" id="top"><div class="wrap">
<div class="h-g"><div class="h-txt"><span class="h-k rv">${esc(eyebrow(ctx))}</span><h1 class="h-t rv" style="--d:1">${fancy(ctx.tagline)}</h1><p class="h-d rv" style="--d:2">${esc(deck)}</p><p class="h-by rv" style="--d:2">Di <b>${esc(ctx.name)}</b>${ctx.city ? ' — ' + esc(ctx.city) : ''}</p>${heroBtns(ctx, 'rv" style="--d:3')}</div>
<figure class="h-fig rv" style="--d:1"><div class="h-img">${media(ctx, ph, 'hero', 'hero', ctx.name)}</div><figcaption><b>In copertina</b>${esc(ph && ph.cap ? ph.cap : ctx.name)}</figcaption></figure></div>
${idx.length > 1 ? `<nav class="h-idx rv" style="--n:${idx.length}" aria-label="In questa pagina">${idx.map((s, i) => `<a href="#${s}"><small>Pag. ${i + 2}</small>${esc(((ctx.c.titles || {})[s] || [])[0] || SEC_LABEL[s])}</a>`).join('')}</nav>` : ''}
</div></header>`;
    },
    aurora(ctx) {
      const ph = ctx.photos[0];
      const st = (ctx.c.stats || []);
      const useMock = !ph && ['prodotto', 'personale', 'altro'].includes(ctx.cat.id);
      const t = ctx.name.length > 18 ? ' t-l' : '';
      const trust = st.length ? `<div class="h-trust rv" style="--d:4"><span><span class="st">★★★★★</span> <b>${esc(fmtNum((st.find((x) => x.s === '★') || {}).n || 4.9))}</b> di media</span>${st[0] ? `<span><b>${esc(fmtNum(st[0].n) + st[0].s)}</b> ${esc(st[0].l)}</span>` : ''}</div>` : '';
      return `<header class="hero" id="top"><div class="h-mesh" aria-hidden="true"><i></i><i></i><i></i></div><div class="h-grid" aria-hidden="true"></div>
<div class="wrap h-c"><a class="pill rv" href="${esc(ctx.secondary ? ctx.secondary.href : '#contatti')}"><b>${ctx.cat.id === 'prodotto' ? 'Novità' : esc(ctx.c.noun || 'Ciao')}</b><span>${esc(eyebrow(ctx))}</span>${icon('arrow')}</a>
<h1 class="h-t rv${t}" style="--d:1">${fancy(ctx.name)}</h1><p class="h-s rv" style="--d:2">${esc(ctx.tagline)}</p>${heroBtns(ctx, 'rv" style="--d:3')}${trust}
<div class="h-shot rv" style="--d:3"><div class="h-win">${ph ? media(ctx, ph, 'hero', 'wide') : useMock ? `<div class="m">${mockupArt(ctx)}</div>` : `<div class="m">${art(ctx, 'hero', 'wide')}</div>`}</div></div></div></header>`;
    },
    minimal(ctx) {
      const ph = ctx.photos[0];
      const len = ctx.name.length + 1;
      const vw = Math.max(5.5, Math.min(15, 150 / Math.max(len, 5)));
      const desc = ctx.desc ? ctx.desc.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ') : tpl((ctx.c.about.text || [''])[0], ctx);
      return `<header class="hero" id="top"><div class="wrap">
<div class="h-meta rv"><span>(${esc(ctx.cat.label.split(' / ')[0])})</span><span>${esc(ctx.city || 'Italia')} — ${new Date().getFullYear()}</span><span>Scorri ↓</span></div>
<h1 class="h-t rv" style="--d:1;--tsize:clamp(3rem,${vw.toFixed(1)}vw,${len > 14 ? 8 : 12}rem)">${esc(ctx.name)}<span class="dot">.</span></h1>
<div class="h-row rv" style="--d:2"><p class="h-s">${esc(ctx.tagline)}</p><div><p class="h-d">${esc(desc)}</p>${heroBtns(ctx)}</div></div>
<figure class="h-img rv" style="--d:3;margin:0">${media(ctx, ph, 'hero', 'wide', ctx.c.noun)}${ph && ph.cap ? `<figcaption>${esc(ph.cap)}</figcaption>` : ''}</figure>
</div></header>`;
    },
    calore(ctx) {
      const ph = ctx.photos[0];
      const t = ctx.name.length > 20 ? ' t-l' : '';
      const ring = `${esc((ctx.city ? ctx.city + ' · ' : '') + (ctx.c.noun ? 'fatto con amore · ' : '') + ctx.name + ' · ').toUpperCase()}`;
      const rid = uid('r');
      const st = (ctx.c.stats || []).find((x) => x.s === '★');
      const words = ctx.name.trim().split(/\s+/);
      const last = words.pop();
      const title = (words.length ? esc(words.join(' ')) + ' ' : '') + `<em>${esc(last)}<svg viewBox="0 0 200 20" preserveAspectRatio="none" aria-hidden="true"><path d="M3 14 C 50 4, 110 4, 197 10" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg></em>`;
      return `<header class="hero" id="top">
<svg class="h-blob b1" viewBox="0 0 400 400" aria-hidden="true"><path d="${blobPath(200, 200, 180, rng(hash(ctx.name)), 7, 0.3)}" fill="currentColor"/></svg>
<svg class="h-blob b2" viewBox="0 0 400 400" aria-hidden="true"><path d="${blobPath(200, 200, 180, rng(hash(ctx.name + 'b')), 6, 0.4)}" fill="currentColor"/></svg>
<div class="wrap h-g"><div class="h-txt"><span class="h-k rv">${icon('leaf')}${esc(eyebrow(ctx))}</span><h1 class="h-t rv${t}" style="--d:1">${title}</h1><p class="h-s rv" style="--d:2">${esc(ctx.tagline)}</p>${heroBtns(ctx, 'rv" style="--d:3')}
<div class="h-mini rv" style="--d:4">${(ctx.c.about.highlights || []).slice(0, 2).map((h) => `<span>${icon('check')}${esc(h)}</span>`).join('')}</div></div>
<div class="h-media rv" style="--d:2"><div class="arch">${media(ctx, ph, 'hero', 'hero', ctx.name)}</div>
<div class="stamp" aria-hidden="true"><svg class="ring" viewBox="0 0 120 120"><defs><path id="${rid}" d="M60 60 m-46 0 a46 46 0 1 1 92 0 a46 46 0 1 1 -92 0"/></defs><text font-family="${esc(ctx.t.fonts.ui)}" font-size="9.6" font-weight="700" letter-spacing="2.4" fill="currentColor"><textPath href="#${rid}" textLength="286">${ring}</textPath></text></svg>${icon(ctx.c.icon || 'heart')}</div>
${st ? `<div class="h-note"><span class="st">★</span><span><b>${esc(fmtNum(st.n))}</b>${esc(st.l)}</span></div>` : ''}</div></div>
<div class="wave" aria-hidden="true"><svg viewBox="0 0 1440 100" preserveAspectRatio="none"><path d="M0 60 C 240 10 480 100 720 60 S 1200 10 1440 50 V100 H0Z" fill="currentColor"/></svg></div></header>`;
    },
    giocoso(ctx) {
      const P = ctx.P, R = rng(hash(ctx.name + 'fl'));
      const shapes = [
        `<svg viewBox="0 0 100 100"><path d="${blobPath(50, 50, 44, R, 6, 0.4)}" fill="${P.a3}" stroke="${P.text}" stroke-width="4"/></svg>`,
        `<svg viewBox="0 0 100 100"><path d="M50 4 61 38 96 38 68 59 79 94 50 72 21 94 32 59 4 38 39 38Z" fill="${P.a2}" stroke="${P.text}" stroke-width="4" stroke-linejoin="round"/></svg>`,
        `<svg viewBox="0 0 120 60"><path d="M6 40 q18 -34 36 0 t36 0 t36 0" fill="none" stroke="${P.accent}" stroke-width="10" stroke-linecap="round"/></svg>`,
        `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="${P.a4}" stroke="${P.text}" stroke-width="4"/><circle cx="50" cy="50" r="16" fill="${P.bg}" stroke="${P.text}" stroke-width="4"/></svg>`,
      ];
      const ph = ctx.photos;
      const pics = [1, 0, 2].map((i, j) => `<div class="pic">${media(ctx, ph[i] || (j === 1 ? ph[0] : null), 'hero' + j, 'hero', ctx.name)}</div>`).join('');
      const t = ctx.name.length > 18 ? ' t-l' : '';
      return `<header class="hero" id="top">${shapes.map((s, i) => `<div class="fl f${i + 1}" aria-hidden="true">${s}</div>`).join('')}
<div class="wrap h-c"><span class="sticker rv">${esc(eyebrow(ctx))}</span><h1 class="h-t rv${t}" style="--d:1">${fancy(ctx.name)}</h1><p class="h-s rv" style="--d:2">${esc(ctx.tagline)}</p>${heroBtns(ctx, 'rv" style="--d:3')}
<div class="h-pics rv" style="--d:3">${pics}</div></div></header>${marquee(ctx)}`;
    },
  };

  function marquee(ctx) {
    const words = [];
    const it = ctx.itemsFor(ctx.cat.itemsSection);
    (it.groups || []).forEach((g) => g.items.forEach((x) => words.push(x.name)));
    (it.services || []).forEach((x) => words.push(x.title));
    (ctx.c.about.highlights || []).forEach((h) => words.push(h));
    const list = words.slice(0, 8).map((w) => (w.length > 34 ? w.slice(0, 32) + '…' : w));
    if (!list.length) return '';
    const sep = ctx.th === 'audace' ? '<i>✺</i>' : '<i>★</i>';
    const run = `<span>${list.map((w) => esc(w) + ' ' + sep).join(' ')}</span>`;
    return `<div class="mq" aria-hidden="true"><div class="mq-t">${run}${run}</div></div>`;
  }

  const fmtNum = (n) => (typeof n === 'number' ? n.toLocaleString('it-IT', { maximumFractionDigits: 1 }) : String(n));

  /* ── SEZIONI ── */
  const SECTIONS = {
    chi(ctx, i) {
      const ph = ctx.photos[1] || null;
      const a = ctx.c.about || {};
      const paras = ctx.desc ? ctx.desc.split(/\n\s*\n|\n/).map(clean).filter(Boolean) : (a.text || []).map((p) => tpl(p, ctx));
      const hl = a.highlights || [];
      const title = (((ctx.c.titles || {}).chi || [])[1]) || a.title;
      return `<div class="wrap chi-grid"><figure class="chi-media rv">${media(ctx, ph, 'about', 'about', ctx.c.noun)}</figure>
<div class="chi-body">${sectionHead(ctx, 'chi', i, { title })}<div class="prose rv" style="--d:1">${paras.map((p) => `<p>${esc(p)}</p>`).join('')}</div>
${hl.length ? `<ul class="ticks rv" style="--d:2">${hl.map((h) => `<li>${icon('check')}<span>${esc(h)}</span></li>`).join('')}</ul>` : ''}
<p class="sign rv" style="--d:3">— ${ctx.first ? esc(ctx.name) : 'Il team di ' + esc(ctx.name)}</p></div></div>`;
    },
    servizi(ctx, i) {
      const d = ctx.itemsFor('servizi');
      let list;
      if (d.services) list = d.services.map((s, j) => ({ title: s.title, text: s.text, icon: s.icon, price: '' }));
      else list = [].concat(...d.groups.map((g) => g.items)).map((x, j) => ({ title: x.name, text: x.desc, price: x.price, icon: iconFor(x.name + ' ' + x.desc, j, ctx.c.icon) }));
      list = list.slice(0, 12);
      const n = list.length;
      const k = n === 1 ? 'k1' : n === 2 || n === 4 ? 'k2' : 'k3';
      const wideIdx = new Set();
      if (k === 'k3') { if (n % 3 === 1) { wideIdx.add(0); wideIdx.add(n - 1); } else if (n % 3 === 2) wideIdx.add(0); }
      return `<div class="wrap">${sectionHead(ctx, 'servizi', i, { center: true })}<div class="cards ${k}">${list.map((s, j) => `<article class="card rv${wideIdx.has(j) ? ' wide' : ''}" style="--d:${j % 3}"><span class="c-n">${ctx.th === 'elegante' ? ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][j] : String(j + 1).padStart(2, '0')}</span><span class="c-i">${icon(s.icon)}</span><h3>${esc(s.title)}</h3>${s.text ? `<p>${esc(s.text)}</p>` : ''}${s.price ? `<span class="c-price">${esc(s.price)}</span>` : ''}</article>`).join('')}</div></div>`;
    },
    menu(ctx, i) {
      const d = ctx.itemsFor('menu');
      let groups = d.groups || [];
      if (groups.length === 1 && !groups[0].title && groups[0].items.length > 3) {
        const it = groups[0].items, h = Math.ceil(it.length / 2);
        groups = [{ title: '', items: it.slice(0, h) }, { title: '', items: it.slice(h) }];
      }
      return `<div class="wrap">${sectionHead(ctx, 'menu', i, { center: true })}<div class="menu-wrap">${groups.map((g, j) => `<div class="mg rv" style="--d:${j % 2}">${g.title ? `<h3 class="mg-h">${esc(g.title)}</h3>` : ''}<ul>${g.items.map((x) => `<li class="mi"><div class="mi-top"><span class="mi-n">${esc(x.name)}</span>${x.price ? `<span class="mi-dots"></span><span class="mi-p">${esc(x.price)}</span>` : ''}</div>${x.desc ? `<p class="mi-d">${esc(x.desc)}</p>` : ''}</li>`).join('')}</ul></div>`).join('')}</div></div>`;
    },
    prodotti(ctx, i) {
      const d = ctx.itemsFor('prodotti');
      const list = [].concat(...(d.groups || []).map((g) => g.items)).slice(0, 12);
      const ph = ctx.photos;
      const pOf = (j) => (ph.length ? ph[(j + (ph.length > 1 ? 1 : 0)) % ph.length] : null);
      const k = ctx.k;
      return `<div class="wrap">${sectionHead(ctx, 'prodotti', i)}<div class="prods">${list.map((x, j) => {
        const href = k.wa ? 'https://wa.me/' + k.wa + '?text=' + encodeURIComponent('Ciao! Vorrei informazioni su: ' + x.name) : '#contatti';
        return `<article class="prod rv" style="--d:${j % 3}"><div class="prod-m">${media(ctx, pOf(j), 'prod' + j, 'tile', x.name, x.name)}</div><div class="prod-top"><h3>${esc(x.name)}</h3>${x.price ? `<span class="prod-p">${esc(x.price)}</span>` : ''}</div>${x.desc ? `<p>${esc(x.desc)}</p>` : '<p></p>'}<a class="lnk" href="${esc(href)}"${ext(href)}>${k.wa ? 'Chiedi su WhatsApp' : 'Richiedi informazioni'} ${icon('arrow')}</a></article>`;
      }).join('')}</div></div>`;
    },
    progetti(ctx, i) {
      const d = ctx.itemsFor('progetti');
      const list = [].concat(...(d.groups || []).map((g) => g.items)).slice(0, 10);
      const ph = ctx.photos;
      const pOf = (j) => (ph.length ? ph[(j + (ph.length > 1 ? 1 : 0)) % ph.length] : null);
      const tags = ['Progetto', 'Caso studio', 'Lavoro recente', 'Collaborazione'];
      return `<div class="wrap">${sectionHead(ctx, 'progetti', i)}<div class="works">${list.map((x, j) => `<article class="work rv" style="--d:${j % 2}"><div class="work-m">${media(ctx, pOf(j), 'work' + j, 'tile', x.name, x.name)}</div><div class="work-meta"><span>${String(j + 1).padStart(2, '0')} — ${esc(tags[j % tags.length])}</span><span>${esc(x.tag || x.price || '')}</span></div><h3>${esc(x.name)}</h3>${x.desc ? `<p>${esc(x.desc)}</p>` : ''}</article>`).join('')}</div></div>`;
    },
    programma(ctx, i) {
      const d = ctx.itemsFor('programma');
      const list = [].concat(...(d.groups || []).map((g) => g.items)).slice(0, 14);
      return `<div class="wrap">${sectionHead(ctx, 'programma', i, { center: true })}<ol class="tl">${list.map((x, j) => `<li class="tl-i rv" style="--d:${j % 3}"><div class="tl-t">${esc(x.time || String(j + 1).padStart(2, '0'))}</div><div class="tl-b"><h3>${esc(x.name)}</h3>${x.desc ? `<p>${esc(x.desc)}</p>` : ''}${x.price ? `<p><b>${esc(x.price)}</b></p>` : ''}</div></li>`).join('')}</ol></div>`;
    },
    galleria(ctx, i) {
      const ph = ctx.photos;
      let tiles;
      if (ph.length) tiles = ph.map((p, j) => ({ p, cap: p.cap || '' }));
      else tiles = (ctx.c.gallery || ['', '', '', '', '', '']).slice(0, 6).map((cap) => ({ p: null, cap }));
      const pat = galPattern(tiles.length);
      return `<div class="wrap">${sectionHead(ctx, 'galleria', i, { center: true })}<div class="gal">${tiles.map((tl, j) => {
        const cls = pat[j] ? ' ' + pat[j] : '';
        const cap = tl.cap ? `<span class="g-cap"><span>${esc(tl.cap)}</span></span>` : '';
        if (tl.p) return `<button type="button" class="g-it rv${cls}" style="--d:${j % 3}" data-ph="${tl.p.n}" data-cap="${esc(tl.cap)}" aria-label="Apri foto${tl.cap ? ': ' + esc(tl.cap) : ' ' + (j + 1)}"><span class="m img" style="background-image:var(${tl.p.v})"></span>${cap}</button>`;
        return `<div class="g-it is-art rv${cls}" style="--d:${j % 3}"><span class="m">${art(ctx, 'gal' + j, 'tile', tl.cap)}</span>${cap}</div>`;
      }).join('')}</div></div>`;
    },
    numeri(ctx) {
      const st = (ctx.c.stats || []).slice(0, 4);
      return `<div class="wrap"><h2 class="sr">${esc(ctx.name)} in numeri</h2><div class="stats">${st.map((s, j) => {
        const dec = String(s.n).includes('.') ? 1 : 0;
        return `<div class="rv" style="--d:${j}"><div class="st-n" data-to="${s.n}"><span class="st-v">${esc(fmtNum(s.n))}</span>${s.s ? `<small>${esc(s.s)}</small>` : ''}</div><p class="st-l">${esc(s.l)}</p></div>`;
      }).join('')}</div></div>`;
    },
    prezzi(ctx, i) {
      const plans = (ctx.c.plans || catById('altro').content.plans).slice(0, 3);
      const k = ctx.k;
      const href = ctx.has('contatti') ? '#contatti' : ctx.contactAction.href;
      return `<div class="wrap">${sectionHead(ctx, 'prezzi', i, { center: true })}<div class="plans">${plans.map((p, j) => `<article class="plan rv${p.featured ? ' ft' : ''}" style="--d:${j}">${p.featured ? '<span class="badge">Il più scelto</span>' : ''}<span class="plan-n">${esc(p.n)}</span><div class="plan-p">${esc(p.p)}</div><div class="plan-per">${esc(p.per || '')}</div><ul>${p.f.map((f) => `<li>${icon('check')}<span>${esc(f)}</span></li>`).join('')}</ul><a class="btn ${p.featured ? 'btn-p' : 'btn-s'}" href="${esc(href)}"${ext(href)}>${k.wa ? 'Richiedi su WhatsApp' : 'Scegli ' + esc(p.n)}</a></article>`).join('')}</div></div>`;
    },
    testimonianze(ctx, i) {
      const q = (ctx.c.testimonials || []).slice(0, 3);
      return `<div class="wrap">${sectionHead(ctx, 'testimonianze', i, { center: true })}<div class="quotes">${q.map((x, j) => `<figure class="q rv" style="--d:${j}"><div class="q-s" aria-label="5 stelle su 5">★★★★★</div><blockquote>${esc(x.t)}</blockquote><figcaption class="q-a">${avatar(ctx, x.a, j)}<span><b>${esc(x.a)}</b><small>${esc(x.r)}</small></span></figcaption></figure>`).join('')}</div></div>`;
    },
    team(ctx, i) {
      const tm = (ctx.c.team && ctx.c.team.length ? ctx.c.team : catById('altro').content.team).slice(0, 4);
      return `<div class="wrap">${sectionHead(ctx, 'team', i, { center: true })}<div class="team">${tm.map((p, j) => `<article class="tm rv" style="--d:${j}"><div class="tm-m">${avatar(ctx, p.n, j, true)}</div><h3>${esc(p.n)}</h3><p>${esc(p.r)}</p></article>`).join('')}</div></div>`;
    },
    faq(ctx, i) {
      const f = (ctx.c.faq || []).slice(0, 6);
      return `<div class="wrap split">${sectionHead(ctx, 'faq', i)}<div class="faq-l rv" style="--d:1">${f.map((x, j) => `<details${j === 0 ? ' open' : ''}><summary>${esc(x.q)}${icon('plus')}</summary><p>${esc(x.a)}</p></details>`).join('')}</div></div>`;
    },
    orari(ctx, i) {
      const h = ctx.hoursList.length ? ctx.hoursList : parseHours('Lunedì – Venerdì: 09:00–19:00\nSabato: 09:00–13:00\nDomenica: chiuso');
      const a = ctx.contactAction;
      return `<div class="wrap split"><div>${sectionHead(ctx, 'orari', i)}${ctx.k.phone ? `<p class="note rv">Per prenotazioni o richieste speciali chiamaci al <a href="${esc(ctx.k.tel)}">${esc(ctx.k.phone)}</a>.</p>` : ''}<div class="btns side-btns rv"><a class="btn btn-p" href="${esc(a.href)}"${ext(a.href)}>${a.href.startsWith('http') ? icon('whatsapp') : a.href.startsWith('tel') ? icon('phone') : ''}${esc(a.label)}</a></div></div>
<div class="hours rv" style="--d:1">${h.map((x) => `<div class="hr${/chius/i.test(x.t) ? ' off' : ''}"><b>${esc(x.d)}</b><span>${esc(x.t)}</span></div>`).join('')}</div></div>`;
    },
    dove(ctx, i) {
      const k = ctx.k;
      const place = k.address || ctx.city;
      const mapsLink = k.maps || (ctx.city ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(ctx.name + ' ' + ctx.city) : '');
      const intro = k.address ? '' : ctx.city ? `Ci trovi a ${ctx.city}. Scrivici per indicazioni precise su come raggiungerci.` : 'Scrivici e ti daremo tutte le indicazioni per raggiungerci.';
      const hs = ctx.hoursUser ? ctx.hoursList.slice(0, 3).map((x) => `${x.d} ${x.t}`).join(' · ') : '';
      return `<div class="wrap split"><div>${sectionHead(ctx, 'dove', i, { intro })}<ul class="addr rv" style="--d:1">${place ? `<li>${icon('pin')}<span><b>${esc(place)}</b>${k.address && ctx.city && !k.address.includes(ctx.city) ? `<span>${esc(ctx.city)}</span>` : ''}</span></li>` : ''}${hs ? `<li>${icon('clock')}<span><b>Orari</b><span>${esc(hs)}</span></span></li>` : ''}${k.phone ? `<li>${icon('phone')}<span><b><a href="${esc(k.tel)}">${esc(k.phone)}</a></b></span></li>` : ''}</ul>
<div class="btns side-btns rv" style="--d:2">${mapsLink ? `<a class="btn btn-p" href="${esc(mapsLink)}" target="_blank" rel="noopener">${icon('pin')}Apri in Maps</a>` : ''}${k.tel ? `<a class="btn btn-s" href="${esc(k.tel)}">${icon('phone')}Chiama</a>` : ''}</div></div>
<div class="map rv" style="--d:1">${mapArt(ctx)}${k.embed ? `<iframe title="Mappa: ${esc(k.address)}" src="${esc(k.embed)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>` : ''}</div></div>`;
    },
    contatti(ctx, i) {
      const k = ctx.k;
      const rows = [];
      if (k.wa) rows.push(['whatsapp', 'WhatsApp', k.waLabel || '+' + k.wa, k.waHref]);
      if (k.phone) rows.push(['phone', 'Telefono', k.phone, k.tel]);
      if (k.email) rows.push(['mail', 'Email', k.email, k.mailto]);
      if (k.address) rows.push(['pin', 'Indirizzo', k.address, k.maps]);
      if (k.ig) rows.push(['instagram', 'Instagram', k.ig, k.igHref]);
      if (k.fbHref) rows.push(['facebook', 'Facebook', k.fb, k.fbHref]);
      if (!rows.length) rows.push(['clock', 'Tempi di risposta', ctx.first ? 'Ti rispondo entro 24 ore' : 'Ti rispondiamo entro 24 ore', '']);
      const list = rows.map(([ic, lab, val, href]) => (href ? `<a href="${esc(href)}"${ext(href)}>` : '<div>') + `<span class="ct-i">${icon(ic)}</span><span><small>${esc(lab)}</small><strong>${esc(val)}</strong></span>` + (href ? '</a>' : '</div>')).join('');
      const mailAttr = k.email ? ` action="${esc(k.mailto)}" method="post" enctype="text/plain" data-mail="${esc(k.email)}"` : '';
      const thanks = k.email ? 'Si sta aprendo la tua app di posta con il messaggio pronto: premi invia e il gioco è fatto.' : (ctx.first ? 'Ho ricevuto il tuo messaggio: ti rispondo al più presto.' : 'Abbiamo ricevuto il tuo messaggio: ti risponderemo al più presto.');
      return `<div class="wrap split"><div>${sectionHead(ctx, 'contatti', i)}<div class="ct-list rv" style="--d:1">${list}</div></div>
<form class="form rv" style="--d:1"${mailAttr}><div class="f2"><label class="fld"><span>Nome</span><input name="nome" autocomplete="name" required placeholder="Il tuo nome"></label><label class="fld"><span>Email</span><input name="email" type="email" autocomplete="email" required placeholder="nome@email.it"></label></div>
<label class="fld"><span>Telefono <em style="font-style:normal;opacity:.6">(facoltativo)</em></span><input name="telefono" type="tel" autocomplete="tel" placeholder="+39 ..."></label>
<label class="fld"><span>Messaggio</span><textarea name="messaggio" required placeholder="${ctx.first ? 'Raccontami' : 'Raccontaci'} di cosa hai bisogno…"></textarea></label>
<button class="btn btn-p" type="submit">Invia messaggio ${icon('arrow')}</button><p class="fine">I tuoi dati servono solo per risponderti.</p>
<div class="form-ok" hidden tabindex="-1">${icon('check')}<b>Grazie!</b><p>${esc(thanks)}</p></div></form></div>`;
    },
    cta(ctx) {
      const cta = ctx.c.cta || {};
      const a = ctx.contactAction;
      const ph = ctx.photos[2];
      const bg = ph && (ctx.th === 'elegante' || ctx.th === 'calore' || ctx.th === 'giocoso')
        ? `<div class="cta-art cta-photo"><div class="img fill" style="background-image:var(${ph.v})"></div></div>`
        : `<div class="cta-art">${art(ctx, 'cta', 'wide')}</div>`;
      const btn2 = ctx.k.tel && a.href !== ctx.k.tel ? `<a class="btn btn-s" href="${esc(ctx.k.tel)}">${icon('phone')}${esc(ctx.k.phone)}</a>` : ctx.has('contatti') && a.href !== '#contatti' ? `<a class="btn btn-s" href="#contatti">Scrivici</a>` : '';
      return `<div class="wrap"><div class="cta-box rv">${bg}<h2>${fancy(tpl(cta.title || 'Parliamone', ctx))}</h2><p>${esc(tpl(cta.text || '', ctx))}</p><div class="btns"><a class="btn btn-p" href="${esc(a.href)}"${ext(a.href)}>${a.href.startsWith('http') ? icon('whatsapp') : ''}${esc(cta.button || a.label)}</a>${btn2}</div></div></div>`;
    },
  };

  function galPattern(n) {
    const out = [];
    let left = n, block = 0;
    while (left >= 6 && !(left === 7 || left === 8) || left >= 9) {
      out.push(...(block % 2 ? ['', 'w2 h2', '', '', '', ''] : ['w2 h2', '', '', '', '', '']));
      left -= 6; block++;
    }
    const rest = { 0: [], 1: ['w3'], 2: ['w2', ''], 3: ['', '', ''], 4: ['w2', '', '', 'w2'], 5: ['w2 h2', '', '', 'w2', ''], 7: ['w2 h2', '', '', '', '', '', 'w3'], 8: ['w2 h2', '', '', '', '', '', 'w2', ''] }[left] || [];
    return out.concat(rest);
  }

  // tono di ogni sezione (alternanza + scelte del tema)
  function toneOf(ctx, id, idx, prev) {
    const th = ctx.th;
    if (id === 'cta') return 'base';
    const inv = { elegante: ['testimonianze', 'numeri'], audace: ['numeri'], magazine: ['numeri'], minimal: ['numeri'], calore: ['numeri'], aurora: [], giocoso: [] }[th] || [];
    if (inv.includes(id)) return 'inv';
    if (th === 'minimal' || th === 'aurora') return idx % 2 ? 'alt' : 'base';
    return prev === 'base' ? 'alt' : 'base';
  }

  function dividerFor(ctx, tone, prevColor) {
    if (!prevColor) return '';
    if (ctx.th === 'calore') return `<div class="divider" aria-hidden="true"><svg viewBox="0 0 1440 80" preserveAspectRatio="none"><path d="M0 0 H1440 V40 C 1200 90 960 0 720 40 S 240 80 0 30Z" fill="${prevColor}" transform="scale(1,-1) translate(0,-80)"/></svg></div>`;
    if (ctx.th === 'giocoso') return `<div class="divider" aria-hidden="true"><svg viewBox="0 0 1440 60" preserveAspectRatio="none"><path d="M0 60 ${Array.from({ length: 24 }, (_, i) => `L${i * 60 + 30} ${i % 2 ? 60 : 20}`).join(' ')} L1440 60Z" fill="${prevColor}" transform="scale(1,-1) translate(0,-60)"/></svg></div>`;
    return '';
  }

  /* ── FOOTER ── */
  function footerHTML(ctx) {
    const k = ctx.k;
    const year = new Date().getFullYear();
    const links = ctx.sections.filter((s) => SEC_LABEL[s]).slice(0, 6).map((s) => `<li><a href="#${s}">${esc(((ctx.c.titles || {})[s] || [])[0] || SEC_LABEL[s])}</a></li>`).join('');
    const soc = [];
    if (k.igHref) soc.push(`<a href="${esc(k.igHref)}" target="_blank" rel="noopener" aria-label="Instagram">${icon('instagram')}</a>`);
    if (k.fbHref) soc.push(`<a href="${esc(k.fbHref)}" target="_blank" rel="noopener" aria-label="Facebook">${icon('facebook')}</a>`);
    if (k.waHref) soc.push(`<a href="${esc(k.waHref)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp')}</a>`);
    if (k.mailto) soc.push(`<a href="${esc(k.mailto)}" aria-label="Email">${icon('mail')}</a>`);
    const ct = [];
    if (k.phone) ct.push(`<li><a href="${esc(k.tel)}">${esc(k.phone)}</a></li>`);
    if (k.email) ct.push(`<li><a href="${esc(k.mailto)}">${esc(k.email)}</a></li>`);
    if (k.wa && !k.phone) ct.push(`<li><a href="${esc(k.waHref)}" target="_blank" rel="noopener">WhatsApp</a></li>`);
    if (k.address) ct.push(`<li><a href="${esc(k.maps)}" target="_blank" rel="noopener">${esc(k.address)}</a></li>`);
    else if (ctx.city) ct.push(`<li>${esc(ctx.city)}</li>`);
    if (!ct.length) ct.push(`<li><a href="#contatti">${ctx.first ? 'Scrivimi' : 'Scrivici'} dal modulo</a></li>`);
    const hrs = (ctx.hoursUser || ctx.has('orari')) ? ctx.hoursList.slice(0, 4).map((h) => `<li>${esc(h.d)}${h.t ? '<br>' + esc(h.t) : ''}</li>`).join('') : '';
    const len = ctx.name.length;
    const big = (ctx.th === 'audace' || ctx.th === 'minimal') ? `<div class="wrap"><div class="foot-big" aria-hidden="true" style="--fbig:${Math.min(ctx.th === 'audace' ? 15 : 13, (ctx.th === 'audace' ? 175 : 150) / Math.max(len, 4)).toFixed(2)}vw">${esc(ctx.name)}${ctx.th === 'minimal' ? '<span class="dot">.</span>' : ''}</div></div>` : '';
    return `<footer class="foot"><div class="wrap"><div class="foot-g">
<div>${brandHTML(ctx)}<p class="foot-tag">${esc(ctx.tagline)}</p>${soc.length ? `<div class="soc">${soc.join('')}</div>` : ''}</div>
<div><h4>Esplora</h4><ul>${links}</ul></div>
<div><h4>Contatti</h4><ul>${ct.join('')}</ul></div>
${hrs ? `<div><h4>Orari</h4><ul>${hrs}</ul></div>` : `<div><h4>${esc(ctx.c.noun ? titleCase(ctx.c.noun) : 'Info')}</h4><ul>${(ctx.c.about.highlights || []).slice(0, 3).map((h) => `<li>${esc(h)}</li>`).join('')}</ul></div>`}
</div><div class="foot-b"><span>© ${year} ${esc(ctx.name)}. Tutti i diritti riservati.</span><a href="#top">Torna su ↑</a></div></div>${big}</footer>`;
  }

  /* ── SCRIPT DEL SITO ── */
  const SITE_JS = `(function(){var d=document,nav=d.querySelector('.nav'),bt=d.querySelector('.burger');
if(bt&&nav){bt.addEventListener('click',function(){var o=nav.classList.toggle('open');bt.setAttribute('aria-expanded',o?'true':'false');bt.setAttribute('aria-label',o?'Chiudi il menu':'Apri il menu')});
d.querySelectorAll('.menu a').forEach(function(a){a.addEventListener('click',function(){nav.classList.remove('open');bt.setAttribute('aria-expanded','false')})});
d.addEventListener('keydown',function(e){if(e.key==='Escape'&&nav.classList.contains('open')){nav.classList.remove('open');bt.setAttribute('aria-expanded','false');bt.focus()}})}
function sc(){var s=(window.scrollY||d.documentElement.scrollTop)>30;if(nav)nav.classList.toggle('scrolled',s)}sc();window.addEventListener('scroll',sc,{passive:true});
var rm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches,rv=d.querySelectorAll('.rv');
function fmt(v,dec){return v.toLocaleString('it-IT',{minimumFractionDigits:dec,maximumFractionDigits:dec})}
function count(el){var raw=el.getAttribute('data-to'),to=parseFloat(raw),dec=(raw.split('.')[1]||'').length,out=el.querySelector('.st-v'),t0=null;if(!out||isNaN(to))return;function st(t){if(!t0)t0=t;var p=Math.min(1,(t-t0)/1600),e=1-Math.pow(1-p,3);out.textContent=fmt(to*e,dec);if(p<1)requestAnimationFrame(st)}requestAnimationFrame(st)}
if(!('IntersectionObserver' in window)||rm){rv.forEach(function(e){e.classList.add('in')})}else{
var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{rootMargin:'0px 0px -6% 0px',threshold:0.05});rv.forEach(function(e){io.observe(e)});
var co=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){count(e.target);co.unobserve(e.target)}})},{threshold:0.5});d.querySelectorAll('.st-n[data-to]').forEach(function(e){co.observe(e)})}
var lb=d.querySelector('.lb');if(lb){var its=[].slice.call(d.querySelectorAll('[data-ph]')),cur=0,img=lb.querySelector('.lb-img'),cap=lb.querySelector('.lb-cap'),last=null;
function show(i){cur=(i+its.length)%its.length;var it=its[cur],c=it.getAttribute('data-cap')||'';img.style.backgroundImage='var(--ph'+it.getAttribute('data-ph')+')';cap.textContent=c+(its.length>1?'  ·  '+(cur+1)+' / '+its.length:'');img.setAttribute('aria-label',c||'Foto '+(cur+1))}
function open(i){last=d.activeElement;show(i);lb.hidden=false;d.body.style.overflow='hidden';lb.querySelector('.lb-x').focus()}
function close(){lb.hidden=true;d.body.style.overflow='';if(last)last.focus()}
its.forEach(function(it,i){it.addEventListener('click',function(){open(i)})});
lb.querySelector('.lb-x').addEventListener('click',close);lb.querySelector('.lb-p').addEventListener('click',function(){show(cur-1)});lb.querySelector('.lb-n').addEventListener('click',function(){show(cur+1)});
lb.addEventListener('click',function(e){if(e.target===lb||e.target.classList.contains('lb-f'))close()});
d.addEventListener('keydown',function(e){if(lb.hidden)return;if(e.key==='Escape')close();else if(e.key==='ArrowLeft')show(cur-1);else if(e.key==='ArrowRight')show(cur+1)});
if(its.length<2){lb.querySelector('.lb-p').hidden=true;lb.querySelector('.lb-n').hidden=true}}
d.querySelectorAll('form.form').forEach(function(f){f.addEventListener('submit',function(e){e.preventDefault();var m=f.getAttribute('data-mail'),g=function(n){var x=f.querySelector('[name='+n+']');return x?x.value:''};
if(m){var body='Nome: '+g('nome')+'\\nEmail: '+g('email')+(g('telefono')?'\\nTelefono: '+g('telefono'):'')+'\\n\\n'+g('messaggio');try{window.location.href='mailto:'+m+'?subject='+encodeURIComponent('Richiesta dal sito')+'&body='+encodeURIComponent(body)}catch(x){}}
var ok=f.querySelector('.form-ok');f.classList.add('sent');if(ok){ok.hidden=false;ok.focus()}})})})();`;

  /* ═════════════════════════════ GENERAZIONE ═════════════════════════════ */

  function generateOffline(brief, legacyStyle) {
    UID = 0;
    const b = normalizeBrief(brief, legacyStyle);
    const ctx = buildCtx(b);
    const P = ctx.P, tc = ctx.t.colors;

    const inv = tc.inv, invText = tc.invText;
    const vars = {
      '--bg': P.bg, '--bg2': P.bg2, '--surface': P.surface, '--text': P.text, '--muted': P.muted, '--line': P.line,
      '--accent': P.accent, '--accent-ink': P.accentInk, '--accent-text': P.accentText,
      '--accent-soft': mix(P.accent, P.bg, lum(P.bg) < 0.2 ? 0.8 : 0.87),
      '--a2': P.a2, '--a3': P.a3, '--a4': P.a4,
      '--inv': inv, '--inv2': mix(inv, invText, 0.05), '--inv-text': invText, '--inv-muted': mix(invText, inv, 0.32), '--inv-line': mix(inv, invText, 0.16), '--inv-surface': mix(inv, invText, 0.05), '--inv-accent-text': P.accentOnInv,
      '--fd': ctx.t.fonts.display, '--fb': ctx.t.fonts.body, '--fu': ctx.t.fonts.ui,
      '--maxw': '1200px', '--gut': 'clamp(20px,5vw,56px)', '--sy': 'clamp(84px,11vw,148px)', '--navh': '76px', '--r': '14px', '--r-lg': '24px', '--h2': 'clamp(2.2rem,4.8vw,3.8rem)', '--star': '#f5a524',
    };
    if (ctx.th === 'minimal') vars['--line'] = P.line;
    const rootVars = ':root{' + Object.keys(vars).map((k) => `${k}:${vars[k]}`).join(';') + '}';
    const photoVars = ctx.photos.length ? ':root{' + ctx.photos.map((p) => `${p.v}:${cssUrl(p.src)}`).join(';') + '}' : '';

    // sezioni
    let prevTone = null, prevColor = null;
    const toneColor = (t) => (t === 'inv' ? inv : t === 'alt' ? P.bg2 : P.bg);
    let headIdx = 0;
    const secHTML = ctx.sections.map((id) => {
      const fn = SECTIONS[id];
      if (!fn) return '';
      let tone = toneOf(ctx, id, headIdx, prevTone);
      let style = '';
      if (ctx.th === 'giocoso' && tone === 'alt') { const pc = ctx.pastels[headIdx % ctx.pastels.length]; style = ` style="--bg:${mix(pc, P.bg, 0.45)}"`; }
      const body = fn(ctx, headIdx);
      const myColor = style ? mix(ctx.pastels[headIdx % ctx.pastels.length], P.bg, 0.45) : toneColor(tone);
      const div = prevColor && prevColor !== myColor ? dividerFor(ctx, tone, prevColor) : '';
      const cls = `sec s-${id} t-${tone}${id === 'numeri' || id === 'cta' ? ' compact' : ''}`;
      const html = `<section id="${id}" class="${cls}"${style}>${div}${body}</section>`;
      if (id !== 'numeri' && id !== 'cta') headIdx++;
      prevTone = tone; prevColor = myColor;
      return html;
    }).join('\n');

    // il primo divisore dopo l'hero (calore usa l'onda nell'hero)
    const hero = HERO[ctx.th](ctx);
    const hasGallery = ctx.has('galleria') && ctx.photos.length > 0;
    const lightbox = hasGallery ? `<div class="lb" role="dialog" aria-modal="true" aria-label="Galleria fotografica" hidden><button class="lb-x" type="button" aria-label="Chiudi">${icon('x')}</button><button class="lb-p" type="button" aria-label="Foto precedente">${icon('left')}</button><figure class="lb-f"><div class="lb-img" role="img"></div><figcaption class="lb-cap"></figcaption></figure><button class="lb-n" type="button" aria-label="Foto successiva">${icon('right')}</button></div>` : '';
    const wa = ctx.k.waHref ? `<a class="wa-f" href="${esc(ctx.k.waHref)}" target="_blank" rel="noopener" aria-label="Scrivici su WhatsApp">${icon('whatsapp')}</a>` : '';

    const fav = ctx.logo || ('data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="${P.accent}"/><text x="32" y="42" text-anchor="middle" font-family="Georgia,serif" font-size="28" font-weight="700" fill="${P.accentInk}">${initials(ctx.name).replace(/[<&>]/g, '')}</text></svg>`));
    const desc = clean(ctx.tagline + (ctx.city ? ' — ' + ctx.city : ''));
    const css = BASE_CSS + '\n' + (THEME_CSS[ctx.th] || (() => ''))(ctx);

    return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(ctx.name)}${ctx.tagline ? ' — ' + esc(ctx.tagline.length > 60 ? ctx.tagline.slice(0, 58) + '…' : ctx.tagline) : ''}</title>
<meta name="description" content="${esc(desc)}">
<meta name="theme-color" content="${esc(ctx.th === 'elegante' ? tc.inv : P.bg)}">
<meta property="og:title" content="${esc(ctx.name)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website">
<link rel="icon" href="${esc(fav)}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${esc(ctx.t.fonts.href)}">
<script>document.documentElement.classList.add('js')</script>
<style>
${rootVars}
${photoVars}
${css}
</style>
</head>
<body class="th-${ctx.th} cat-${esc(ctx.cat.id)}">
<a class="skip" href="#main">Vai al contenuto</a>
${navHTML(ctx)}
<main id="main">
${hero}
${secHTML}
</main>
${footerHTML(ctx)}
${lightbox}
${wa}
<script>${SITE_JS}</script>
</body>
</html>`;
  }

  window.detectBrief = detectBrief;
  window.generateOffline = generateOffline;
  window.OFFLINE_ENGINE = { version: '2.0', parseItems, parseHours, normalizeBrief };
})();
