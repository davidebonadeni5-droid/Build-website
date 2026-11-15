# ✦ IdeaSito

Descrivi la tua idea → l'AI crea il tuo sito web. **Gratis.**

## Come funziona

1. Scrivi cosa vuoi (es. "sito per la mia pizzeria a Napoli con menù e prenotazioni WhatsApp").
2. Scegli uno stile (opzionale) e premi **Crea il mio sito**.
3. Guarda l'anteprima (desktop / tablet / telefono), chiedi modifiche a parole, poi **Scarica** il file `.html`.

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
- `templates.js` – generatore offline basato su template
