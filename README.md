# 🎮 Browser Games

Kleine Browser-Games – komplett clientseitig, spielbar über GitHub Pages.

## Spielen

Die Übersicht aller Spiele liegt auf der [GitHub-Pages-Seite](https://rawe.github.io/browser-games/) (Startpunkt: `index.html`).

## Entwicklung

```bash
npm install
npm run dev      # Dev-Server mit Hot Reload
npm run build    # optimierter Build nach dist/
npm run preview  # gebauten Stand lokal testen
```

## Struktur

```
index.html          Übersicht aller Spiele
games.js            Manifest der Spiele (speist die Übersicht)
shared/             Gemeinsame Styles/Helfer
games/<name>/       Ein Verzeichnis pro Spiel
  index.html        Einstiegspunkt des Spiels
  main.js, ...      ES-Module (Logik, Rendering, Input getrennt)
```

## Neues Spiel anlegen

1. Verzeichnis `games/<name>/` mit eigener `index.html` erstellen (Vorlage: `games/snake/`).
2. Eintrag in `games.js` ergänzen.
3. Fertig – der Build erkennt neue Spiele automatisch.

## Deployment

Jeder Push auf `main` baut das Projekt mit Vite und deployt `dist/` automatisch
auf GitHub Pages (`.github/workflows/deploy.yml`). Es gibt keine Serverlogik –
alles läuft im Browser.

### Branch-/PR-Vorschau zur Abnahme

Ein Branch oder PR kann manuell auf derselben Pages-Seite unter `/preview/`
deployt werden (`.github/workflows/preview.yml`):

1. Auf GitHub: **Actions → „Preview-Deployment (Branch/PR)" → Run workflow**.
2. Branch auf `main` lassen und als Eingabe den Branch-Namen **oder** die
   PR-Nummer angeben (z. B. `7`).
3. Nach dem Lauf:
   - `https://rawe.github.io/browser-games/` → unverändert der `main`-Stand
   - `https://rawe.github.io/browser-games/preview/` → der gewählte Stand
   - `…/preview/PREVIEW.txt` zeigt, welcher Branch/Commit deployt ist.

Hinweise:

- Es gibt immer nur **eine** Vorschau gleichzeitig; ein neuer Lauf ersetzt sie.
- Ein Push auf `main` (z. B. der Merge des PRs) deployt wieder nur `main` und
  entfernt die Vorschau automatisch.
- Vorschau vorzeitig entfernen: den normalen Workflow „Deploy to GitHub Pages"
  manuell starten (Run workflow auf `main`).
