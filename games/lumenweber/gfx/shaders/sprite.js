// Alle Spielsteine in einem Shader.
//
// Wand, Ziel, Spiegel, Prisma, Fassung, Quelle, Ring, Funke: gezeichnet wird
// immer derselbe gedrehte Quad, und erst `vKind` entscheidet, welche
// Abstandsfunktion darin ausgewertet wird. Das kostet einen Sprung pro Pixel,
// spart aber Dutzende Zeichenaufrufe – auf Mobil-GPUs ist das der bessere
// Handel.
//
// Die lokalen Koordinaten laufen von -1 bis 1 über die halbe Kantenlänge des
// Sprites. Kantenglättung kommt durchweg aus `fwidth` und passt sich damit von
// selbst an Zellgröße und Pixelverhältnis an.

import { HEAD, NOISE, SDF } from './common.js';
import { KIND } from '../kinds.js';
import { PRISM_AMBER, PRISM_CYAN } from '../palette.js';

const glslVec3 = (c) => `vec3(${c.map((v) => v.toFixed(4)).join(', ')})`;

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
const int K_PRISM = ${KIND.PRISM};
const int K_SOCKET = ${KIND.SOCKET};
const int K_SOURCE = ${KIND.SOURCE};
const int K_CURSOR = ${KIND.CURSOR};
const int K_BEZEL = ${KIND.BEZEL};
const int K_TARGET_GLOW = ${KIND.TARGET_GLOW};
const int K_MIRROR_GLINT = ${KIND.MIRROR_GLINT};
const int K_PRISM_GLINT = ${KIND.PRISM_GLINT};
const int K_SOURCE_CORONA = ${KIND.SOURCE_CORONA};
const int K_RING = ${KIND.RING};
const int K_SPARK = ${KIND.SPARK};
const int K_HALO = ${KIND.HALO};

const vec3 C_AMBER = ${glslVec3(PRISM_AMBER)};
const vec3 C_CYAN = ${glslVec3(PRISM_CYAN)};

/**
 * Farbe und Form eines Knotens hängen an seiner Wunschfarbe.
 *
 * Nicht nur die Farbe: Auch die Zahl der Facetten ändert sich (6 · 3 · 4 · 8),
 * und der Weißknoten trägt einen zweiten Ring. Wer Farben schlecht
 * unterscheidet, erkennt den Knoten trotzdem an der Form.
 */
vec3 wantColor(float want) {
  if (want < 0.5) return vec3(1.00, 0.78, 0.38);
  if (want < 1.5) return C_AMBER;
  if (want < 2.5) return C_CYAN;
  return vec3(0.88, 0.94, 1.00);
}

float wantFacets(float want) {
  if (want < 0.5) return 6.0;
  if (want < 1.5) return 3.0;
  if (want < 2.5) return 4.0;
  return 8.0;
}

/**
 * Abstand zu einem regelmäßigen Vieleck mit n Ecken, Spitze nach oben.
 *
 * Ein Knoten für beliebiges Licht bleibt ein Kreis, die farbigen bekommen
 * Dreieck, Viereck und Achteck. Der 2D-Rückfall zeichnet dieselben Formen –
 * sie sind Teil der Auskunft, nicht Dekoration.
 */
float sdNgon(vec2 p, float r, float n) {
  float a = atan(p.y, p.x) + 1.5707963;
  float seg = 6.2831853 / n;
  return cos(floor(0.5 + a / seg) * seg - a) * length(p) - r;
}

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

