// Klang. Alles synthetisch über die Web Audio API – keine Dateien, kein Laden.
//
// Der AudioContext wird erst bei der ersten Nutzereingabe erzeugt: Browser
// (vor allem iOS) starten ihn sonst gar nicht erst.

let ctx = null;
let master = null;
let muted = false;

function ensure() {
  if (ctx) return ctx;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  master = ctx.createGain();
  master.gain.value = 0.28;
  master.connect(ctx.destination);
  return ctx;
}

/** Nach dem ersten Tipp aufrufen – entsperrt die Wiedergabe auf iOS. */
export function unlockAudio() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export const setMuted = (value) => { muted = value; if (master) master.gain.value = value ? 0 : 0.28; };
export const isMuted = () => muted;

function tone({ freq, dur = 0.18, type = 'sine', gain = 0.5, slide = 0, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const env = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
  env.gain.setValueAtTime(0.0001, t0);
  env.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

/** Spiegel gedreht – kurzes, trockenes Klicken mit Glasanteil. */
export const playTurn = () => {
  tone({ freq: 880, dur: 0.09, type: 'triangle', gain: 0.35, slide: -240 });
  tone({ freq: 2400, dur: 0.05, type: 'sine', gain: 0.12 });
};

/** Ein Prisma rastet in eine Fassung ein – heller, mit aufsteigendem Glas. */
export const playPlace = () => {
  tone({ freq: 620, dur: 0.12, type: 'triangle', gain: 0.3, slide: 420 });
  tone({ freq: 1860, dur: 0.09, type: 'sine', gain: 0.14, delay: 0.04 });
};

/** Ein Prisma wird wieder aus der Fassung genommen. */
export const playLift = () => {
  tone({ freq: 900, dur: 0.13, type: 'triangle', gain: 0.26, slide: -420 });
};

/** Ein Knoten ist neu aufgeleuchtet. */
export const playLit = (index = 0) =>
  tone({ freq: 523.25 * (1 + index * 0.25), dur: 0.35, type: 'sine', gain: 0.4 });

/** Ein Knoten ist erloschen. */
export const playUnlit = () => tone({ freq: 320, dur: 0.14, type: 'sine', gain: 0.18, slide: -120 });

/** Level gelöst. */
export const playWin = () => {
  [0, 0.11, 0.22, 0.36].forEach((delay, i) =>
    tone({ freq: [523.25, 659.25, 783.99, 1046.5][i], dur: 0.5, type: 'triangle', gain: 0.35, delay }));
};

/** Daneben getippt. */
export const playBlocked = () => tone({ freq: 180, dur: 0.08, type: 'square', gain: 0.1 });
