// Klang per Web Audio: Motorbrummen plus kurze Synth-Effekte. Kein Sample-Download.

export function createAudio() {
  let ctx = null;
  let engineOsc = null;
  let engineGain = null;
  let muted = false;

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return false;
    }
    engineOsc = ctx.createOscillator();
    engineOsc.type = 'sawtooth';
    engineOsc.frequency.value = 60;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0;
    engineOsc.connect(filter).connect(engineGain).connect(ctx.destination);
    engineOsc.start();
    return true;
  }

  function blip(freq, dur, type = 'square', vol = 0.15, slide = 0) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  }

  function noise(dur, vol = 0.3, cutoff = 900) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(filter).connect(g).connect(ctx.destination);
    src.start(t);
  }

  return {
    unlock() { ensure(); if (ctx?.state === 'suspended') ctx.resume(); },
    setMuted(m) { muted = m; if (engineGain) engineGain.gain.value = 0; },
    isMuted: () => muted,

    engine(speedRatio, active) {
      if (!ctx || muted || !engineOsc) return;
      engineOsc.frequency.value = 55 + speedRatio * 210;
      engineGain.gain.value = active ? 0.05 + speedRatio * 0.06 : 0;
    },
    engineOff() { if (engineGain) engineGain.gain.value = 0; },

    fire() { blip(880, 0.25, 'square', 0.12, -700); noise(0.15, 0.15, 2400); },
    explosion() { noise(0.6, 0.4, 700); blip(90, 0.5, 'triangle', 0.2, -60); },
    hit() { noise(0.15, 0.2, 1200); },
    countdown(final) { blip(final ? 880 : 440, final ? 0.4 : 0.15, 'square', 0.15); },
    cash() { blip(1200, 0.08, 'square', 0.1); setTimeout(() => blip(1600, 0.12, 'square', 0.1), 90); },
  };
}
