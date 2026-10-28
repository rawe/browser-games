// Feuerwerk für den Sieg – ein eigener kleiner Teilchenhimmel hinter dem
// Ergebnis. Läuft nur, solange der Ergebnisbildschirm offen ist.

export function createFireworks(canvas) {
  const ctx = canvas.getContext('2d');
  let rockets = [];
  let sparks = [];
  let running = false;
  let next = 0;
  let last = 0;
  const colors = ['255,210,110', '255,120,90', '120,220,255', '160,255,170', '255,160,230'];

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function launch() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    rockets.push({ x: w * (0.15 + Math.random() * 0.7), y: h, vx: (Math.random() - 0.5) * 60, vy: -h * (0.9 + Math.random() * 0.35), color: colors[(Math.random() * colors.length) | 0], fuse: 0.75 + Math.random() * 0.4 });
  }

  function burst(r) {
    const n = 46;
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const s = 90 + Math.random() * 110;
      sparks.push({ x: r.x, y: r.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1 + Math.random() * 0.6, age: 0, color: r.color });
    }
  }

  return {
    start() { running = true; resize(); rockets = []; sparks = []; next = 0; last = 0; },
    stop() { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); },
    get running() { return running; },
    frame(now) {
      if (!running) return;
      const t = now / 1000;
      const dt = last ? Math.min(0.05, t - last) : 0.016;
      last = t;
      next -= dt;
      if (next <= 0) { launch(); next = 0.35 + Math.random() * 0.6; }
      ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
      ctx.globalCompositeOperation = 'lighter';
      rockets = rockets.filter((r) => {
        r.fuse -= dt;
        r.vy += 320 * dt;
        r.x += r.vx * dt;
        r.y += r.vy * dt;
        ctx.fillStyle = `rgba(${r.color},0.9)`;
        ctx.fillRect(r.x - 1.5, r.y - 1.5, 3, 3);
        if (r.fuse <= 0) { burst(r); return false; }
        return true;
      });
      sparks = sparks.filter((s) => {
        s.age += dt;
        s.vx *= Math.exp(-1.6 * dt);
        s.vy = s.vy * Math.exp(-1.6 * dt) + 60 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const k = 1 - s.age / s.life;
        ctx.fillStyle = `rgba(${s.color},${k})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.2 + k * 1.6, 0, Math.PI * 2);
        ctx.fill();
        return s.age < s.life;
      });
      ctx.globalCompositeOperation = 'source-over';
    },
  };
}
