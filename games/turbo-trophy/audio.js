// Kurze Synth-Effekte per Web Audio – keine Samples, kein Download.
// Der AudioContext entsteht erst bei der ersten Nutzereingabe (Autoplay-Policy).

export function createAudio() {
  let ctx = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    return true;
  }

  /** Ein Oszillator-Ton mit exponentiellem Ausklingen. */
  function tone(type, from, to, duration, volume) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  return {
    unlock() {
      if (ensure() && ctx.state === 'suspended') ctx.resume();
    },
    setMuted(value) { muted = value; },
    isMuted: () => muted,

    fire() { tone('square', 950, 160, 0.2, 0.1); },
    explosion() { tone('sawtooth', 140, 28, 0.45, 0.22); },
    beep() { tone('square', 440, 0, 0.14, 0.09); },
    go() { tone('square', 880, 0, 0.35, 0.11); },
    cash() {
      tone('triangle', 620, 0, 0.1, 0.1);
      setTimeout(() => tone('triangle', 930, 0, 0.16, 0.1), 80);
    },

    // Streckenelemente: kurz und klar unterscheidbar, damit man auch ohne
    // Blick auf die Strecke merkt, was gerade passiert ist.
    jump() { tone('triangle', 260, 780, 0.22, 0.1); },
    land() { tone('sine', 220, 90, 0.14, 0.09); },
    skid() { tone('sawtooth', 320, 150, 0.3, 0.07); },
    gate() { tone('square', 300, 0, 0.12, 0.08); },
  };
}
