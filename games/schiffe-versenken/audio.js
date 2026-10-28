// Klang – vollständig synthetisiert, keine einzige Audiodatei.
//
// Abschuss, Pfeifen im Flug, Platschen, Explosion, Untergang. Web Audio darf
// erst nach einer Nutzergeste laufen, deshalb wird der Kontext beim ersten
// Tippen geweckt.

let ctx = null;
let enabled = true;
let noiseBuffer = null;

export function unlock() {
  if (!enabled) return;
  try {
    ctx ??= new (globalThis.AudioContext ?? globalThis.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  } catch {
    // Ohne Web Audio spielt das Spiel eben stumm.
    enabled = false;
  }
}

export const setEnabled = (value) => { enabled = value; if (value) unlock(); };
export const isEnabled = () => enabled;

const ready = () => enabled && ctx && ctx.state === 'running';

function noise() {
  if (noiseBuffer) return noiseBuffer;
  const length = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

/** Gefiltertes Rauschen mit Hüllkurve – Grundstoff für Wasser und Feuer. */
function burst({ dur, gain, type = 'lowpass', freq, to = freq, q = 0.8, delay = 0, attack = 0.005 }) {
  if (!ready()) return;
  const start = ctx.currentTime + delay;
  const src = ctx.createBufferSource();
  src.buffer = noise();
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, start);
  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + dur);
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(filter).connect(amp).connect(ctx.destination);
  src.start(start, Math.random());
  src.stop(start + dur + 0.05);
}

function tone({ freq, to = freq, dur, type = 'sine', gain = 0.15, delay = 0, attack = 0.008 }) {
  if (!ready()) return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + attack);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

/** Abschuss und das fallende Pfeifen bis zum Einschlag. */
export function launch(flight = 0.6) {
  burst({ dur: 0.35, gain: 0.5, freq: 900, to: 120 });
  tone({ freq: 70, to: 38, dur: 0.3, gain: 0.35 });
  tone({ freq: 1500, to: 600, dur: flight, type: 'sine', gain: 0.035, delay: 0.08, attack: 0.15 });
}

export function splash() {
  burst({ dur: 0.7, gain: 0.35, type: 'bandpass', freq: 1800, to: 500, q: 0.6 });
  burst({ dur: 0.45, gain: 0.2, type: 'highpass', freq: 3000, to: 5000, delay: 0.05 });
  tone({ freq: 180, to: 90, dur: 0.25, gain: 0.12 });
}

export function explosion(big = false) {
  burst({ dur: big ? 1.6 : 1.0, gain: big ? 0.8 : 0.6, freq: 1600, to: 60 });
  tone({ freq: big ? 60 : 80, to: 28, dur: big ? 1.2 : 0.7, gain: big ? 0.6 : 0.45 });
  burst({ dur: 0.4, gain: 0.25, type: 'highpass', freq: 2500, to: 900, delay: 0.02 });
}

/** Zum Versenken: das Ächzen des Rumpfs und ein langes Gurgeln. */
export function sink() {
  tone({ freq: 140, to: 45, dur: 1.4, type: 'sawtooth', gain: 0.05, delay: 0.5, attack: 0.3 });
  for (let i = 0; i < 6; i += 1) {
    tone({ freq: 300 + Math.random() * 400, to: 120, dur: 0.12, gain: 0.04, delay: 0.7 + i * 0.13 + Math.random() * 0.05 });
  }
}

export function click() {
  tone({ freq: 880, to: 660, dur: 0.05, type: 'triangle', gain: 0.06 });
}

export function place() {
  burst({ dur: 0.18, gain: 0.18, type: 'bandpass', freq: 900, to: 400, q: 1.2 });
  tone({ freq: 220, to: 160, dur: 0.08, type: 'triangle', gain: 0.08 });
}

export function deny() {
  tone({ freq: 200, to: 150, dur: 0.15, type: 'square', gain: 0.05 });
}

export function turn() {
  tone({ freq: 660, dur: 0.12, type: 'triangle', gain: 0.07 });
  tone({ freq: 880, dur: 0.18, type: 'triangle', gain: 0.07, delay: 0.1 });
}

export function win() {
  [523, 659, 784, 1047, 784, 1047, 1319].forEach((freq, i) =>
    tone({ freq, dur: 0.35, type: 'triangle', gain: 0.1, delay: i * 0.12 }));
}

export function lose() {
  [392, 330, 262, 196].forEach((freq, i) => tone({ freq, dur: 0.45, type: 'triangle', gain: 0.1, delay: i * 0.16 }));
}

/** Kurzer Rüttler auf Geräten, die das können (Android). */
export function rumble(pattern) {
  if (!enabled) return;
  try { navigator.vibrate?.(pattern); } catch { /* egal */ }
}
