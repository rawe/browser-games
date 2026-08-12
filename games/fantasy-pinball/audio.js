// Kleine ereignisbasierte Audio-Schicht. Alle Platzhalter werden synthetisch
// erzeugt; später können die Methoden Samples oder einen Mixer ansteuern.

export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (context) return context;
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return null;
    context = new AudioContext();
    master = context.createGain();
    master.gain.value = 0.22;
    master.connect(context.destination);
    return context;
  }

  function tone(frequency, duration, type = 'sine', slide = 0, delay = 0) {
    const ctx = ensure();
    if (!ctx || muted) return;
    const start = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    if (slide) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, frequency + slide), start + duration);
    envelope.gain.setValueAtTime(0.0001, start);
    envelope.gain.exponentialRampToValueAtTime(0.7, start + 0.008);
    envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(envelope).connect(master);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.03);
  }

  return {
    unlock() { const ctx = ensure(); if (ctx?.state === 'suspended') ctx.resume(); },
    setMuted(value) { muted = Boolean(value); if (master) master.gain.value = muted ? 0 : 0.22; },
    isMuted: () => muted,
    handle(event) {
      if (event.type === 'bumperHit') tone(280, 0.12, 'square', 620);
      if (event.type === 'targetHit') tone(720, 0.1, 'triangle', -260);
      if (event.type === 'ballCollision') tone(145, 0.045, 'triangle', 45);
      if (event.type === 'rampEntered') tone(430, 0.2, 'sine', 540);
      if (event.type === 'boardChanged') {
        tone(392, 0.4, 'triangle', 390);
        tone(659, 0.45, 'sine', 390, 0.12);
      }
      if (event.type === 'ballDrained') tone(210, 0.45, 'sawtooth', -150);
      if (event.type === 'ballLaunched') tone(160, 0.14, 'triangle', 180);
    },
    flipper() { tone(105, 0.045, 'square', -30); },
    quest() { tone(523, 0.32, 'sine', 260); },
    spell() { tone(740, 0.38, 'triangle', 620); },
    environment() { tone(82, 0.6, 'sine', -35); },
  };
}
