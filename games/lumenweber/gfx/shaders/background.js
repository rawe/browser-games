// Hintergrund: Tiefe, aber leise.
//
// Alles in einem Vollbild-Durchgang – Nebel, Sternenstaub, die Mulde des
// Bretts und das Raster. Das Raster hier statt als Linien-Geometrie zu
// zeichnen hat einen handfesten Grund: Aus der Ableitung der Zellkoordinate
// fällt die Kantenglättung gratis ab, und die Linien bleiben bei jedem
// Pixelverhältnis exakt gleich dünn.
//
// Der Hintergrund darf nie lauter werden als der Faden. Die Helligkeiten hier
// bleiben deshalb unter etwa 0.12 – Bloom greift erst weiter oben.

import { HEAD, FULLSCREEN_VERT, NOISE, SDF } from './common.js';

export const BACKGROUND_VERT = FULLSCREEN_VERT;

export const BACKGROUND_FRAG = `${HEAD}
in vec2 vUv;
out vec4 outColor;

uniform vec2 uPxRes;     // Auflösung in Geräte-Pixeln
uniform float uDpr;
uniform float uTime;
uniform vec4 uBoard;     // Ursprung + Größe des Bretts in CSS-Pixeln
uniform float uCell;
uniform vec2 uGridDim;   // Spalten, Zeilen
uniform float uCalm;     // 1 = Bewegung reduziert
uniform float uWin;      // 0…1 Siegesglanz
${NOISE}
${SDF}

/** Eine Ebene Sternenstaub auf einem gehashten Raster. */
vec3 dust(vec2 uv, float scale, float density, float t) {
  vec2 g = uv * scale;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(id);
  float on = step(density, h);
  vec2 off = (vec2(hash21(id + 11.3), hash21(id + 37.7)) - 0.5) * 0.7;
  float d = length(f - off);
  float core = 1.0 - smoothstep(0.0, 0.05, d);
  float halo = (1.0 - smoothstep(0.0, 0.30, d)) * 0.12;
  float flicker = mix(0.55 + 0.45 * sin(t * (0.6 + h * 2.4) + h * 41.0), 1.0, uCalm);
  // Kühle und warme Körnchen gemischt, damit der Staub nicht steril wirkt.
  vec3 tint = mix(vec3(0.72, 0.84, 1.0), vec3(1.0, 0.88, 0.70), step(0.82, h));
  return tint * on * (core + halo) * (0.20 + 0.80 * h) * flicker;
}

void main() {
  vec2 res = uPxRes / uDpr;
  vec2 px = vec2(gl_FragCoord.x, uPxRes.y - gl_FragCoord.y) / uDpr;
  vec2 uv = px / res;
  vec2 auv = vec2(uv.x * res.x / res.y, uv.y);
  float t = mix(uTime, 0.0, uCalm);

  // Grundverlauf: oben ein Hauch Indigo, unten fast Schwarz.
  vec3 col = mix(vec3(0.026, 0.032, 0.070), vec3(0.006, 0.008, 0.020), smoothstep(0.0, 1.0, uv.y));

  // Zwei gegenläufige Nebelbänder. Der Kontrast bleibt bewusst gering; sie
  // sollen Tiefe andeuten, nicht Muster zeigen.
  float n1 = fbm(auv * 2.6 + vec2(t * 0.012, t * -0.008));
  float n2 = fbm(auv * 1.3 + vec2(-t * 0.009, t * 0.006) + 4.7);
  float veil = smoothstep(0.35, 1.0, n1 * 0.65 + n2 * 0.55);
  col += mix(vec3(0.10, 0.16, 0.42), vec3(0.06, 0.26, 0.34), n2) * veil * 0.16;

  // Sternenstaub in drei Tiefen.
  col += dust(auv, 26.0, 0.86, t) * 0.55;
  col += dust(auv + 3.1, 14.0, 0.90, t * 0.7) * 0.85;
  col += dust(auv + 8.4, 7.0, 0.94, t * 0.4) * 1.15;

  // Die Mulde, in der das Brett liegt.
  vec2 half2 = uBoard.zw * 0.5;
  vec2 bc = uBoard.xy + half2;
  float bd = sdRound(px - bc, half2 + uCell * 0.10, uCell * 0.22);
  float inside = fill(bd, 1.5);
  float rad = length((px - bc) / max(half2, vec2(1.0)));

  col *= mix(1.0, 0.72, inside);                         // außen bleibt es lauter
  col += vec3(0.020, 0.032, 0.072) * inside * (1.0 - 0.55 * rad);

  // Raster. Nur innerhalb des Bretts, mit weichem Abfall nach außen.
  vec2 gp = (px - uBoard.xy) / uCell;
  vec2 gw = fwidth(gp);
  vec2 dl = 0.5 - abs(fract(gp) - 0.5);
  vec2 lines = 1.0 - smoothstep(vec2(0.0), gw * 1.2, dl);
  vec2 span = step(vec2(-0.001), gp) * step(gp, uGridDim + 0.001);
  float grid = max(lines.x * span.y, lines.y * span.x) * span.x * span.y;

  // Ein sehr langsam nach außen laufender Puls lässt das Feld atmen.
  float breath = mix(1.0, 0.80 + 0.35 * sin(t * 0.7 - rad * 3.0), 1.0 - uCalm);
  col += vec3(0.16, 0.28, 0.56) * grid * 0.30 * breath;

  // Kante des Bretts als feine Lichtlinie.
  col += vec3(0.22, 0.42, 0.85) * stroke(bd, 1.0, 1.4) * 0.55;

  // Siegesglanz: warme Aufhellung von der Brettmitte her.
  col += vec3(0.95, 0.72, 0.36) * uWin * 0.14 * (1.0 - smoothstep(0.0, 1.6, rad));

  outColor = vec4(col, 1.0);
}`;
