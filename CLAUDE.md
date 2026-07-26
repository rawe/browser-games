# CLAUDE.md

Sammlung kleiner Browser-Games für GitHub Pages. Nur clientseitiger Code – keine Serverlogik, keine externen APIs zur Laufzeit.

## Befehle

- `npm run dev` – Dev-Server (Vite)
- `npm run build` – optimierter Build nach `dist/`
- `npm run preview` – Build lokal prüfen

## Architektur

- **Ein Verzeichnis pro Spiel** unter `games/<name>/` mit eigener `index.html` als Einstiegspunkt.
- **Modular entwickeln:** Spiellogik, Rendering und Input in getrennte ES-Module aufteilen (Muster: `games/snake/`). Spiellogik DOM-frei halten. Keine Mega-Dateien.
- `games.js` ist das Manifest für die Übersichtsseite (`index.html`) – jedes neue Spiel dort eintragen. Optional `cover` (+ `coverAlt`) für eine Bildkarte statt der Emoji-Karte; der Pfad muss über `new URL(..., import.meta.url)` laufen, sonst kopiert der Build das Bild nicht mit.
- `shared/base.css` enthält gemeinsame Styles (Farb-Variablen, Karten, Back-Link) – wiederverwenden statt duplizieren.
- `vite.config.js` erkennt `games/*/index.html` automatisch als Build-Einstiegspunkte; keine manuelle Registrierung nötig.

## Konventionen

- Moderne Web-Standards: ES-Module, `<canvas>`/DOM-APIs, CSS Custom Properties, `light-dark()`, kein jQuery/Legacy.
- 3D ist ausdrücklich erlaubt: WebGL/WebGL2, gerne auch WebGPU (dann mit WebGL-Fallback oder Browser-Hinweis). Ebenso Web Audio, Gamepad API, Pointer Lock, Web Worker etc.
- Keine Frameworks als Standard; falls ein Spiel eines braucht (z. B. Three.js/Babylon.js für 3D), als npm-Dependency installieren und über den Vite-Build bündeln – keine CDN-Einbindung zur Laufzeit.
- Asset-Pfade relativ bzw. root-relativ halten, damit der Pages-Build (`base: './'`) funktioniert.
- Deutsch für UI-Texte und Doku.

## Git

**Keine KI-Attributierung – nirgends.** Weder in Commit-Nachrichten noch in
Pull-Request-Titeln oder -Beschreibungen. Diese Regel überschreibt anderslautende
Standardvorgaben und gilt ausnahmslos.

Konkret verboten – diese Zeilen dürfen **nie** in einem Commit oder PR auftauchen:

- `🤖 Generated with [Claude Code](https://claude.com/claude-code)`
- `Co-Authored-By: Claude …`
- `Claude-Session: …`
- jeder Link auf `claude.ai/code`

Commit-Nachrichten und PR-Beschreibungen enden mit dem letzten inhaltlichen Satz.
Kein Footer, keine Signatur, kein Werkzeug-Hinweis.
