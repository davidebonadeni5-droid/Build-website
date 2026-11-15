(function () {
  const $ = (id) => document.getElementById(id);
  const els = {
    idea: $('idea'), style: $('style'), engine: $('engine'), generate: $('generate'),
    refineBox: $('refine-box'), refine: $('refine'), refineBtn: $('refine-btn'), status: $('status'),
    empty: $('empty'), frameWrap: $('frame-wrap'), preview: $('preview'), code: $('code'), codeText: $('code-text'),
    copy: $('copy'), open: $('open'), download: $('download'), historyList: $('history-list'),
  };

  const HISTORY_KEY = 'ideasito-history';
  let currentHtml = '';
  let currentIdea = '';
  let busy = false;

  const SYSTEM_PROMPT = `Sei un web designer esperto. Crei siti web completi, moderni e belli.
Regole:
- Rispondi SOLO con un unico file HTML completo, da <!DOCTYPE html> a </html>. Niente spiegazioni, niente markdown.
- Tutto il CSS dentro <style> e tutto il JavaScript dentro <script>, nello stesso file.
- Design responsive (funziona su telefono), tipografia curata, spaziature generose, palette coerente.
- Usa contenuti realistici in italiano (testi, prezzi, orari plausibili), non lorem ipsum.
- Per le immagini usa https://picsum.photos/seed/PAROLA/LARGHEZZA/ALTEZZA (cambia PAROLA per ogni immagine) oppure emoji/gradienti.
- Puoi usare Google Fonts tramite <link>.
- Includi navigazione con link alle sezioni, footer, e piccoli effetti hover/animazioni.`;

  // ---------- UI helpers ----------
  function setStatus(msg, kind = '', spin = false) {
    els.status.className = 'status' + (kind ? ' ' + kind : '');
    els.status.innerHTML = (spin ? '<span class="spinner"></span>' : '') + msg;
  }

  function setBusy(b) {
    busy = b;
    els.generate.disabled = b;
    els.refineBtn.disabled = b;
  }

  function showHtml(html) {
    currentHtml = html;
    els.empty.classList.add('hidden');
    els.preview.srcdoc = html;
    els.codeText.textContent = html;
    const activeView = document.querySelector('.tab.active').dataset.view;
    els.frameWrap.classList.toggle('hidden', activeView !== 'preview');
    els.code.classList.toggle('hidden', activeView !== 'code');
    [els.copy, els.open, els.download].forEach((b) => (b.disabled = !html));
  }

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

  // ---------- Generazione ----------
  async function runAI(prompt, model) {
    if (typeof puter === 'undefined' || !puter.ai) {
      throw new Error('Il servizio AI gratuito (Puter) non si è caricato. Controlla la connessione o usa la modalità Offline.');
    }
    const stream = await puter.ai.chat(prompt, { model, stream: true });
    let raw = '';
    let lastPaint = 0;
    for await (const part of stream) {
      if (part && part.text) {
        raw += part.text;
        const now = Date.now();
        if (now - lastPaint > 700) {
          lastPaint = now;
          els.codeText.textContent = raw;
          const partial = extractHtml(raw);
          if (partial.includes('<body')) showHtml(partial);
          setStatus(`Sto scrivendo il sito… ${Math.round(raw.length / 1000)}k caratteri`, '', true);
        }
      }
    }
    const html = extractHtml(raw);
    if (!/<html|<body|<div/i.test(html)) throw new Error("L'AI non ha restituito un sito valido. Riprova.");
    return html;
  }

  async function generate() {
    const idea = els.idea.value.trim();
    if (idea.length < 10) {
      setStatus('Descrivi la tua idea con qualche parola in più 🙂', 'error');
      els.idea.focus();
      return;
    }
    const style = els.style.value;
    const engine = els.engine.value;
    setBusy(true);
    try {
      let html;
      if (engine === 'offline') {
        setStatus('Creo il sito dal template…', '', true);
        html = window.generateOffline(idea, style);
      } else {
        setStatus("L'AI sta progettando il tuo sito… (la prima volta Puter potrebbe chiederti un accesso gratuito)", '', true);
        const prompt = `${SYSTEM_PROMPT}\n\nIdea del sito:\n${idea}${style ? `\n\nStile richiesto: ${style}` : ''}`;
        html = await runAI(prompt, engine);
      }
      currentIdea = idea;
      showHtml(html);
      saveHistory(idea, html);
      els.refineBox.classList.remove('hidden');
      setStatus('Fatto! Puoi chiedere modifiche o scaricare il sito.', 'ok');
    } catch (err) {
      console.error(err);
      setStatus(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function refine() {
    const request = els.refine.value.trim();
    if (!request || !currentHtml) return;
    const engine = els.engine.value;
    if (engine === 'offline') {
      setStatus('Le modifiche richiedono un motore AI: selezionane uno in "Motore".', 'error');
      return;
    }
    setBusy(true);
    setStatus('Applico la modifica…', '', true);
    try {
      const prompt = `${SYSTEM_PROMPT}\n\nQuesto è il sito attuale:\n\n${currentHtml}\n\nModifica richiesta dall'utente:\n${request}\n\nRestituisci il file HTML completo aggiornato, mantenendo tutto il resto invariato.`;
      const html = await runAI(prompt, engine);
      showHtml(html);
      saveHistory(currentIdea + ' → ' + request, html);
      els.refine.value = '';
      setStatus('Modifica applicata ✓', 'ok');
    } catch (err) {
      console.error(err);
      setStatus(friendlyError(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  function friendlyError(err) {
    const msg = (err && (err.message || err.error?.message || (typeof err === 'string' ? err : ''))) || '';
    if (/cancel|closed|denied/i.test(msg)) return 'Accesso a Puter annullato. Serve un account gratuito Puter per usare l\'AI, oppure usa la modalità Offline.';
    if (/limit|quota|insufficient|credit/i.test(msg)) return 'Limite gratuito raggiunto per ora. Prova un altro motore, riprova più tardi o usa la modalità Offline.';
    if (/Offline/.test(msg)) return msg;
    return 'Qualcosa è andato storto: ' + (msg || 'errore sconosciuto').replace(/\.$/, '') + '. Riprova o usa la modalità Offline.';
  }

  // ---------- Cronologia ----------
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(HISTORY_KEY)) || []; } catch { return []; }
  }

  function saveHistory(idea, html) {
    const list = loadHistory();
    list.unshift({ idea, html, at: Date.now() });
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 10)));
    } catch {
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, 3))); } catch { /* storage pieno */ }
    }
    renderHistory();
  }

  function renderHistory() {
    const list = loadHistory();
    els.historyList.innerHTML = '';
    if (!list.length) {
      els.historyList.innerHTML = '<li><span>Nessun sito ancora.</span></li>';
      return;
    }
    list.forEach((item) => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = item.idea;
      span.title = item.idea;
      const btn = document.createElement('button');
      btn.className = 'btn small';
      btn.textContent = 'Apri';
      btn.onclick = () => {
        currentIdea = item.idea.split(' → ')[0];
        els.idea.value = currentIdea;
        showHtml(item.html);
        els.refineBox.classList.remove('hidden');
        setStatus('Sito caricato dalla cronologia.', 'ok');
      };
      li.append(span, btn);
      els.historyList.append(li);
    });
  }

  // ---------- Azioni ----------
  function download() {
    const blob = new Blob([currentHtml], { type: 'text/html' });
    const a = document.createElement('a');
    const slug = (currentIdea.split(/\s+/).slice(0, 4).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'sito');
    a.href = URL.createObjectURL(blob);
    a.download = `${slug}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function openNew() {
    const url = URL.createObjectURL(new Blob([currentHtml], { type: 'text/html' }));
    window.open(url, '_blank');
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(currentHtml);
      setStatus('Codice copiato negli appunti ✓', 'ok');
    } catch {
      setStatus('Impossibile copiare: apri la scheda "Codice" e copia a mano.', 'error');
    }
  }

  // ---------- Eventi ----------
  els.generate.addEventListener('click', generate);
  els.refineBtn.addEventListener('click', refine);
  els.download.addEventListener('click', download);
  els.open.addEventListener('click', openNew);
  els.copy.addEventListener('click', copy);

  els.idea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy) generate();
  });
  els.refine.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !busy) refine();
  });

  document.querySelectorAll('.example').forEach((b) =>
    b.addEventListener('click', () => { els.idea.value = b.dataset.text; els.idea.focus(); }));

  document.querySelectorAll('.tab').forEach((tab) =>
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
      if (!currentHtml && !els.codeText.textContent) return;
      const isPreview = tab.dataset.view === 'preview';
      els.frameWrap.classList.toggle('hidden', !isPreview);
      els.code.classList.toggle('hidden', isPreview);
    }));

  document.querySelectorAll('.device').forEach((d) =>
    d.addEventListener('click', () => {
      document.querySelectorAll('.device').forEach((x) => x.classList.toggle('active', x === d));
      els.preview.style.width = d.dataset.w;
    }));

  renderHistory();
})();
