// Generatore offline: crea un sito a partire dalla descrizione usando parole chiave.
// Funziona senza AI e senza connessione, utile come piano B.
(function () {
  const PALETTES = {
    scuro: { bg: '#0e0f13', surface: '#181a21', text: '#f1f1f4', muted: '#a3a6b3', accent: '#c9a96e' },
    minimal: { bg: '#ffffff', surface: '#f5f5f5', text: '#111111', muted: '#666666', accent: '#111111' },
    colorato: { bg: '#fffaf3', surface: '#ffffff', text: '#1d1d35', muted: '#5a5a78', accent: '#ff5c8a' },
    rustico: { bg: '#fbf5ec', surface: '#ffffff', text: '#3b2a1a', muted: '#7a634c', accent: '#b5562b' },
    moderno: { bg: '#f7f8fc', surface: '#ffffff', text: '#14162b', muted: '#5d6280', accent: '#5b5bf0' },
  };

  const CATEGORIES = [
    { keys: ['pizz', 'ristorant', 'trattori', 'cucina', 'osteria', 'sushi'], emoji: '🍽️', type: 'ristorante',
      sections: ['menu', 'orari', 'galleria', 'contatti'], palette: 'rustico' },
    { keys: ['bar', 'caff', 'pasticceri', 'gelat', 'panett'], emoji: '☕', type: 'bar',
      sections: ['menu', 'orari', 'chi', 'contatti'], palette: 'rustico' },
    { keys: ['fotograf', 'portfolio', 'artist', 'design', 'illustr'], emoji: '📷', type: 'portfolio',
      sections: ['galleria', 'chi', 'prezzi', 'contatti'], palette: 'minimal' },
    { keys: ['app', 'startup', 'saas', 'software', 'piattaform'], emoji: '🚀', type: 'prodotto',
      sections: ['funzioni', 'prezzi', 'testimonianze', 'faq', 'contatti'], palette: 'moderno' },
    { keys: ['palestr', 'fitness', 'yoga', 'sport', 'personal trainer'], emoji: '💪', type: 'fitness',
      sections: ['funzioni', 'prezzi', 'orari', 'testimonianze', 'contatti'], palette: 'colorato' },
    { keys: ['svilupp', 'programm', 'developer', 'curriculum', 'cv'], emoji: '💻', type: 'personale',
      sections: ['chi', 'competenze', 'progetti', 'contatti'], palette: 'scuro' },
    { keys: ['negozio', 'shop', 'vend', 'abbigliam', 'prodott'], emoji: '🛍️', type: 'negozio',
      sections: ['prodotti', 'chi', 'testimonianze', 'contatti'], palette: 'moderno' },
    { keys: ['hotel', 'b&b', 'albergo', 'casa vacanz', 'agriturism'], emoji: '🏡', type: 'ospitalità',
      sections: ['galleria', 'prezzi', 'chi', 'contatti'], palette: 'rustico' },
  ];

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function guessName(idea) {
    const m = idea.match(/(?:chiamat[oa]|nome)\s+["“']?([A-Z0-9][\w'’ &-]{1,30}?)["”']?(?=[,.:;!?]|\s+(?:con|che|a|in|per)\b|$)/i);
    if (m) return m[1].trim();
    const quoted = idea.match(/["“]([^"”]{2,30})["”]/);
    if (quoted) return quoted[1];
    const caps = idea.match(/\b([A-Z][a-zà-ù]+(?:[A-Z][a-z]+)+)\b/); // es. FitGo
    if (caps) return caps[1];
    return null;
  }

  function guessCity(idea) {
    const m = idea.match(/\b(?:a|di|in)\s+([A-Z][a-zà-ù]+)/);
    return m ? m[1] : null;
  }

  function pickCategory(idea) {
    const low = idea.toLowerCase();
    return CATEGORIES.find((c) => c.keys.some((k) => low.includes(k))) ||
      { emoji: '✨', type: 'attività', sections: ['funzioni', 'chi', 'testimonianze', 'contatti'], palette: 'moderno' };
  }

  function pickPalette(idea, style, cat) {
    const s = (style + ' ' + idea).toLowerCase();
    if (/scur|dark|nero|elegant/.test(s)) return PALETTES.scuro;
    if (/minimal|bianco e nero|pulit/.test(s)) return PALETTES.minimal;
    if (/colorat|giocos|energic|vivac/.test(s)) return PALETTES.colorato;
    if (/rustic|cald|accoglient/.test(s)) return PALETTES.rustico;
    if (/modern/.test(s)) return PALETTES.moderno;
    const pal = { ...PALETTES[cat.palette] };
    if (/\bblu\b/.test(s)) pal.accent = '#2563eb';
    if (/\bverd/.test(s)) pal.accent = '#16a34a';
    if (/\brosso|\brossa/.test(s)) pal.accent = '#dc2626';
    if (/\bviola/.test(s)) pal.accent = '#7c3aed';
    if (/\barancion/.test(s)) pal.accent = '#ea580c';
    return pal;
  }

  function section(id, cat) {
    const cards = (items) => `<div class="grid">${items.map(([t, d]) => `<div class="card"><h3>${t}</h3><p>${d}</p></div>`).join('')}</div>`;
    switch (id) {
      case 'menu': return ['Menù', `<div class="menu">${[
        ['Specialità della casa', '12€'], ['Piatto del giorno', '10€'], ['Antipasto misto', '8€'],
        ['Dolce fatto in casa', '5€'], ['Bevanda', '3€'], ['Caffè', '1,20€'],
      ].map(([n, p]) => `<div class="menu-item"><span>${n}</span><span class="dots"></span><strong>${p}</strong></div>`).join('')}</div>`];
      case 'orari': return ['Orari', `<div class="hours">${[
        ['Lunedì – Venerdì', '08:00 – 22:00'], ['Sabato', '09:00 – 23:00'], ['Domenica', '10:00 – 20:00'],
      ].map(([d, h]) => `<div class="menu-item"><span>${d}</span><span class="dots"></span><strong>${h}</strong></div>`).join('')}</div>`];
      case 'galleria': return ['Galleria', `<div class="gallery">${[1, 2, 3, 4, 5, 6].map((i) =>
        `<div class="ph" style="--h:${(i * 47) % 360}">${cat.emoji}</div>`).join('')}</div>`];
      case 'chi': return ['Chi siamo', `<p class="lead">Siamo nati da una passione semplice: offrire qualcosa di autentico e di qualità. Ogni giorno lavoriamo con cura e attenzione ai dettagli, perché chi ci sceglie merita il meglio.</p>`];
      case 'funzioni': return ['Cosa offriamo', cards([
        ['⚡ Veloce', 'Risultati immediati, senza complicazioni.'], ['🎯 Su misura', 'Pensato per le tue esigenze specifiche.'],
        ['🤝 Supporto', 'Siamo sempre al tuo fianco quando serve.'],
      ])];
      case 'prezzi': return ['Prezzi', `<div class="grid">${[
        ['Base', '9', ['Funzioni essenziali', 'Supporto email']], ['Pro', '19', ['Tutto di Base', 'Funzioni avanzate', 'Supporto prioritario']],
        ['Premium', '39', ['Tutto di Pro', 'Consulenza dedicata', 'Personalizzazioni']],
      ].map(([n, p, f], i) => `<div class="card price${i === 1 ? ' featured' : ''}"><h3>${n}</h3><div class="amount">${p}€<small>/mese</small></div><ul>${f.map((x) => `<li>✓ ${x}</li>`).join('')}</ul><a class="btn" href="#contatti">Scegli</a></div>`).join('')}</div>`];
      case 'testimonianze': return ['Dicono di noi', cards([
        ['★★★★★', '“Esperienza fantastica, lo consiglio a tutti!” — Giulia'], ['★★★★★', '“Professionali e gentilissimi.” — Marco'],
        ['★★★★★', '“Oltre le aspettative, tornerò sicuramente.” — Sara'],
      ])];
      case 'faq': return ['Domande frequenti', ['Come posso iniziare?', 'Posso disdire quando voglio?', 'Offrite supporto?'].map((q) =>
        `<details class="faq"><summary>${q}</summary><p>Certo! Contattaci e ti aiuteremo in pochi minuti.</p></details>`).join('')];
      case 'competenze': return ['Competenze', `<div class="tags">${['HTML', 'CSS', 'JavaScript', 'React', 'Node.js', 'Git', 'UI Design'].map((t) => `<span>${t}</span>`).join('')}</div>`];
      case 'progetti': return ['Progetti', cards([
        ['Progetto Uno', 'Una web app per gestire attività quotidiane.'], ['Progetto Due', 'Sito e-commerce responsive.'],
        ['Progetto Tre', 'Dashboard con grafici in tempo reale.'],
      ])];
      case 'prodotti': return ['Prodotti', `<div class="grid">${['Prodotto A', 'Prodotto B', 'Prodotto C'].map((p, i) =>
        `<div class="card"><div class="ph" style="--h:${i * 90}">${cat.emoji}</div><h3>${p}</h3><p>${(i + 2) * 10}€</p></div>`).join('')}</div>`];
      case 'contatti': return ['Contatti', `<form class="contact" onsubmit="event.preventDefault();this.innerHTML='<p class=lead>Grazie! Ti risponderemo presto ✉️</p>'">
        <input placeholder="Nome" required><input type="email" placeholder="Email" required><textarea placeholder="Messaggio" rows="4"></textarea>
        <button class="btn" type="submit">Invia</button></form>`];
      default: return null;
    }
  }

  window.generateOffline = function (idea, style) {
    const cat = pickCategory(idea);
    const p = pickPalette(idea, style, cat);
    const city = guessCity(idea);
    const name = guessName(idea) || `Il tuo ${cat.type}${city ? ' a ' + city : ''}`;
    const tagline = idea.length > 160 ? idea.slice(0, 157).trim() + '…' : idea;
    const secs = cat.sections.map((s) => [s, section(s, cat)]).filter(([, v]) => v);
    const wantsWhatsApp = /whatsapp/i.test(idea);

    return `<!doctype html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)}</title>
<style>
:root{--bg:${p.bg};--surface:${p.surface};--text:${p.text};--muted:${p.muted};--accent:${p.accent}}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
nav{position:sticky;top:0;display:flex;justify-content:space-between;align-items:center;padding:16px 6vw;background:color-mix(in srgb,var(--bg) 85%,transparent);backdrop-filter:blur(8px);z-index:10}
nav .logo{font-weight:800;font-size:1.2rem}nav a{color:var(--muted);text-decoration:none;margin-left:20px;font-size:.95rem}nav a:hover{color:var(--accent)}
.hero{padding:14vh 6vw 12vh;text-align:center}
.hero .emoji{font-size:3.5rem}.hero h1{font-size:clamp(2.2rem,6vw,4rem);margin:.2em 0;line-height:1.1}
.hero p{max-width:640px;margin:0 auto 32px;color:var(--muted);font-size:1.15rem}
.btn{display:inline-block;background:var(--accent);color:var(--bg);padding:14px 28px;border-radius:999px;text-decoration:none;font-weight:700;border:0;cursor:pointer;font:inherit;font-weight:700}
.btn:hover{filter:brightness(1.1)}
section{padding:80px 6vw;max-width:1100px;margin:0 auto}
section h2{font-size:2rem;margin:0 0 32px;text-align:center}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}
.card{background:var(--surface);border-radius:16px;padding:28px;box-shadow:0 4px 24px rgba(0,0,0,.06);border:1px solid color-mix(in srgb,var(--text) 8%,transparent)}
.card h3{margin-top:0}.card p{color:var(--muted);margin-bottom:0}
.price{text-align:center}.price.featured{outline:2px solid var(--accent);transform:scale(1.03)}
.amount{font-size:2.5rem;font-weight:800;margin:8px 0}.amount small{font-size:1rem;color:var(--muted);font-weight:400}
.price ul{list-style:none;padding:0;margin:16px 0 24px;color:var(--muted)}.price li{padding:4px 0}
.menu,.hours{max-width:600px;margin:0 auto}
.menu-item{display:flex;align-items:baseline;gap:8px;padding:10px 0;font-size:1.1rem}
.dots{flex:1;border-bottom:2px dotted color-mix(in srgb,var(--text) 25%,transparent)}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.ph{aspect-ratio:4/3;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:2.5rem;background:linear-gradient(135deg,hsl(var(--h) 60% 75%),hsl(calc(var(--h) + 40) 60% 60%));margin-bottom:12px}
.lead{max-width:720px;margin:0 auto;text-align:center;font-size:1.2rem;color:var(--muted)}
.faq{background:var(--surface);border-radius:12px;padding:18px 22px;margin-bottom:12px;max-width:720px;margin-left:auto;margin-right:auto}
.faq summary{cursor:pointer;font-weight:600}
.tags{display:flex;flex-wrap:wrap;gap:10px;justify-content:center}.tags span{background:var(--surface);border:1px solid var(--accent);padding:8px 16px;border-radius:999px}
.contact{max-width:520px;margin:0 auto;display:flex;flex-direction:column;gap:12px}
.contact input,.contact textarea{padding:14px;border-radius:10px;border:1px solid color-mix(in srgb,var(--text) 20%,transparent);background:var(--surface);color:var(--text);font:inherit}
footer{text-align:center;padding:40px;color:var(--muted);font-size:.9rem}
.wa{position:fixed;right:20px;bottom:20px;background:#25d366;color:#fff;border-radius:999px;padding:14px 20px;text-decoration:none;font-weight:700;box-shadow:0 6px 20px rgba(0,0,0,.2)}
@media(max-width:640px){nav a{display:none}}
</style>
</head>
<body>
<nav><div class="logo">${cat.emoji} ${esc(name)}</div><div>${secs.map(([id, [t]]) => `<a href="#${id === 'contatti' ? 'contatti' : id}">${t}</a>`).join('')}</div></nav>
<header class="hero">
  <div class="emoji">${cat.emoji}</div>
  <h1>${esc(name)}</h1>
  <p>${esc(tagline)}</p>
  <a class="btn" href="#contatti">${wantsWhatsApp ? 'Prenota ora' : 'Contattaci'}</a>
</header>
${secs.map(([id, [t, html]]) => `<section id="${id}"><h2>${t}</h2>${html}</section>`).join('\n')}
<footer>© ${new Date().getFullYear()} ${esc(name)}${city ? ' · ' + esc(city) : ''}</footer>
${wantsWhatsApp ? '<a class="wa" href="https://wa.me/" target="_blank" rel="noopener">💬 WhatsApp</a>' : ''}
</body>
</html>`;
  };
})();
