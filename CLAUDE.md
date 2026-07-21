# CLAUDE.md

Sammlung kleiner Browser-Games für GitHub Pages. Nur clientseitiger Code – keine Serverlogik, keine externen APIs zur Laufzeit.

## Befehle

- `npm run dev` – Dev-Server (Vite)
- `npm run build` – optimierter Build nach `dist/`
- `npm run preview` – Build lokal prüfen

## Architektur

- **Ein Verzeichnis pro Spiel** unter `games/<name>/` mit eigener `index.html` als Einstiegspunkt.
- **Modular entwickeln:** Spiellogik, Rendering und Input in getrennte ES-Module aufteilen (Muster: `games/snake/`). Spiellogik DOM-frei halten. Keine Mega-Dateien.
- `games.js` ist das Manifest für die Übersichtsseite (`index.html`) – jedes neue Spiel dort eintragen.
- `shared/base.css` enthält gemeinsame Styles (Farb-Variablen, Karten, Back-Link) – wiederverwenden statt duplizieren.
- `vite.config.js` erkennt `games/*/index.html` automatisch als Build-Einstiegspunkte; keine manuelle Registrierung nötig.

## Konventionen

- Moderne Web-Standards: ES-Module, `<canvas>`/DOM-APIs, CSS Custom Properties, `light-dark()`, kein jQuery/Legacy.
- Keine Frameworks als Standard; falls ein Spiel eines braucht, als Dev-Dependency und über den Vite-Build.
- Asset-Pfade relativ bzw. root-relativ halten, damit der Pages-Build (`base: './'`) funktioniert.
- Deutsch für UI-Texte und Doku.

## Git

- Commits und Pull Requests **ohne** Claude-Co-Author-Trailer oder KI-Attributierung.
