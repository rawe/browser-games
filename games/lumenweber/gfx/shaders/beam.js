// Der Lichtfaden.
//
// Geometrisch ist er nur eine Handvoll Rechtecke (siehe `createBeamBuffer`).
// Alles Aussehen entsteht hier: Der Fragment-Shader kennt zu jedem Pixel den
// senkrechten Abstand zur Mittellinie und die bis dahin zurückgelegte
// Bogenlänge. Aus dem Abstand wird das Querprofil (weißer Kern, farbiger Hof),
// aus der Bogenlänge der Energiefluss in Laufrichtung.
//
// Gezeichnet wird additiv. Wo der Faden sich selbst kreuzt, summieren sich die
// Rechtecke von allein zu einem hellen Knoten – genau der gewünschte Effekt,
// ohne Sonderbehandlung.

import { HEAD } from './common.js';

export const BEAM_VERT = `${HEAD}
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec2 aLocal;   // u längs, v quer (CSS-Pixel)
layout(location = 2) in vec4 aMeta;    // Segmentlänge · Bogenlänge · Halbbreite · Kraft

uniform vec2 uCssRes;

out vec2 vLocal;
flat out vec4 vMeta;

void main() {
  vLocal = aLocal;
  vMeta = aMeta;
  vec2 clip = (aPos / uCssRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

export const BEAM_FRAG = `${HEAD}
in vec2 vLocal;
flat in vec4 vMeta;
out vec4 outColor;

uniform float uTime;
uniform float uCalm;
uniform float uCore;      // Radius des heißen Kerns in Pixeln
uniform float uHalo;      // Radius des farbigen Hofs in Pixeln
uniform float uCell;
uniform vec3 uWarm;       // Farbe knapp neben dem Kern
uniform vec3 uCool;       // Farbe des weiten Hofs
uniform float uReveal;    // bis hierher ist der Faden gewebt (Bogenlänge px)
uniform float uWave;      // Position der Siegeswelle (px), < 0 = aus
uniform float uGain;

void main() {
  float segLen = vMeta.x;
  float arc0 = vMeta.y;
  float energy = vMeta.w;
  float u = vLocal.x;
  float v = vLocal.y;

  // Abstand zur Kapsel um die Strecke [0, segLen].
  float over = max(abs(u - segLen * 0.5) - segLen * 0.5, 0.0);
  float d = length(vec2(over, v));

  float s = arc0 + clamp(u, 0.0, segLen);
  float t = mix(uTime, 0.0, uCalm);

  // Querprofil: drei ineinandergelegte Gauß-Kurven. Der Kern bleibt bewusst
  // schmal – erst dadurch bleibt er als Faden lesbar und wird nicht zum Balken.
  float inner = exp(-(d * d) / (uCore * uCore));
  float mid = exp(-(d * d) / (uCore * uCore * 6.0));
  float outer = exp(-(d * d) / (uHalo * uHalo));

  // Energiepakete, die sichtbar in Laufrichtung wandern.
  float phase = s / (uCell * 0.85) - t * 1.9;
  float flow = 0.5 + 0.5 * sin(phase * 6.2831853);
  float packet = pow(flow, 7.0);
  float pulse = mix(1.0, 0.82 + 0.30 * flow, 1.0 - uCalm);

  // Der Faden wird beim Umlenken neu gewebt: eine schnelle Front läuft von der
  // Quelle nach vorn. Ohne sie wirkt jeder Zug wie ein hartes Umspringen.
  // Vor der Front bleibt ein schwacher Rest stehen: Der Verlauf ist dadurch
  // jederzeit ablesbar, es sieht nur nicht fertig gewoben aus.
  float woven = mix(0.18, 1.0, smoothstep(uReveal, uReveal - uCell * 0.9, s));
  float front = exp(-pow((s - uReveal) / (uCell * 0.5), 2.0)) * step(0.001, uReveal);

  // Siegeswelle: ein heller Bauch, der einmal den ganzen Faden entlangläuft.
  float wave = uWave < 0.0 ? 0.0 : exp(-pow((s - uWave) / (uCell * 1.1), 2.0));

  float boost = 1.0 + wave * 1.5 + front * 1.6;

  vec3 col = vec3(1.0) * inner * (1.15 + 0.85 * packet) * pulse;
  col += uWarm * mid * 0.55;
  col += uCool * outer * 0.34;
  col += vec3(1.0, 0.94, 0.80) * wave * (inner * 1.2 + mid * 0.6);

  outColor = vec4(col * energy * woven * boost * uGain, 1.0);
}`;