vec4 drawTarget(vec2 p, float aa, float lit, float seed, float want) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = mix(uTime, 0.0, uCalm);
  vec3 tint = wantColor(want);
  float facets = wantFacets(want);

  // Ungetroffen atmet der Knoten langsam – er wartet sichtbar auf Licht.
  float wait = 0.94 + 0.06 * sin(t * 1.5 + seed * 6.28);
  float ringR = mix(0.60 * wait, 0.63, lit);
  float shape = want < 0.5 ? r - ringR : sdNgon(p, ringR, facets);
  float ring = stroke(shape, mix(0.045, 0.062, lit), aa);

  // Facetten geben dem Ring Struktur und drehen sich sehr träge.
  float facet = 0.5 + 0.5 * cos(ang * facets - t * 0.25 + seed);
  vec3 ringCol = mix(vec3(0.20, 0.28, 0.48), tint, lit);
  ringCol *= 0.70 + 0.55 * facet;

  // Der Weißknoten trägt einen zweiten, engeren Reif: Er will beide Farben.
  float twin = step(2.5, want) * stroke(r - ringR * 0.62, 0.026, aa);
  ring = clamp(ring + twin * 0.85, 0.0, 1.0);

  float coreR = mix(0.15 * wait, 0.27, lit);
  float core = fill(r - coreR, aa);
  vec3 coreCol = mix(vec3(0.10, 0.15, 0.28), mix(vec3(1.0), tint, 0.35), lit);

  float a = clamp(ring + core, 0.0, 1.0);
  vec3 col = ringCol * ring + coreCol * core;
  return vec4(col / max(a, 0.001), a);
}

