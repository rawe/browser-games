// Alle Spielsteine in einem Shader.
//
// Wand, Ziel, Spiegel, Quelle, Ring, Funke: gezeichnet wird immer derselbe
// gedrehte Quad, und erst `vKind` entscheidet, welche Abstandsfunktion darin
// ausgewertet wird. Das kostet einen Sprung pro Pixel, spart aber Dutzende
// Zeichenaufrufe – auf Mobil-GPUs ist das der bessere Handel.
//
// Die lokalen Koordinaten laufen von -1 bis 1 über die halbe Kantenlänge des
// Sprites. Kantenglättung kommt durchweg aus `fwidth` und passt sich damit von
// selbst an Zellgröße und Pixelverhältnis an.

import { HEAD, NOISE, SDF } from './common.js';
import { KIND } from '../kinds.js';

export const SPRITE_VERT = `${HEAD}
layout(location = 0) in vec2 aQuad;
layout(location = 1) in vec4 aXform;   // Mitte x,y · halbe Größe · Drehung
layout(location = 2) in vec4 aWhat;    // Art · Stärke · Glut · Zusatz
layout(location = 3) in vec4 aColor;
layout(location = 4) in vec4 aParams;

uniform vec2 uCssRes;

out vec2 vLocal;
flat out vec4 vWhat;
flat out vec4 vColor;
flat out vec4 vParams;

void main() {
  float c = cos(aXform.w);
  float s = sin(aXform.w);
  vec2 p = aXform.xy + mat2(c, s, -s, c) * (aQuad * aXform.z);
  vLocal = aQuad;
  vWhat = aWhat;
  vColor = aColor;
  vParams = aParams;
  vec2 clip = (p / uCssRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const SPRITE_FRAG = `${HEAD}
in vec2 vLocal;
flat in vec4 vWhat;
flat in vec4 vColor;
flat in vec4 vParams;
out vec4 outColor;

uniform float uTime;
uniform float uCalm;
${NOISE}
${SDF}

const int K_WALL = ${KIND.WALL};
const int K_TARGET = ${KIND.TARGET};
const int K_MIRROR = ${KIND.MIRROR};
const int K_SOURCE = ${KIND.SOURCE};
const int K_CURSOR = ${KIND.CURSOR};
const int K_BEZEL = ${KIND.BEZEL};
const int K_TARGET_GLOW = ${KIND.TARGET_GLOW};
const int K_MIRROR_GLINT = ${KIND.MIRROR_GLINT};
const int K_SOURCE_CORONA = ${KIND.SOURCE_CORONA};
const int K_RING = ${KIND.RING};
const int K_SPARK = ${KIND.SPARK};
const int K_HALO = ${KIND.HALO};

/* ---------- Materie (deckend) ---------- */

vec4 drawWall(vec2 p, float aa) {
  float d = sdRound(p, vec2(0.88), 0.26);
  float body = fill(d, aa);
  // Nach innen dunkler: der Block soll Licht schlucken, nicht spiegeln.
  float depth = smoothstep(0.0, -0.55, d);
  vec3 col = mix(vec3(0.036, 0.046, 0.088), vec3(0.008, 0.010, 0.022), depth);
  // Feine Riffelung, damit die Fläche nicht tot wirkt.
  col += (vnoise(p * 9.0) - 0.5) * 0.010;
  // Kante zum Raster: kalt, klar, oben etwas heller (Streiflicht).
  float edge = stroke(d, 0.045, aa * 1.6);
  float lip = smoothstep(0.6, -0.2, p.y);
  col += mix(vec3(0.14, 0.20, 0.36), vec3(0.42, 0.56, 0.92), lip) * edge;
  return vec4(col, body);
}

vec4 drawTarget(vec2 p, float aa, float lit, float seed) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = mix(uTime, 0.0, uCalm);

  // Ungetroffen atmet der Knoten langsam – er wartet sichtbar auf Licht.
  float wait = 0.94 + 0.06 * sin(t * 1.5 + seed * 6.28);
  float ringR = mix(0.60 * wait, 0.63, lit);
  float ringD = abs(r - ringR) - mix(0.045, 0.062, lit);
  float ring = fill(ringD, aa);

  // Sechs Facetten geben dem Ring Struktur und drehen sich sehr träge.
  float facet = 0.5 + 0.5 * cos(ang * 6.0 - t * 0.25 + seed);
  vec3 ringCol = mix(vec3(0.20, 0.28, 0.48), vec3(1.00, 0.78, 0.38), lit);
  ringCol *= 0.70 + 0.55 * facet;

  float coreR = mix(0.15 * wait, 0.27, lit);
  float core = fill(r - coreR, aa);
  vec3 coreCol = mix(vec3(0.10, 0.15, 0.28), vec3(1.00, 0.96, 0.86), lit);

  float a = clamp(ring + core, 0.0, 1.0);
  vec3 col = ringCol * ring + coreCol * core;
  return vec4(col / max(a, 0.001), a);
}

