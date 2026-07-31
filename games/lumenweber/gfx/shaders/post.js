// Nachbearbeitung: Bloom und Bildabschluss.
//
// Der Ablauf ist bewusst schmal gehalten, weil er auf dem Telefon jedes Bild
// laufen muss:
//
//   Szene (voll)  →  Helligkeitsauszug (¼)  →  Unschärfe H/V (¼)
//                                           →  Verkleinern (⅛) → Unschärfe H/V (⅛)
//   Szene + beide Bloom-Stufen  →  Belichtung, Vignette, Rauschkorn  →  Bild
//
// Zwei Bloom-Stufen statt einer: Die ¼-Stufe hält den Kern des Fadens scharf
// umrissen, die ⅛-Stufe liefert den weiten Schein, der den Raum füllt. Eine
// einzelne Stufe kann beides nicht gleichzeitig.

import { HEAD } from './common.js';

/**
 * Helligkeitsauszug mit gleichzeitigem Verkleinern.
 *
 * Die vier Abtastpunkte liegen auf halben Texeln der Quelle – dadurch ist das
 * Verkleinern schon ein 2×2-Mittel und flimmert nicht.
 */
export const BRIGHT_FRAG = `${HEAD}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uTexel;       // 1 / Quellauflösung
uniform float uThreshold;  // negativ = reines Verkleinern
uniform float uKnee;

vec3 tap(vec2 o) {
  return texture(uTex, vUv + o).rgb;
}

void main() {
  vec3 c = (tap(uTexel * vec2(-1.0, -1.0)) + tap(uTexel * vec2(1.0, -1.0))
          + tap(uTexel * vec2(-1.0, 1.0)) + tap(uTexel * vec2(1.0, 1.0))) * 0.25;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float w = smoothstep(uThreshold, uThreshold + uKnee, l);
  outColor = vec4(c * w, 1.0);
}`;

/**
 * Trennbare Gauß-Unschärfe, fünf Abtastungen je Richtung.
 *
 * Die Punkte liegen zwischen den Texeln, sodass die lineare Filterung der GPU
 * jeweils zwei Texel gratis mitmittelt – neun Texel Reichweite für fünf
 * Abtastungen.
 */
export const BLUR_FRAG = `${HEAD}
in vec2 vUv;
out vec4 outColor;
uniform sampler2D uTex;
uniform vec2 uDir;         // (1/breite, 0) oder (0, 1/höhe)

void main() {
  vec3 c = texture(uTex, vUv).rgb * 0.227027;
  c += (texture(uTex, vUv + uDir * 1.3846).rgb + texture(uTex, vUv - uDir * 1.3846).rgb) * 0.316216;
  c += (texture(uTex, vUv + uDir * 3.2308).rgb + texture(uTex, vUv - uDir * 3.2308).rgb) * 0.070270;
  outColor = vec4(c, 1.0);
}`;

export const COMPOSITE_FRAG = `${HEAD}
in vec2 vUv;
out vec4 outColor;

uniform sampler2D uScene;
uniform sampler2D uBloomNear;
uniform sampler2D uBloomFar;
uniform vec2 uPxRes;
uniform float uNear;
uniform float uFar;
uniform float uExposure;
uniform float uFlash;      // Siegesblitz
uniform float uTime;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec3 col = texture(uScene, vUv).rgb;
  col += texture(uBloomNear, vUv).rgb * uNear;
  col += texture(uBloomFar, vUv).rgb * uFar;

  col += vec3(0.80, 0.90, 1.0) * uFlash * 0.10;

  // Weiche Sättigung statt hartem Abschneiden: Lichter laufen sauber ins Weiß.
  col = 1.0 - exp(-col * uExposure);

  // Vignette hält den Blick auf dem Brett.
  vec2 q = vUv - 0.5;
  col *= 1.0 - dot(q, q) * 0.55;

  // Ein Hauch Rauschen gegen Streifenbildung in den weiten Farbverläufen.
  col += (hash12(gl_FragCoord.xy + fract(uTime) * 137.0) - 0.5) / 220.0;

  outColor = vec4(max(col, 0.0), 1.0);
}`;
