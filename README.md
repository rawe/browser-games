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