vec4 drawMirror(vec2 p, float aa, float locked, float lit, float seed) {
  float d = sdRound(p, vec2(0.72, 0.105), 0.095);
  float body = fill(d, aa);
  float t = mix(uTime, 0.0, uCalm);

  // Quer durch die Scheibe: oben Weißglanz, Mitte Glas, unten Schattenkante.
  float v = clamp((p.y + 0.105) / 0.21, 0.0, 1.0);
  vec3 top = mix(vec3(1.00, 1.00, 1.00), vec3(0.60, 0.65, 0.76), locked);
  vec3 mid = mix(vec3(0.58, 0.80, 1.00), vec3(0.26, 0.30, 0.40), locked);
  vec3 bot = mix(vec3(0.08, 0.20, 0.42), vec3(0.05, 0.06, 0.11), locked);
  vec3 col = mix(mix(top, mid, smoothstep(0.0, 0.42, v)), bot, smoothstep(0.42, 1.0, v));

  // Wanderndes Streiflicht – geschliffenes Glas, kein Blech.
  float sheen = exp(-pow((p.x - sin(t * 0.4 + seed * 6.0)) * 2.4, 2.0));
  col += vec3(0.85, 0.93, 1.00) * sheen * 0.30 * (1.0 - locked * 0.75);

  // Schmale Lichtkante an der Oberseite.
  col += vec3(1.0) * stroke(d, 0.018, aa) * smoothstep(0.02, -0.10, p.y) * 0.55;
  col += vec3(0.45, 0.75, 1.00) * lit * 0.30;

  return vec4(col, body);
}

vec4 drawBezel(vec2 p, float aa, float locked, float hover, float lit) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float w = mix(0.030, 0.052, locked);
  float ring = stroke(r - 0.87, w, aa);

  // Drehbar: vier Bögen mit Lücken – die Fassung sieht beweglich aus.
  // Verschraubt: geschlossener Ring mit vier Schraubenköpfen.
  float gaps = mix(smoothstep(0.18, 0.52, abs(sin(ang * 2.0 + 0.7854))), 1.0, locked);
  float screws = 0.0;
  for (int i = 0; i < 4; i++) {
    float a = 0.7854 + float(i) * 1.5708;
    screws = max(screws, fill(length(p - vec2(cos(a), sin(a)) * 0.87) - 0.075, aa));
  }
  screws *= locked;

  vec3 open = mix(vec3(0.24, 0.48, 0.86), vec3(0.65, 0.88, 1.00), hover);
  vec3 fixedCol = vec3(0.20, 0.22, 0.30);
  vec3 col = mix(open, fixedCol, locked);
  col = mix(col, vec3(0.34, 0.37, 0.46), screws);
  col += vec3(0.30, 0.55, 0.95) * lit * (1.0 - locked) * 0.35;

  float a = max(ring * gaps, screws) * mix(mix(0.34, 0.85, hover), 0.72, locked);
  return vec4(col, a);
}

vec4 drawSource(vec2 p, float aa) {
  float r = length(p);
  float t = mix(uTime, 0.0, uCalm);

  // Düse in +x – der Sprite ist bereits in Strahlrichtung gedreht.
  float wedge = max(max(abs(p.y) - (0.34 - 0.36 * p.x), p.x - 0.84), 0.30 - p.x);
  float nozzle = fill(wedge, aa);

  float shell = stroke(r - 0.54, 0.10, aa);
  float orb = fill(r - 0.34, aa);

  vec3 col = vec3(0.16, 0.13, 0.10);
  col = mix(col, vec3(0.42, 0.31, 0.18), shell);
  col = mix(col, vec3(1.00, 0.92, 0.74), nozzle);
  // Kern: heiß, mit leichtem Flackern.
  float flicker = 1.0 + 0.10 * sin(t * 5.3) * (1.0 - uCalm);
  col = mix(col, vec3(1.00, 0.96, 0.86) * flicker, orb);

  float a = clamp(max(max(shell, orb), nozzle), 0.0, 1.0);
  return vec4(col, a);
}

vec4 drawCursor(vec2 p, float aa) {
  vec2 q = abs(p);
  float frame = stroke(max(q.x, q.y) - 0.90, 0.020, aa);
  // Nur die Ecken zeigen – ein voller Rahmen würde mit der Fassung streiten.
  float corner = smoothstep(0.44, 0.56, min(q.x, q.y));
  return vec4(vec3(1.0), frame * corner * 0.8);
}

/* ---------- Licht (additiv) ---------- */

vec3 drawTargetGlow(vec2 p, float lit, float impact, float seed) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = mix(uTime, 0.0, uCalm);

  float halo = exp(-r * r * 5.0) * 1.1 + 0.30 / (1.0 + r * r * 22.0);
  float rays = (0.55 + 0.45 * cos(ang * 8.0 - t * 0.6 + seed * 6.0)) * exp(-r * r * 3.2) * 0.40;
  vec3 col = vec3(1.00, 0.80, 0.45) * (halo + rays) * lit;

  // Einschlag: ein kurzer weißer Kern, der schnell in das ruhige Glühen fällt.
  col += vec3(1.0, 0.97, 0.92) * impact * exp(-r * r * 9.0) * 1.6;
  return col;
}

