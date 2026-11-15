/* IdeaSito — «Modifica cliccando»: editor visivo sull'anteprima.
 *
 * L'iframe dell'anteprima è sandbox SENZA allow-same-origin: il genitore non può toccarne il DOM.
 * Quando la modalità Modifica è attiva, nel srcdoc viene iniettato un piccolo script (mai nel file scaricato)
 * che parla con questa pagina via postMessage.
 *
 * Persistenza:
 *  - sito offline: i testi hanno data-e="<chiave>" (offline/engine.js). Le modifiche finiscono in
 *    state.overrides = { text:{key:{v,o}}, links:{key:href}, hiddenSections:[id], sectionBg:{id:tono}, imgToken }
 *    e vengono riapplicate dopo ogni generazione/cambio stile (IdeaSito.transformRaw). Le immagini sostituite
 *    stanno a parte (localStorage, best effort) e sono esposte come overrides.images.
 *    Nascondi/sposta sezione aggiornano state.sections (la scheda guidata lo riflette).
 *  - sito AI: nessuna chiave, si modifica direttamente l'HTML corrente (current.raw).
 */
(function () {
  'use strict';

  const IS = (window.IdeaSito = window.IdeaSito || {});
  const $ = (id) => document.getElementById(id);
  const IMG_KEY = 'ideasito-edit-images';
  const MAX_UNDO = 40;
  const MULTI = /^(P|BLOCKQUOTE|DD)$/;

  // ---------------------------------------------------------------------------
  // Funzioni condivise con lo script iniettato nell'iframe (stringificate: niente closure!)
  // ---------------------------------------------------------------------------
  function veSkip(n) {
    if (n.nodeType !== 1) return false;
    const t = n.tagName;
    return t === 'svg' || t === 'SVG' || t === 'SCRIPT' || t === 'STYLE' || t === 'BR' || (n.classList && n.classList.contains('dot')) || n.getAttribute('aria-hidden') === 'true';
  }
  function veCollect(node, out) {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { if (c.nodeValue.trim()) out.push(c); } else if (c.nodeType === 1 && !veSkip(c)) veCollect(c, out);
    }
    return out;
  }
  // testo "leggibile" di un elemento (senza icone, puntini decorativi…), <br> = a capo
  function veText(el) {
    let s = '';
    (function walk(node) {
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) s += c.nodeValue;
        else if (c.nodeType === 1) { if (c.tagName === 'BR') s += '\n'; else if (!veSkip(c)) walk(c); }
      }
    })(el);
    return s.split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  // scrive il testo mantenendo la struttura (icone, ultima parola in <em>, puntino del tema…)
  function veSetText(el, text) {
    const doc = el.ownerDocument;
    Array.prototype.slice.call(el.querySelectorAll('br')).forEach((b) => { if (!b.closest('svg')) b.remove(); });
    const nodes = veCollect(el, []);
    const lines = String(text).split('\n');
    if (lines.length === 1 && nodes.length === 2 && nodes[0].parentNode === el && nodes[1].parentNode.tagName === 'EM' && nodes[1].parentNode.parentNode === el) {
      const i = text.lastIndexOf(' ');
      if (i > 0) { nodes[0].nodeValue = text.slice(0, i) + ' '; nodes[1].nodeValue = text.slice(i + 1); } else { nodes[0].nodeValue = ''; nodes[1].nodeValue = text; }
      return;
    }
    let first = nodes[0];
    if (!first) { first = doc.createTextNode(''); el.insertBefore(first, el.firstChild); }
    for (let k = 1; k < nodes.length; k++) {
      let p = nodes[k].parentNode;
      nodes[k].remove();
      while (p && p !== el && /^(EM|B|STRONG|I|SPAN|SMALL|U|MARK|S)$/.test(p.tagName) && !p.children.length && !p.textContent) { const pp = p.parentNode; p.remove(); p = pp; }
    }
    first.nodeValue = lines[0];
    let after = first;
    for (let k = 1; k < lines.length; k++) {
      const br = doc.createElement('br');
      const tn = doc.createTextNode(lines[k]);
      after.parentNode.insertBefore(br, after.nextSibling);
      br.parentNode.insertBefore(tn, br.nextSibling);
      after = tn;
    }
  }

  // ---------------------------------------------------------------------------
  // Script iniettato nell'iframe
  // ---------------------------------------------------------------------------
  function editorMain(cfg) {
    /* global veText, veSetText */
    var d = document, w = window;
    var TEXT_TAGS = /^(H1|H2|H3|H4|H5|H6|P|LI|A|BUTTON|SPAN|SMALL|STRONG|B|EM|I|LABEL|FIGCAPTION|BLOCKQUOTE|TD|TH|DT|DD|SUMMARY|Q|CITE|TIME|DIV)$/;
    var INLINE = /^(SPAN|SMALL|STRONG|B|EM|I|Q|CITE|TIME|MARK|U)$/;
    var BLOCKY = 'div,p,ul,ol,section,article,header,footer,nav,img,picture,video,iframe,form,table,figure,h1,h2,h3,h4,h5,h6,blockquote,input,textarea,select';
    var keys = cfg.mode === 'keys';
    var post = function (m) { m.__ve = 1; parent.postMessage(m, '*'); };

    // ---- stile in pagina (contorni) + UI in shadow DOM ----
    var st = d.createElement('style');
    st.textContent = '[data-ve-hover]{outline:2px dashed ' + cfg.color + ' !important;outline-offset:3px !important;cursor:text !important}' +
      '[data-ve-hover=img]{outline-style:solid !important;cursor:pointer !important}' +
      '[data-ve-sec]{outline:2px solid ' + cfg.color + '55 !important;outline-offset:-2px !important}' +
      '[data-ve-edit]{outline:2px solid ' + cfg.color + ' !important;outline-offset:3px !important;cursor:text !important;-webkit-user-select:text !important;user-select:text !important;caret-color:' + cfg.color + '}' +
      '[data-ve-edit] *{pointer-events:none}html{scroll-behavior:auto !important}';
    d.head.appendChild(st);
    var host = d.createElement('ve-ui');
    host.style.cssText = 'position:absolute;top:0;left:0;width:0;height:0;z-index:2147483647;display:block';
    d.documentElement.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>' +
      ':host{all:initial}*{box-sizing:border-box;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}' +
      '.bar{position:absolute;display:none;gap:4px;padding:4px;background:#151822;border:1px solid #363d52;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);white-space:nowrap}' +
      '.bar.on{display:flex}.bar button{all:unset;cursor:pointer;color:#eceef4;font-size:12.5px;font-weight:600;padding:6px 9px;border-radius:7px;line-height:1}' +
      '.bar button:hover,.bar button:focus-visible{background:#272c3b}.bar button[disabled]{opacity:.35;cursor:default;background:none}' +
      '.bar .tag{color:#9ba2b5;font-size:11px;padding:6px 6px 6px 8px;font-weight:600;max-width:120px;overflow:hidden;text-overflow:ellipsis}' +
      '.pal{position:absolute;display:none;gap:6px;padding:8px;background:#151822;border:1px solid #363d52;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35)}' +
      '.pal.on{display:flex}.pal button{all:unset;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;color:#eceef4;font-size:11px;padding:2px}' +
      '.pal i{display:block;width:26px;height:26px;border-radius:50%;border:2px solid #363d52}.pal button:hover i{border-color:' + cfg.color + '}' +
      '.pop{position:absolute;display:none;flex-direction:column;gap:6px;padding:8px;background:#151822;border:1px solid #363d52;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.35);min-width:220px;max-width:min(320px,92vw)}' +
      '.pop.on{display:flex}.pop .row{display:flex;gap:6px}.pop label{color:#9ba2b5;font-size:11px;font-weight:600}' +
      '.pop input{all:unset;flex:1;min-width:0;background:#0d0f15;border:1px solid #363d52;border-radius:7px;color:#eceef4;font-size:13px;padding:7px 8px}' +
      '.pop input:focus{border-color:' + cfg.color + '}.pop button{all:unset;cursor:pointer;background:' + cfg.color + ';color:#fff;font-size:12.5px;font-weight:700;padding:7px 11px;border-radius:7px;text-align:center}' +
      '.pop button.ghost{background:#272c3b;color:#eceef4}.pop .hint{color:#9ba2b5;font-size:11px}' +
      '</style>' +
      '<div class="bar" id="sec"><span class="tag" id="sec-tag"></span><button id="up" title="Sposta su">↑ Su</button><button id="down" title="Sposta giù">↓ Giù</button><button id="hide" title="Nascondi sezione">👁 Nascondi</button><button id="bg" title="Cambia sfondo">🎨 Sfondo</button></div>' +
      '<div class="pal" id="pal"></div>' +
      '<div class="pop" id="img"><button id="img-go">🖼 Sostituisci immagine</button><button class="ghost" id="img-x">Annulla</button></div>' +
      '<div class="pop" id="lnk"><label for="lnk-in">Link del pulsante</label><div class="row"><input id="lnk-in" type="text" inputmode="url" spellcheck="false" placeholder="https://… oppure #contatti"><button id="lnk-ok">OK</button></div><span class="hint">Invio = fatto · Esc = annulla</span></div>';
    var $u = function (id) { return root.getElementById(id); };
    var secBar = $u('sec'), pal = $u('pal'), imgPop = $u('img'), lnkPop = $u('lnk'), lnkIn = $u('lnk-in');

    var hoverEl = null, secEl = null, editing = null, imgEl = null;
    var inUI = function (e) { return e.composedPath && e.composedPath().indexOf(host) !== -1; };
    var has = function (el, a) { return el && el.hasAttribute && el.hasAttribute(a); };
    function refOf(el) { return keys ? (has(el, 'data-e') ? { e: el.getAttribute('data-e') } : null) : (has(el, 'data-ve') ? { ve: +el.getAttribute('data-ve') } : null); }

    function directText(el) { for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3 && c.nodeValue.trim()) return true; return false; }
    function textTarget(t) {
      if (!t || t.nodeType !== 1 || t === d.body || t === d.documentElement) return null;
      if (t.closest('svg') && !t.closest('[data-e],a,button,h1,h2,h3,p,span')) return null;
      if (keys) {
        var k = t.closest('[data-e]');
        if (!k) return null;
        var key = k.getAttribute('data-e');
        if (/^img\./.test(key) || key === 'nav.logo') return null;
        return k;
      }
      var el = t, n = 0;
      while (el && el !== d.body && n < 6) {
        if (TEXT_TAGS.test(el.tagName) && directText(el) && !(el.tagName === 'DIV' && el.querySelector(BLOCKY))) break;
        el = el.parentElement; n++;
      }
      if (!el || el === d.body || n >= 6 || !has(el, 'data-ve')) return null;
      while (INLINE.test(el.tagName) && el.parentElement && TEXT_TAGS.test(el.parentElement.tagName) && el.parentElement !== d.body && has(el.parentElement, 'data-ve') && !el.parentElement.querySelector(BLOCKY)) el = el.parentElement;
      if (el.querySelector(BLOCKY) || el.closest('form') && /^(LABEL|SPAN)$/.test(el.tagName) && el.querySelector('input,textarea')) return null;
      return el;
    }
    function isImg(el) {
      if (keys) return el.closest('[data-e^="img."],[data-e="nav.logo"]');
      if (!has(el, 'data-ve')) return null;
      if (el.tagName === 'IMG') return el;
      var bg = getComputedStyle(el).backgroundImage;
      return bg && bg.indexOf('url(') !== -1 ? el : null;
    }
    function imgTarget(x, y) {
      var stack = d.elementsFromPoint(x, y);
      for (var i = 0; i < stack.length && i < 10; i++) {
        var el = stack[i];
        if (el === host || el === d.body || el === d.documentElement) continue;
        var r = isImg(el);
        if (r) return keys ? (has(r, 'data-e') ? r : null) : r;
      }
      return null;
    }
    function sectionOf(t) {
      if (!t || t.nodeType !== 1) return null;
      if (keys) return t.closest('section[id], header#top, footer');
      var s = t.closest('section, header, footer');
      while (s && s.parentElement && s.parentElement.closest('section, header, footer')) s = s.parentElement.closest('section, header, footer');
      return s && has(s, 'data-ve') ? s : null;
    }
    function sid(s) { return keys ? (s.tagName === 'FOOTER' ? 'footer' : s.id) : null; }
    function setHover(el, kind) {
      if (hoverEl === el) return;
      if (hoverEl) hoverEl.removeAttribute('data-ve-hover');
      hoverEl = el;
      if (el) el.setAttribute('data-ve-hover', kind || 'text');
    }
    function placeBar(s) {
      if (secEl && secEl !== s) secEl.removeAttribute('data-ve-sec');
      secEl = s;
      if (!s) { secBar.classList.remove('on'); pal.classList.remove('on'); return; }
      s.setAttribute('data-ve-sec', '');
      var r = s.getBoundingClientRect();
      var id = sid(s);
      var label = s.tagName === 'HEADER' ? 'Copertina' : s.tagName === 'FOOTER' ? 'Piè di pagina' : (cfg.labels[id] || (s.querySelector('h2') ? (s.querySelector('h2').textContent || '').trim() : 'Sezione'));
      $u('sec-tag').textContent = label;
      var fixed = keys && (s.tagName !== 'SECTION');
      var sibs = keys ? Array.prototype.slice.call(d.querySelectorAll('section[id]')) : null;
      $u('up').disabled = fixed || (keys ? sibs.indexOf(s) <= 0 : !prevSib(s));
      $u('down').disabled = fixed || (keys ? sibs.indexOf(s) === sibs.length - 1 : !nextSib(s));
      $u('bg').disabled = keys && s.tagName !== 'SECTION';
      secBar.classList.add('on');
      var bw = secBar.offsetWidth;
      var top = Math.max(r.top, 8) + w.scrollY + 8;
      if (r.top < 0 && r.bottom < 60) top = r.bottom + w.scrollY - 40;
      secBar.style.top = top + 'px';
      secBar.style.left = Math.max(8, Math.min(r.right - bw - 10, d.documentElement.clientWidth - bw - 8)) + w.scrollX + 'px';
    }
    function sibOk(n) { return n && !/^(SCRIPT|STYLE|TEMPLATE|LINK|META|VE-UI)$/.test(n.tagName); }
    function prevSib(s) { var p = s.previousElementSibling; while (p && !sibOk(p)) p = p.previousElementSibling; return p; }
    function nextSib(s) { var p = s.nextElementSibling; while (p && !sibOk(p)) p = p.nextElementSibling; return p; }

    function closePops() { imgPop.classList.remove('on'); pal.classList.remove('on'); lnkPop.classList.remove('on'); imgEl = null; }
    function popAt(pop, x, y) {
      pop.classList.add('on');
      var pw = pop.offsetWidth, ph = pop.offsetHeight, vw = d.documentElement.clientWidth, vh = w.innerHeight;
      pop.style.left = Math.max(8, Math.min(x, vw - pw - 8)) + w.scrollX + 'px';
      pop.style.top = Math.max(8, Math.min(y, vh - ph - 8)) + w.scrollY + 'px';
    }

    // ---- modifica testo ----
    var orig = '', origText = '', origWs = '', isLink = false, origHref = '';
    function startEdit(el, x, y) {
      closePops();
      editing = el;
      orig = el.innerHTML; origText = veText(el); origWs = el.style.whiteSpace;
      el.textContent = origText;
      if (MULTI_RE.test(el.tagName)) el.style.whiteSpace = 'pre-wrap';
      el.setAttribute('data-ve-edit', '');
      el.contentEditable = 'plaintext-only';
      if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
      el.setAttribute('spellcheck', 'true');
      setHover(null);
      el.focus({ preventScroll: true });
      var sel = w.getSelection(), rg = null;
      try { if (d.caretRangeFromPoint) rg = d.caretRangeFromPoint(x, y); } catch (e) { rg = null; }
      if (!rg || !el.contains(rg.startContainer)) { rg = d.createRange(); rg.selectNodeContents(el); rg.collapse(false); }
      sel.removeAllRanges(); sel.addRange(rg);
      isLink = el.tagName === 'A' && !el.closest('nav, .menu, .h-idx') && (/\bbtn\b|\blnk\b|button|cta/i.test(el.className + ' ' + (el.getAttribute('data-e') || '')));
      if (isLink) {
        origHref = el.getAttribute('href') || '';
        lnkIn.value = origHref;
        var r = el.getBoundingClientRect();
        popAt(lnkPop, r.left, r.bottom + 10);
      }
    }
    var MULTI_RE = new RegExp(cfg.multi);
    function finishEdit(cancel) {
      var el = editing;
      if (!el) return;
      editing = null;
      var raw = el.innerText != null ? el.innerText : el.textContent;
      el.removeAttribute('contenteditable'); el.removeAttribute('data-ve-edit'); el.removeAttribute('spellcheck');
      el.style.whiteSpace = origWs;
      if (!el.getAttribute('style')) el.removeAttribute('style');
      var multi = MULTI_RE.test(el.tagName);
      var text = String(raw || '').replace(/ /g, ' ');
      text = multi ? text.split('\n').map(function (l) { return l.replace(/\s+/g, ' ').trim(); }).join('\n').replace(/\n{3,}/g, '\n\n').trim() : text.replace(/\s+/g, ' ').trim();
      el.innerHTML = orig;
      var href = isLink ? lnkIn.value.trim() : null;
      lnkPop.classList.remove('on');
      if (d.activeElement && d.activeElement.blur) d.activeElement.blur();
      if (cancel) return;
      var ref = refOf(el);
      if (!ref) return;
      if (text && text !== origText) {
        veSetText(el, text);
        post({ t: 'text', ref: ref, text: text });
      } else if (!text && origText) post({ t: 'toast', msg: 'Il testo non può essere vuoto: ho rimesso quello di prima.' });
      if (isLink && href !== origHref && href) {
        if (/^(https?:\/\/|mailto:|tel:|#)[^\s<>"']*$/i.test(href) || /^[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(href)) {
          if (!/^(https?:|mailto:|tel:|#)/i.test(href)) href = 'https://' + href;
          el.setAttribute('href', href);
          post({ t: 'href', ref: ref, href: href });
        } else post({ t: 'toast', msg: 'Link non valido: usa un indirizzo che inizia con https://, mailto:, tel: oppure #sezione.' });
      }
    }

    // ---- eventi ----
    var raf = 0, lastMove = null;
    d.addEventListener('mousemove', function (e) {
      lastMove = e;
      if (raf) return;
      raf = requestAnimationFrame(function () {
        raf = 0;
        var ev = lastMove;
        if (editing || inUI(ev)) return;
        var t = textTarget(ev.target);
        if (t) setHover(t, 'text');
        else { var im = imgTarget(ev.clientX, ev.clientY); setHover(im, im ? 'img' : null); }
        var s = sectionOf(ev.target);
        if (s && s !== secEl && !pal.classList.contains('on')) placeBar(s);
      });
    }, { passive: true });
    d.addEventListener('mouseleave', function () { setHover(null); });

    function swallow(e) { if (!inUI(e)) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } }
    w.addEventListener('submit', swallow, true);
    w.addEventListener('auxclick', swallow, true);
    w.addEventListener('dblclick', function (e) { if (!editing) swallow(e); }, true);
    w.addEventListener('pointerdown', function (e) {
      if (inUI(e)) return;
      if (editing && editing.contains(e.target)) return;
      if (editing) finishEdit(false);
    }, true);
    w.addEventListener('click', function (e) {
      if (inUI(e)) return;
      if (editing && editing.contains(e.target)) { e.preventDefault(); e.stopPropagation(); return; }
      swallow(e);
      closePops();
      var s = sectionOf(e.target);
      if (s) placeBar(s);
      var t = textTarget(e.target);
      if (t) { startEdit(t, e.clientX, e.clientY); return; }
      var im = imgTarget(e.clientX, e.clientY);
      if (im) { imgEl = im; setHover(im, 'img'); popAt(imgPop, e.clientX + 6, e.clientY + 6); }
    }, true);
    d.addEventListener('keydown', function (e) {
      if (editing) {
        if (e.key === 'Escape') { e.preventDefault(); finishEdit(true); }
        else if (e.key === 'Enter' && (!MULTI_RE.test(editing.tagName) || e.ctrlKey || e.metaKey)) { e.preventDefault(); finishEdit(false); }
        return;
      }
      if (e.key === 'Escape') closePops();
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); post({ t: 'undo' }); }
    }, true);
    d.addEventListener('paste', function (e) {
      if (!editing || inUI(e)) return;
      e.preventDefault();
      var txt = (e.clipboardData && e.clipboardData.getData('text/plain')) || '';
      if (!MULTI_RE.test(editing.tagName)) txt = txt.replace(/\s+/g, ' ');
      d.execCommand('insertText', false, txt);
    }, true);
    d.addEventListener('drop', function (e) { if (!inUI(e)) e.preventDefault(); }, true);
    w.addEventListener('scroll', function () { if (secEl && !editing) placeBar(secEl); }, { passive: true });
    w.addEventListener('resize', function () { if (secEl) placeBar(secEl); });

    lnkIn.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); finishEdit(false); }
      if (e.key === 'Escape') { e.preventDefault(); finishEdit(true); }
    });
    $u('lnk-ok').addEventListener('click', function () { finishEdit(false); });
    $u('img-x').addEventListener('click', closePops);
    $u('img-go').addEventListener('click', function () {
      var r = imgEl && (keys ? refOf(imgEl) : refOf(imgEl));
      closePops();
      if (r) post({ t: 'pickImage', ref: r });
    });
    function secOp(op, value) {
      if (!secEl) return;
      var ref = keys ? { sid: sid(secEl) } : refOf(secEl);
      if (ref) post({ t: 'section', op: op, ref: ref, value: value });
    }
    $u('up').addEventListener('click', function () { secOp('up'); });
    $u('down').addEventListener('click', function () { secOp('down'); });
    $u('hide').addEventListener('click', function () { secOp('hide'); });
    $u('bg').addEventListener('click', function () {
      if (pal.classList.contains('on')) { pal.classList.remove('on'); return; }
      var cs = getComputedStyle(d.documentElement);
      pal.innerHTML = '';
      cfg.bg.forEach(function (o) {
        var b = d.createElement('button');
        b.type = 'button';
        var i = d.createElement('i');
        var col = o.v ? (cs.getPropertyValue(o.v).trim() || o.c) : o.c;
        i.style.background = col || 'repeating-linear-gradient(45deg,#ccc 0 4px,#fff 4px 8px)';
        b.appendChild(i);
        b.appendChild(d.createTextNode(o.label));
        b.addEventListener('click', function () { pal.classList.remove('on'); secOp('bg', o.id); });
        pal.appendChild(b);
      });
      var r = secBar.getBoundingClientRect();
      popAt(pal, r.left, r.bottom + 6);
    });
    post({ t: 'ready' });
  }

  // ---------------------------------------------------------------------------
  // Stato
  // ---------------------------------------------------------------------------
  const st = () => (IS.getState ? IS.getState() : null);
  const cur = () => (IS.getCurrent ? IS.getCurrent() : null);
  const isAiSite = (c) => !!(c && IS.isAI && IS.isAI(c.engine) && !/data-e="/.test(c.raw || ''));
  let images = {}; // chiave -> dataURL (overrides.images)
  let editOn = false;
  const undo = [];
  let baseline = null;

  function ov() {
    const s = st();
    if (!s) return { text: {}, links: {}, hiddenSections: [], sectionBg: {} };
    const o = s.overrides && typeof s.overrides === 'object' ? s.overrides : (s.overrides = {});
    if (!o.text || typeof o.text !== 'object') o.text = {};
    if (!o.links || typeof o.links !== 'object') o.links = {};
    if (!Array.isArray(o.hiddenSections)) o.hiddenSections = [];
    if (!o.sectionBg || typeof o.sectionBg !== 'object') o.sectionBg = {};
    return o;
  }
  function loadImgs() {
    try {
      const v = JSON.parse(localStorage.getItem(IMG_KEY) || 'null');
      const s = st();
      if (v && s && s.overrides && v.token && v.token === s.overrides.imgToken && v.images && typeof v.images === 'object') {
        images = {};
        Object.keys(v.images).forEach((k) => { if (/^data:image\//.test(v.images[k])) images[k] = v.images[k]; });
      }
    } catch { images = {}; }
  }
  function saveImgs() {
    const o = ov();
    if (!o.imgToken) o.imgToken = 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    try { localStorage.setItem(IMG_KEY, JSON.stringify({ token: o.imgToken, images })); }
    catch { if (IS.toast) IS.toast('Foto troppo pesanti da ricordare dopo un ricarico: scarica il sito per non perderle.'); }
  }
  function hasOverrides() {
    const s = st();
    const o = s && s.overrides;
    const imgs = Object.keys(images).length && s && s.overrides && s.overrides.imgToken;
    return !!(imgs || (o && ((o.text && Object.keys(o.text).length) || (o.links && Object.keys(o.links).length) || (o.hiddenSections && o.hiddenSections.length) || (o.sectionBg && Object.keys(o.sectionBg).length))));
  }
  IS.getOverrides = () => ({ ...ov(), images: { ...images } });

  // ---------------------------------------------------------------------------
  // HTML helpers (DOMParser)
  // ---------------------------------------------------------------------------
  const parse = (html) => new DOMParser().parseFromString(html, 'text/html');
  function serialize(doc, src) {
    const m = /^\s*(<!doctype[^>]*>)/i.exec(src || '');
    return (m ? m[1] : '<!doctype html>') + '\n' + doc.documentElement.outerHTML;
  }
  const byKey = (doc, k) => Array.from(doc.querySelectorAll('[data-e="' + CSS.escape(k) + '"]'));
  const veList = (doc) => (doc.body ? Array.from(doc.body.querySelectorAll('*')) : []);
  function sectionById(doc, id) {
    if (id === 'footer') return doc.querySelector('footer');
    if (id === 'top') return doc.querySelector('header#top') || doc.getElementById('top');
    return doc.getElementById(id);
  }
  function setImage(el, src) {
    if (el.tagName === 'IMG') { el.setAttribute('src', src); el.removeAttribute('srcset'); return; }
    if (el.tagName === 'svg' || el.tagName === 'SVG') return;
    el.style.backgroundImage = 'url("' + src.replace(/["\\\n\r]/g, '') + '")';
    el.style.backgroundSize = 'cover';
    el.style.backgroundPosition = 'center';
    if (!el.classList.contains('img')) { el.textContent = ''; el.setAttribute('role', 'img'); }
  }
  const BG_KEYS = [
    { id: 'base', label: 'Chiaro', v: '--bg' }, { id: 'alt', label: 'Tenue', v: '--bg2' },
    { id: 'accent', label: 'Colore', v: '--accent-soft' }, { id: 'inv', label: 'Scuro', v: '--inv' }, { id: '', label: 'Originale', c: '' },
  ];
  const BG_AI = {
    white: { label: 'Bianco', bg: '#ffffff', fg: '#16181d' }, cream: { label: 'Crema', bg: '#f7f2e9', fg: '#1d1a16' },
    mist: { label: 'Grigio', bg: '#eef1f6', fg: '#161a22' }, night: { label: 'Scuro', bg: '#14161c', fg: '#f2f3f6' },
  };
  function setTone(el, tone) {
    el.classList.remove('t-base', 't-alt', 't-inv');
    el.style.removeProperty('--bg');
    el.classList.add('t-' + (tone === 'accent' ? 'base' : tone));
    if (tone === 'accent') el.style.setProperty('--bg', 'var(--accent-soft)');
    if (!el.getAttribute('style')) el.removeAttribute('style');
  }

  // Applica le modifiche salvate all'HTML di un sito con chiavi data-e (dopo ogni generazione)
  function applyOverrides(raw) {
    if (!raw || !/data-e="/.test(raw) || !hasOverrides()) return raw;
    try {
      const doc = parse(raw);
      const o = ov();
      Object.keys(o.text).forEach((k) => {
        const e = o.text[k];
        const v = e && typeof e === 'object' ? e.v : e;
        if (typeof v !== 'string') return;
        const list = byKey(doc, k);
        if (!list.length) return;
        // se la scheda ha cambiato il testo di partenza, vince la scheda
        if (e && typeof e === 'object' && typeof e.o === 'string' && veText(list[0]) !== e.o) return;
        list.forEach((el) => veSetText(el, v));
      });
      Object.keys(o.links).forEach((k) => byKey(doc, k).forEach((el) => {
        const h = o.links[k];
        if (el.tagName !== 'A' || typeof h !== 'string') return;
        el.setAttribute('href', h);
        if (/^https?:/i.test(h)) { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener'); } else { el.removeAttribute('target'); el.removeAttribute('rel'); }
      }));
      if (o.imgToken) Object.keys(images).forEach((k) => byKey(doc, k).forEach((el) => setImage(el, images[k])));
      o.hiddenSections.forEach((id) => { const el = sectionById(doc, id); if (el) el.remove(); });
      Object.keys(o.sectionBg).forEach((id) => { const el = sectionById(doc, id); if (el && el.tagName === 'SECTION' && o.sectionBg[id]) setTone(el, o.sectionBg[id]); });
      return serialize(doc, raw);
    } catch (err) {
      console.warn('editor visivo: modifiche non applicate', err);
      return raw;
    }
  }

  // ---------------------------------------------------------------------------
  // Iniezione nel srcdoc
  // ---------------------------------------------------------------------------
  function sectionLabels() {
    const out = {};
    (Array.isArray(window.OFFLINE_SECTIONS) ? window.OFFLINE_SECTIONS : []).forEach((s) => { if (s && s.id) out[s.id] = s.label; });
    return out;
  }
  function decorate(html) {
    if (!editOn || typeof html !== 'string') return html;
    const keys = /data-e="/.test(html);
    let out = html;
    if (!keys) {
      try {
        const doc = parse(html);
        veList(doc).forEach((el, i) => el.setAttribute('data-ve', String(i)));
        out = serialize(doc, html);
      } catch { return html; }
    }
    const cfg = {
      mode: keys ? 'keys' : 've', color: '#7c5cff', multi: MULTI.source, labels: sectionLabels(),
      bg: keys ? BG_KEYS : Object.keys(BG_AI).map((id) => ({ id, label: BG_AI[id].label, c: BG_AI[id].bg })).concat([{ id: '', label: 'Originale', c: '' }]),
    };
    const js = '<script>(function(){' + [veSkip, veCollect, veText, veSetText].map(String).join('\n') +
      '\n(' + String(editorMain) + ')(' + JSON.stringify(cfg).replace(/</g, '\\u003c') + ');})();<\/script>';
    const i = out.toLowerCase().lastIndexOf('</body>');
    return i === -1 ? out + js : out.slice(0, i) + js + out.slice(i);
  }

  // ---------------------------------------------------------------------------
  // Operazioni (dal messaggio dell'iframe)
  // ---------------------------------------------------------------------------
  function snapshot() {
    const s = st(), c = cur();
    return {
      id: c && c.id, ai: isAiSite(c), raw: c && c.raw,
      ov: JSON.parse(JSON.stringify(ov())), images: { ...images },
      sections: s ? (s.sections || []).slice() : [], sectionsCustom: s ? !!s.sectionsCustom : false,
      briefSections: c && c.brief && Array.isArray(c.brief.sections) ? c.brief.sections.slice() : null,
    };
  }
  function pushUndo() {
    const c = cur();
    if (!baseline || baseline.id !== (c && c.id)) baseline = snapshot();
    undo.push(snapshot());
    if (undo.length > MAX_UNDO) undo.shift();
    renderBar();
  }
  function restore(snap) {
    const s = st(), c = cur();
    if (!s || !c) return;
    s.overrides = JSON.parse(JSON.stringify(snap.ov));
    images = { ...snap.images };
    saveImgs();
    if (snap.ai || isAiSite(c)) {
      if (snap.id === c.id && typeof snap.raw === 'string') IS.setRaw(snap.raw);
      else IS.showCurrent({ keepScroll: true });
    } else {
      const changed = JSON.stringify(s.sections) !== JSON.stringify(snap.sections);
      if (sameBrief()) { s.sections = snap.sections.slice(); s.sectionsCustom = snap.sectionsCustom; }
      if (IS.save) IS.save();
      if (changed && IS.render) IS.render();
      if (snap.briefSections && IS.regenerate && JSON.stringify(snap.briefSections) !== JSON.stringify(c.brief.sections)) IS.regenerate({ sections: snap.briefSections });
      else IS.showCurrent({ keepScroll: true });
    }
    renderBar();
  }
  function doUndo() {
    const snap = undo.pop();
    if (!snap) { if (IS.toast) IS.toast('Niente da annullare.'); return; }
    restore(snap);
    if (IS.setStatus) IS.setStatus('Modifica annullata ↩', 'ok');
  }
  function doReset() {
    const c = cur();
    if (!c) return;
    if (!hasOverrides() && !undo.length) { if (IS.toast) IS.toast('Il sito è già quello originale.'); return; }
    if (!confirm('Vuoi togliere tutte le modifiche fatte cliccando sull\'anteprima?')) return;
    const snap = snapshot();
    undo.push(snap);
    const base = baseline && baseline.id === c.id ? baseline : null;
    const clean = { ...snap, ov: { text: {}, links: {}, hiddenSections: [], sectionBg: {} }, images: {} };
    if (base) { clean.raw = base.raw; clean.sections = base.sections; clean.sectionsCustom = base.sectionsCustom; clean.briefSections = base.briefSections; }
    restore(clean);
    if (IS.setStatus) IS.setStatus('Sito riportato all\'originale ✓ (puoi ancora annullare)', 'ok');
  }

  // la scheda attuale descrive il sito in anteprima?
  function sameBrief() {
    const c = cur();
    if (!c || !c.brief || !IS.buildBrief) return false;
    try { const b = IS.buildBrief(); return b.name === c.brief.name && b.category === c.brief.category; } catch { return false; }
  }
  const sectionIds = (raw) => Array.from(String(raw || '').matchAll(/<section id="([^"]+)"/g)).map((m) => m[1]);

  function origTextFor(key) {
    const c = cur();
    try { const el = byKey(parse(c.raw), key)[0]; return el ? veText(el) : undefined; } catch { return undefined; }
  }

  // modifica diretta dell'HTML di un sito AI (nessuna chiave)
  function editAiRaw(fn, { silent = false } = {}) {
    const c = cur();
    const doc = parse(c.raw);
    const list = veList(doc);
    const n = list.length;
    if (fn(list, doc) === false) return;
    const raw = serialize(doc, c.raw);
    IS.setRaw(raw, { silent: silent && veList(doc).length === n });
  }

  function onText(ref, text) {
    const c = cur();
    pushUndo();
    if (ref.e != null && !isAiSite(c)) {
      const o = ov();
      const prev = o.text[ref.e];
      const orig = prev && typeof prev === 'object' && typeof prev.o === 'string' ? prev.o : origTextFor(ref.e);
      if (orig === text) delete o.text[ref.e]; else o.text[ref.e] = { v: text, o: orig };
      if (IS.save) IS.save();
      IS.showCurrent({ keepScroll: true, silent: true });
    } else if (ref.ve != null) {
      editAiRaw((list) => { const el = list[ref.ve]; if (!el) return false; veSetText(el, text); }, { silent: true });
    }
    renderBar();
  }
  function onHref(ref, href) {
    const c = cur();
    if (!/^(https?:\/\/|mailto:|tel:|#)/i.test(href) || /^\s*javascript:/i.test(href)) return;
    if (ref.e != null && !isAiSite(c)) {
      ov().links[ref.e] = href;
      if (IS.save) IS.save();
      IS.showCurrent({ keepScroll: true, silent: true });
    } else if (ref.ve != null) {
      editAiRaw((list) => { const el = list[ref.ve]; if (!el || el.tagName !== 'A') return false; el.setAttribute('href', href); }, { silent: true });
    }
  }

  const picker = document.createElement('input');
  picker.type = 'file';
  picker.accept = 'image/*';
  picker.hidden = true;
  let pickRef = null;
  picker.addEventListener('change', async () => {
    const file = picker.files && picker.files[0];
    const ref = pickRef;
    picker.value = '';
    if (!file || !ref) return;
    try {
      const isLogo = ref.e === 'nav.logo';
      let src;
      if (IS.compressImage) ({ src } = await IS.compressImage(file, isLogo ? { max: 512, mime: 'image/png', quality: 0.9 } : { max: 1600, mime: 'image/jpeg', quality: 0.82, background: '#ffffff' }));
      else throw new Error('Compressione non disponibile.');
      const c = cur();
      pushUndo();
      if (ref.e != null && !isAiSite(c)) {
        images[ref.e] = src;
        saveImgs();
        if (IS.save) IS.save();
        IS.showCurrent({ keepScroll: true });
      } else if (ref.ve != null) {
        editAiRaw((list) => { const el = list[ref.ve]; if (!el) return false; setImage(el, src); });
      }
      if (IS.toast) IS.toast('Immagine sostituita ✓', 'ok');
    } catch (err) {
      if (IS.toast) IS.toast((err && err.message) || 'Immagine non valida.', 'error');
    }
  });

  function onSection(ref, op, value) {
    const c = cur();
    const s = st();
    if (!c) return;
    if (ref.ve != null || isAiSite(c)) {
      pushUndo();
      editAiRaw((list, doc) => {
        const el = list[ref.ve];
        if (!el) return false;
        const ok = (n) => n && !/^(SCRIPT|STYLE|TEMPLATE|LINK|META)$/.test(n.tagName);
        if (op === 'hide') el.remove();
        else if (op === 'up') { let p = el.previousElementSibling; while (p && !ok(p)) p = p.previousElementSibling; if (!p) return false; p.before(el); }
        else if (op === 'down') { let p = el.nextElementSibling; while (p && !ok(p)) p = p.nextElementSibling; if (!p) return false; p.after(el); }
        else if (op === 'bg') {
          const b = BG_AI[value];
          el.style.removeProperty('background'); el.style.removeProperty('color');
          if (b) { el.style.setProperty('background', b.bg); el.style.setProperty('color', b.fg); }
          if (!el.getAttribute('style')) el.removeAttribute('style');
        }
        return undefined;
      });
      return;
    }
    const id = ref.sid;
    if (!id) return;
    const o = ov();
    if (op === 'bg') {
      pushUndo();
      if (value) o.sectionBg[id] = value; else delete o.sectionBg[id];
      if (IS.save) IS.save();
      IS.showCurrent({ keepScroll: true });
      return;
    }
    if (id === 'top' || id === 'footer') {
      if (op !== 'hide') return;
      pushUndo();
      if (!o.hiddenSections.includes(id)) o.hiddenSections.push(id);
      if (IS.save) IS.save();
      IS.showCurrent({ keepScroll: true });
      toastHidden(id);
      return;
    }
    const order = sectionIds(c.raw);
    const i = order.indexOf(id);
    if (i === -1) return;
    pushUndo();
    if (op === 'hide') order.splice(i, 1);
    else if (op === 'up' && i > 0) [order[i - 1], order[i]] = [order[i], order[i - 1]];
    else if (op === 'down' && i < order.length - 1) [order[i + 1], order[i]] = [order[i], order[i + 1]];
    else { undo.pop(); return; }
    if (s && sameBrief()) {
      s.sections = order.slice();
      s.sectionsCustom = true;
      if (IS.save) IS.save();
      if (IS.render) IS.render();
    }
    if (!IS.regenerate || !IS.regenerate({ sections: order })) IS.showCurrent({ keepScroll: true });
    if (op === 'hide') toastHidden(id);
  }
  function toastHidden(id) {
    const lab = id === 'top' ? 'Copertina' : id === 'footer' ? 'Piè di pagina' : (sectionLabels()[id] || id);
    if (IS.toast) IS.toast(`Sezione «${lab}» nascosta. Usa «↩ Annulla» per riaverla${id === 'top' || id === 'footer' ? '' : ' o riattivala nella scheda (passo Sezioni)'}.`);
  }

  window.addEventListener('message', (e) => {
    const frame = $('preview');
    if (!frame || e.source !== frame.contentWindow) return;
    const m = e.data;
    if (!m || m.__ve !== 1 || typeof m.t !== 'string' || !editOn) return;
    const ref = m.ref && typeof m.ref === 'object' ? {
      e: typeof m.ref.e === 'string' && m.ref.e.length < 120 ? m.ref.e : undefined,
      ve: Number.isInteger(m.ref.ve) && m.ref.ve >= 0 ? m.ref.ve : undefined,
      sid: typeof m.ref.sid === 'string' && /^[\w-]{1,40}$/.test(m.ref.sid) ? m.ref.sid : undefined,
    } : null;
    try {
      if (m.t === 'text' && ref && typeof m.text === 'string' && m.text.length < 5000) onText(ref, m.text);
      else if (m.t === 'href' && ref && typeof m.href === 'string' && m.href.length < 2000) onHref(ref, m.href);
      else if (m.t === 'pickImage' && ref) { pickRef = ref; picker.click(); }
      else if (m.t === 'section' && ref && ['up', 'down', 'hide', 'bg'].includes(m.op)) onSection(ref, m.op, typeof m.value === 'string' ? m.value : '');
      else if (m.t === 'undo') doUndo();
      else if (m.t === 'toast' && typeof m.msg === 'string' && IS.toast) IS.toast(m.msg.slice(0, 200));
    } catch (err) {
      console.error('editor visivo', err);
      if (IS.toast) IS.toast('Non sono riuscito ad applicare la modifica.', 'error');
    }
  });

  // ---------------------------------------------------------------------------
  // UI nella pagina
  // ---------------------------------------------------------------------------
  let toggle, bar;
  function renderBar() {
    if (!toggle) return;
    const has = !!(IS.getHtml && IS.getHtml());
    toggle.disabled = !has;
    toggle.classList.toggle('on', editOn);
    toggle.setAttribute('aria-pressed', String(editOn));
    toggle.textContent = editOn ? '✓ Fine' : '✏️ Modifica';
    bar.hidden = !editOn;
    $('ve-undo').disabled = !undo.length;
  }
  function setEdit(on) {
    if (on && !(IS.getHtml && IS.getHtml())) return;
    editOn = on;
    if (on) {
      const tab = document.querySelector('.tab[data-view="preview"]');
      if (tab && !tab.classList.contains('active')) tab.click();
    }
    renderBar();
    if (IS.showCurrent) IS.showCurrent({ keepScroll: true });
  }
  function mount() {
    const actions = document.querySelector('.preview-toolbar .actions');
    const stage = document.querySelector('.preview-panel .stage');
    if (!actions || !stage) return;
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.id = 've-toggle';
    toggle.className = 'btn small ve-toggle';
    toggle.title = 'Modifica testi, foto e sezioni cliccando sull\'anteprima';
    toggle.addEventListener('click', () => setEdit(!editOn));
    actions.prepend(toggle);
    bar = document.createElement('div');
    bar.className = 've-bar';
    bar.id = 've-bar';
    bar.hidden = true;
    bar.innerHTML = '<p class="ve-hint"><span class="ve-dot" aria-hidden="true"></span>Clicca su un testo per cambiarlo · clicca su una foto per sostituirla</p>' +
      '<div class="ve-actions"><button type="button" class="btn small" id="ve-undo">↩ Annulla</button><button type="button" class="btn small ghost" id="ve-reset">Ripristina originale</button></div>';
    stage.before(bar);
    $('ve-undo').addEventListener('click', doUndo);
    $('ve-reset').addEventListener('click', doReset);
    document.body.append(picker);
    const dl = $('download');
    if (dl) new MutationObserver(() => { if (!IS.getHtml || !IS.getHtml()) editOn = false; renderBar(); }).observe(dl, { attributes: true, attributeFilter: ['disabled'] });
    document.addEventListener('keydown', (e) => {
      if (!editOn || !(e.ctrlKey || e.metaKey) || e.shiftKey || e.key.toLowerCase() !== 'z') return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      e.preventDefault();
      doUndo();
    });
    renderBar();
  }

  IS.transformRaw = (raw) => applyOverrides(raw);
  IS.decorateSrcdoc = decorate;
  IS.visualEditor = { setEdit, isOn: () => editOn, undo: doUndo, reset: doReset, applyOverrides, veSetText, veText };

  loadImgs();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount); else mount();
})();
