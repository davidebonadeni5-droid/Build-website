# ✦ IdeaSito

Descrivi la tua idea → l'AI crea il tuo sito web. **Gratis.**

## Come funziona

- **Modalità Guidata** (consigliata): 5 passi per spiegare bene la tua idea — Idea, Contenuti (sezioni e voci con prezzi), Immagini (logo e foto), Stile, Contatti.
- **Modalità Veloce**: scrivi l'idea in una frase; il pulsante "Compila la scheda" riempie la modalità guidata in automatico.
- **Logo e foto**: trascinali o caricali; vengono compressi nel browser e inseriti nel sito (navbar, copertina, chi siamo, galleria con lightbox).
- **7 stili** offline: Elegante, Audace, Magazine, Aurora, Minimal, Calore, Giocoso.
- Anteprima desktop / tablet / telefono, modifiche a parole (con l'AI), **Scarica** il file `.html`.

## Perché è gratis

- **Motore AI** → usa [Puter.js](https://developer.puter.com/), che offre modelli come Claude e GPT dal browser senza chiavi API: non paghi niente tu che pubblichi il sito. Al primo utilizzo l'utente potrebbe dover creare un account Puter gratuito.
- **Motore Offline** → genera il sito da template in base alle parole chiave. Niente AI, niente rete, funziona sempre.
- **Hosting** → è un sito statico (HTML/CSS/JS), si pubblica gratis su GitHub Pages.

## Avviarlo in locale

```bash
python3 -m http.server 8000
```

Poi apri http://localhost:8000

## Pubblicarlo gratis su GitHub Pages

Repository → **Settings → Pages** → Source: *Deploy from a branch* → branch `main`, cartella `/ (root)` → Save.
Dopo un minuto il sito è online su `https://<tuo-utente>.github.io/Build-website/`.

## File

- `index.html` – interfaccia
- `style.css` – stile
- `app.js` – generazione AI, modifiche, anteprima, download, cronologia
- `offline/data.js` – temi, categorie e sezioni
- `offline/engine.js` – generatore offline dei siti