vec4 drawMirror(vec2 p, float aa, float locked, float lit, float seed) {
  float d = sdRound(p, vec2(0.70, 0.120), 0.105);
  float body = fill(d, aa);
  float t = mix(uTime, 0.0, uCalm);

  // Quer durch die Scheibe: oben Weißglanz, Mitte Glas, unten Schattenkante.
  float v = clamp((p.y + 0.120) / 0.24, 0.0, 1.0);
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

/**
 * Das Prisma: ein Glaskeil, der auf der Diagonalen liegt.
 *
 * Anders als der Spiegel ist es keine dünne Scheibe, sondern ein Körper mit
 * zwei Flanken – und die sind gefärbt. Oben, wohin das Cyan abbiegt, schimmert
 * es blaugrün; unten, wo der Bernstein geradeaus hindurchläuft, warm. Der
 * Spieler sieht damit schon am Stein, was er tut, bevor Licht ihn trifft.
 */
vec4 drawPrism(vec2 p, float aa, float locked, float lit, float seed) {
  float t = mix(uTime, 0.0, uCalm);

  // Ein gedrungener Keil, kein Blatt: dreimal so dick wie eine Spiegelscheibe.
  // Das ist Absicht – auf einen Blick muss klar sein, dass hier etwas anderes
  // steht als ein Spiegel, auch wenn beide auf der Diagonalen liegen.
  float d = abs(p.x) * 0.55 + abs(p.y) * 1.25 - 0.42;
  float body = fill(d, aa);

  // Die beiden Flanken tragen die beiden Grundfarben – oben biegt Cyan ab,
  // unten läuft Bernstein hindurch. Auch verschraubt bleibt das sichtbar; die
  // Farbe ist die Auskunft des Bauteils, nicht seine Verzierung.
  float side = smoothstep(-0.10, 0.10, p.y);
  vec3 col = mix(C_CYAN * 0.72, C_AMBER * 0.72, side);
  col *= mix(1.0, 0.62, locked);

  // Heller Grat auf der Mittelachse: die Kante, an der sich das Licht trennt.
  float spine = exp(-pow(p.y / 0.05, 2.0)) * (1.0 - smoothstep(0.45, 0.95, abs(p.x)));
  col += vec3(1.0, 0.99, 0.96) * spine * mix(0.75, 1.25, lit);

  // Ein Spektrum wandert träge durch das Glas – kein Blech, sondern Optik.
  float sweep = fract(p.x * 0.45 + t * 0.06 + seed);
  col += mix(C_AMBER, C_CYAN, sweep) * 0.20 * (1.0 - locked * 0.6)
    * exp(-pow(p.y / 0.24, 2.0));

  // Facettenkante ringsum, oben kalt und unten warm gebrochen.
  col += mix(C_CYAN, C_AMBER, side) * stroke(d, 0.038, aa) * 0.85;
  col += vec3(1.0) * stroke(d, 0.014, aa) * 0.35;
  col += mix(C_CYAN, C_AMBER, side) * lit * 0.40;

  return vec4(col, body);
}

/**
 * Die leere Fassung: eine Halterung, in der noch nichts steckt.
 *
 * Sie ist absichtlich zurückhaltend – ein gestrichelter Umriss in Form des
 * Prismas, das hineingehört. Solange noch ein Prisma im Vorrat liegt (ready),
 * atmet sie; ist der Vorrat leer, wird sie still.
 */
vec4 drawSocket(vec2 p, float aa, float ready, float hover) {
  float t = mix(uTime, 0.0, uCalm);
  vec2 q = abs(p);

  // Vier Eckwinkel am Zellenrand. Sie sitzen bewusst weit außen: Eine Fassung
  // liegt oft mitten im hellen Strahl, und der überstrahlt alles, was innerhalb
  // seines Hofs liegt. Nur außerhalb bleibt sie ablesbar.
  float bracket = stroke(max(q.x, q.y) - 0.84, 0.048, aa)
    * smoothstep(0.38, 0.60, min(q.x, q.y));

  // Innen, gestrichelt, der Umriss dessen, was hineingehört.
  float d = abs(p.x) * 0.55 + abs(p.y) * 1.25 - 0.42;
  float dash = 0.5 + 0.5 * sin(atan(p.y, p.x * 0.42) * 7.0 + t * 0.4);
  float ghost = stroke(d, 0.034, aa) * smoothstep(0.28, 0.62, dash);

  // Solange noch ein Prisma im Vorrat liegt, atmet sie; ist er leer, wird sie still.
  float breathe = mix(0.62, 0.62 + 0.38 * (0.5 + 0.5 * sin(t * 2.0)), ready);
  vec3 col = mix(vec3(0.40, 0.58, 0.88), vec3(0.84, 0.96, 1.00), max(hover, ready * 0.55));
  float a = clamp(bracket * 0.95 + ghost * 0.65, 0.0, 1.0) * breathe;
  return vec4(col, a);
}

vec4 drawBezel(vec2 p, float aa, float locked, float hover, float lit) {
  float r = length(p);
  float ang = atan(p.y, p.x);

  // Verschraubt bekommt eine dunkle Trägerplatte: Das Bauteil sitzt sichtbar
  // in einer Fassung und lädt schon dadurch nicht zum Antippen ein.
  float plate = fill(r - 0.80, aa) * locked;

  float w = mix(0.026, 0.075, locked);
  float ring = stroke(r - mix(0.87, 0.80, locked), w, aa);

  // Drehbar: vier weit offene Bögen – die Fassung sieht beweglich aus.
  float gaps = mix(smoothstep(0.30, 0.62, abs(sin(ang * 2.0 + 0.7854))), 1.0, locked);

  float screws = 0.0;
  for (int i = 0; i < 4; i++) {
    float a = 0.7854 + float(i) * 1.5708;
    vec2 c = p - vec2(cos(a), sin(a)) * 0.80;
    float head = fill(length(c) - 0.10, aa);
    // Schlitz im Schraubenkopf – auf kleinen Zellen bleibt wenigstens der
    // Kontrast, auf großen liest man die Schraube wirklich.
    head *= 1.0 - fill(sdBox(c, vec2(0.075, 0.018)), aa) * 0.75;
    screws = max(screws, head);
  }
  screws *= locked;

  vec3 open = mix(vec3(0.26, 0.52, 0.92), vec3(0.72, 0.92, 1.00), hover);
  vec3 col = mix(open, vec3(0.22, 0.25, 0.33), locked);
  col = mix(col, vec3(0.04, 0.05, 0.09), plate * (1.0 - max(ring, screws)));
  col = mix(col, vec3(0.46, 0.50, 0.60), screws);
  col += vec3(0.30, 0.55, 0.95) * lit * (1.0 - locked) * 0.35;

  float a = max(max(ring * gaps, screws), plate * 0.72);
  a *= mix(mix(0.36, 0.95, hover), 1.0, locked);
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

vec3 drawTargetGlow(vec2 p, float lit, float impact, float seed, float want) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = mix(uTime, 0.0, uCalm);
  vec3 tint = wantColor(want);

  float halo = exp(-r * r * 6.5) * 0.55 + 0.12 / (1.0 + r * r * 40.0);
  float rays = (0.55 + 0.45 * cos(ang * wantFacets(want) * 1.35 - t * 0.6 + seed * 6.0))
    * exp(-r * r * 3.6) * 0.26;
  vec3 col = tint * (halo + rays) * lit;

  // Einschlag: ein kurzer weißer Kern, der schnell in das ruhige Glühen fällt.
  col += mix(vec3(1.0), tint, 0.25) * impact * exp(-r * r * 9.0) * 1.1;
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

/**
 * Der Glanz eines arbeitenden Prismas: ein Spektrum, das aus der Kante tritt.
 *
 * split sagt, ob hier gerade wirklich getrennt oder vereinigt wird – dann
 * fächert das Licht sichtbar auf, sonst glimmt nur die Kante.
 */
vec3 drawPrismGlint(vec2 p, float lit, float split) {
  float r = length(p);
  float t = mix(uTime, 0.0, uCalm);

  float edge = exp(-pow(p.y / 0.055, 2.0)) * (1.0 - smoothstep(0.2, 0.95, abs(p.x)));
  float spot = exp(-r * r * 24.0);

  // Zwei Fächer, nach oben kalt, nach unten warm – die Trennung selbst.
  float fanUp = exp(-pow((p.y + 0.20) / 0.13, 2.0)) * exp(-p.x * p.x * 2.2);
  float fanDown = exp(-pow((p.y - 0.20) / 0.13, 2.0)) * exp(-p.x * p.x * 2.2);
  float shimmer = 0.82 + 0.18 * sin(t * 3.1 + p.x * 5.0);

  vec3 col = vec3(1.0) * (edge * 0.55 + spot * 0.65);
  col += (C_CYAN * fanUp + C_AMBER * fanDown) * split * 0.85 * shimmer;
  return col * lit;
}

vec3 drawSourceCorona(vec2 p) {
  float r = length(p);
  float ang = atan(p.y, p.x);
  float t = mix(uTime, 0.0, uCalm);
  float pulse = 0.90 + 0.10 * sin(t * 2.1);
  // Eng gehalten: Die Quelle soll warm glimmen, nicht das halbe Brett fluten.
  float halo = exp(-r * r * 7.0) * 0.85 + 0.13 / (1.0 + r * r * 26.0);
  float rays = (0.5 + 0.5 * cos(ang * 10.0 + t * 0.5)) * exp(-r * r * 4.0) * 0.12;
  return vec3(1.00, 0.70, 0.32) * (halo + rays) * pulse;
}

vec3 drawRing(vec2 p, float prog, float warm) {
  float r = length(p);
  float rr = mix(0.06, 1.0, prog);
  float w = mix(0.16, 0.03, prog);
  float band = exp(-pow((r - rr) / w, 2.0)) * (1.0 - prog) * (1.0 - prog);
  vec3 col = mix(vec3(0.55, 0.82, 1.00), vec3(1.00, 0.80, 0.42), warm);
  return col * band * 1.15;
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
    rgba = drawTarget(p, aa, vParams.x, vParams.z, vParams.w);
  } else if (kind == K_MIRROR) {
    rgba = drawMirror(p, aa, vParams.x, vParams.y, vParams.z);
  } else if (kind == K_PRISM) {
    rgba = drawPrism(p, aa, vParams.x, vParams.y, vParams.z);
  } else if (kind == K_SOCKET) {
    rgba = drawSocket(p, aa, vParams.x, vParams.y);
  } else if (kind == K_BEZEL) {
    rgba = drawBezel(p, aa, vParams.x, vParams.y, vParams.z);
  } else if (kind == K_SOURCE) {
    rgba = drawSource(p, aa);
  } else if (kind == K_CURSOR) {
    rgba = drawCursor(p, aa);
  } else if (kind == K_TARGET_GLOW) {
    rgba = vec4(drawTargetGlow(p, vParams.x, vParams.y, vParams.z, vParams.w), 1.0);
  } else if (kind == K_MIRROR_GLINT) {
    rgba = vec4(drawMirrorGlint(p, vParams.x), 1.0);
  } else if (kind == K_PRISM_GLINT) {
    rgba = vec4(drawPrismGlint(p, vParams.x, vParams.y), 1.0);
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
