// GLSL-Bausteine, die mehrere Programme teilen.
//
// Zusammengesetzt wird per Template-String – so steht jede Funktion genau
// einmal im Quelltext und der Compiler bekommt trotzdem vollständige Shader.

export const HEAD = `#version 300 es
precision highp float;
`;

/**
 * Vollbild-Dreieck ohne Attribute.
 *
 * Die Eckpunkte kommen aus `gl_VertexID`; das spart einen Puffer und liefert
 * gleich passende Texturkoordinaten (0…1 innerhalb des Bildschirms).
 */
export const FULLSCREEN_VERT = `${HEAD}
out vec2 vUv;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/** Wertrauschen und daraus gefaltetes fBm – Grundlage für Nebel und Staub. */
export const NOISE = `
float hash21(vec2 p) {
  p = fract(p * vec2(127.31, 311.7));
  p += dot(p, p + 34.53);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * vnoise(p);
    p = p * 2.07 + vec2(19.3, 7.1);
    a *= 0.5;
  }
  return v;
}`;

/**
 * Vorzeichenbehaftete Abstandsfunktionen.
 *
 * `fill` steht bewusst dabei: `smoothstep` mit fallenden Kanten ist laut
 * GLSL-Spezifikation undefiniert, und genau das braucht man beim Füllen einer
 * SDF ständig. Einmal richtig herum geschrieben, überall benutzt.
 */
export const SDF = `
float sdBox(vec2 p, vec2 b) {
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

float sdRound(vec2 p, vec2 b, float r) {
  return sdBox(p, b - r) - r;
}

float fill(float d, float aa) {
  return 1.0 - smoothstep(-aa, aa, d);
}

/** Schmaler Streifen um die Kontur einer SDF. */
float stroke(float d, float w, float aa) {
  return 1.0 - smoothstep(w - aa, w + aa, abs(d));
}`;