vec3 drawMirrorGlint(vec2 p, float lit) {
  // Streifen entlang der Scheibe plus ein Kreuzreflex in der Mitte.
  float streak = exp(-pow(p.y / 0.075, 2.0)) * (1.0 - smoothstep(0.15, 0.95, abs(p.x)));
  float cross = exp(-pow(p.x / 0.030, 2.0)) + exp(-pow(p.y / 0.026, 2.0));
  float spot = exp(-dot(p, p) * 26.0);
  vec3 col = vec3(0.55, 0.82, 1.00) * streak * 0.85;
  col += vec3(1.0) * (cross * exp(-dot(p, p) * 3.0) * 0.30 + spot * 0.55);
  return col * lit;
}

vec3 drawSourceCorona(vec2 p) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = mix(uTime, 0.0, uCalm);
  float pulse = 0.88 + 0.12 * sin(t * 2.1);
  float halo = exp(-r * r * 4.2) * 1.2 + 0.26 / (1.0 + r * r * 16.0);
  float rays = (0.5 + 0.5 * cos(ang * 12.0 + t * 0.8)) * exp(-r * r * 2.6) * 0.30;
  return vec3(1.00, 0.72, 0.34) * (halo + rays) * pulse;
}

vec3 drawRing(vec2 p, float prog, float warm) {
  float r = length(p);
  float rr = mix(0.06, 1.0, prog);
  float w = mix(0.16, 0.03, prog);
  float band = exp(-pow((r - rr) / w, 2.0)) * (1.0 - prog) * (1.0 - prog);
  vec3 col = mix(vec3(0.55, 0.82, 1.00), vec3(1.00, 0.80, 0.42), warm);
  return col * band * 1.6;
}

vec3 drawSpark(vec2 p, float phase) {
  float r = length(p);
  float t = mix(uTime, 0.0, uCalm);
  float tw = 0.55 + 0.45 * sin(t * 6.0 + phase * 6.28);
  float core = exp(-r * r * 90.0);
  float cross = (exp(-pow(p.x / 0.020, 2.0)) + exp(-pow(p.y / 0.020, 2.0))) * exp(-r * r * 5.0);
  float diag = (exp(-pow((p.x + p.y) / 0.045, 2.0)) + exp(-pow((p.x - p.y) / 0.045, 2.0))) * exp(-r * r * 9.0);
  return (vec3(1.0) * core * 1.4 + vec3(0.75, 0.92, 1.00) * (cross * 0.55 + diag * 0.25)) * tw;
}

void main() {
  int kind = int(vWhat.x + 0.5);
  float power = vWhat.y;
  vec2 p = vLocal;
  float aa = max(fwidth(p.x), fwidth(p.y)) * 1.1;

  vec4 rgba = vec4(0.0);
  if (kind == K_WALL) {
    rgba = drawWall(p, aa);
  } else if (kind == K_TARGET) {
    rgba = drawTarget(p, aa, vParams.x, vParams.z);
  } else if (kind == K_MIRROR) {
    rgba = drawMirror(p, aa, vParams.x, vParams.y, vParams.z);
  } else if (kind == K_BEZEL) {
    rgba = drawBezel(p, aa, vParams.x, vParams.y, vParams.z);
  } else if (kind == K_SOURCE) {
    rgba = drawSource(p, aa);
  } else if (kind == K_CURSOR) {
    rgba = drawCursor(p, aa);
  } else if (kind == K_TARGET_GLOW) {
    rgba = vec4(drawTargetGlow(p, vParams.x, vParams.y, vParams.z), 1.0);
  } else if (kind == K_MIRROR_GLINT) {
    rgba = vec4(drawMirrorGlint(p, vParams.x), 1.0);
  } else if (kind == K_SOURCE_CORONA) {
    rgba = vec4(drawSourceCorona(p), 1.0);
  } else if (kind == K_RING) {
    rgba = vec4(drawRing(p, vParams.x, vParams.y), 1.0);
  } else if (kind == K_SPARK) {
    rgba = vec4(drawSpark(p, vParams.x), 1.0);
  } else if (kind == K_HALO) {
    float r = length(p);
    rgba = vec4(vec3(exp(-r * r * 3.4)), 1.0);
  }

  if (kind >= K_TARGET_GLOW) {
    // Additiv: Farbe modulieren, Alpha spielt keine Rolle.
    outColor = vec4(rgba.rgb * vColor.rgb * power, 1.0);
  } else {
    outColor = vec4(rgba.rgb * vColor.rgb * power, rgba.a * vColor.a);
  }
}`;
