// Klang – vollständig synthetisiert, keine einzige Audiodatei.
//
// Jeder Zug bekommt sein Geräusch: ein trockener Anschlag beim Setzen, ein
// härterer beim Schlagen, ein doppelter bei der Rochade, ein kurzer Akkord
// beim Schach. Web Audio darf erst nach einer Nutzergeste laufen, deshalb wird
// der Kontext beim ersten Tippen geweckt.

let ctx = null;
let enabled = true;

/** Nach der ersten Nutzergeste aufrufen – vorher lehnt der Browser ab. */
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

/**
 * Ein Ton mit Hüllkurve.
 *
 * @param {{freq:number, to?:number, dur:number, type?:OscillatorType,
 *          gain?:number, delay?:number}} spec
 */
function tone({ freq, to = freq, dur, type = 'triangle', gain = 0.16, delay = 0 }) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (to !== freq) osc.frequency.exponentialRampToValueAtTime(to, start + dur);
  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.006);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(amp).connect(ctx.destination);
  osc.start(start);
  osc.stop(start + dur + 0.02);
}

/** Kurzes Rauschen – das Holz-auf-Holz beim Aufsetzen einer Figur. */
function knock(gain = 0.2, delay = 0, bright = 1) {
  if (!enabled || !ctx || ctx.state !== 'running') return;
  const start = ctx.currentTime + delay;
  const length = Math.floor(ctx.sampleRate * 0.05);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  }
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 900 * bright;
  filter.Q.value = 1.1;
  const amp = ctx.createGain();
  amp.gain.value = gain;
  source.connect(filter).connect(amp).connect(ctx.destination);
  source.start(start);
}

export const move = () => { knock(0.18); tone({ freq: 220, to: 160, dur: 0.06, gain: 0.07 }); };
export const capture = () => { knock(0.3, 0, 1.5); tone({ freq: 150, to: 90, dur: 0.12, gain: 0.12 }); };
export const castle = () => { knock(0.16); knock(0.2, 0.09); };
export const check = () => {
  tone({ freq: 660, dur: 0.1, gain: 0.1, type: 'square' });
  tone({ freq: 880, dur: 0.14, gain: 0.08, type: 'square', delay: 0.07 });
};
export const promote = () => {
  [523, 659, 784, 1047].forEach((freq, i) => tone({ freq, dur: 0.2, gain: 0.09, delay: i * 0.05 }));
};
export const win = () => {
  [523, 659, 784, 1047, 1319].forEach((freq, i) => tone({ freq, dur: 0.4, gain: 0.1, delay: i * 0.09 }));
};
export const draw = () => {
  [440, 415, 392].forEach((freq, i) => tone({ freq, dur: 0.35, gain: 0.09, delay: i * 0.12 }));
};
export const lose = () => {
  [392, 330, 262, 196].forEach((freq, i) => tone({ freq, dur: 0.45, gain: 0.1, delay: i * 0.11 }));
};
