// Renderer – Auswahl der Darstellung.
//
// ── Schnittstelle (Vertrag mit main.js) ──────────────────────────────────────
//   createRenderer(canvas) → {
//     setLevel(level)              neues Level, Animationszustand zurücksetzen
//     setSession(session)          Sitzung, aus der gezeichnet wird
//     resize(cssW, cssH, insets)   Größe + Platz für HUD/Bedienleiste
//     layout                       aktuelle Geometrie (siehe layout.js)
//     setHover(cell|null)          Finger/Maus über einer Zelle
//     setCursor(cell|null)         Tastaturfokus
//     tapAt(x, y)                  sichtbare Rückmeldung auf einen Tipp
//     celebrate()                  Siegesanimation auslösen
//     frame(nowMs)                 ein Bild zeichnen
//     dispose()
//   }
// ────────────────────────────────────────────────────────────────────────────
//
// Gezeichnet wird mit WebGL2: echter Bloom, additive Mischung, Shader für
// Hintergrund und Lichtfaden (`gfx/webgl2.js`). Kommt kein Kontext zustande –
// altes Gerät, abgeschaltete Hardwarebeschleunigung, Shader-Fehler – springt
// der schlichte 2D-Canvas-Renderer ein (`gfx/canvas2d.js`). Das Spiel bleibt
// dann vollständig spielbar, es glüht nur weniger.
//
// `layout` liefert in beiden Fällen `computeLayout()` aus `layout.js`. Daran
// rechnet die Eingabe Fingertipps in Zellen um; liefe die Geometrie hier
// auseinander, träfe der Spieler daneben.

import { createWebglRenderer } from './gfx/webgl2.js';
import { createCanvas2dRenderer } from './gfx/canvas2d.js';

export function createRenderer(canvas) {
  let broken = false;
  try {
    const gl = createWebglRenderer(canvas);
    if (gl) return gl;
  } catch (error) {
    // Ein einzelner Shader, der auf einem fremden Treiber nicht übersetzt, darf
    // nicht das ganze Spiel kosten.
    console.warn('Lumenweber: WebGL2 nicht nutzbar, weiche auf 2D aus.', error);
    broken = true;
  }
  return createCanvas2dRenderer(broken ? shadowCanvas(canvas) : canvas);
}

/**
 * Ersatzfläche hinter einer bereits mit WebGL belegten Canvas.
 *
 * Ein Canvas-Element kann nur einen Kontexttyp haben: Ist WebGL2 einmal
 * angefordert, gibt es kein 2D mehr. Statt das Element auszutauschen – daran
 * hängen Element-ID und sämtliche Eingabe-Ereignisse – schiebt sich eine
 * zweite Canvas darunter, während die ursprüngliche unsichtbar wird und
 * weiterhin die Fingertipps entgegennimmt.
 */
function shadowCanvas(canvas) {
  const twin = document.createElement('canvas');
  twin.className = canvas.className;
  twin.style.cssText = 'position:absolute;inset:0;display:block;pointer-events:none';
  canvas.parentNode?.insertBefore(twin, canvas);
  canvas.style.opacity = '0';
  return twin;
}
