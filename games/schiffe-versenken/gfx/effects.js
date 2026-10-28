// Teilcheneffekte eines Bretts: Granaten im Flug, Fontänen, Explosionen,
// Feuer und Rauch. Gezeichnet wird mit wenigen vorgerechneten Leuchtbildern,
// die nur noch skaliert und eingefärbt kopiert werden – Verläufe pro
// Teilchen wären auf dem Handy zu teuer.

const sprites = {};

function glowSprite(name, stops) {
  if (sprites[name]) return sprites[name];
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [at, color] of stops) g.addColorStop(at, color);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  sprites[name] = canvas;
  return canvas;
}

const FIRE = () => glowSprite('fire', [[0, 'rgba(255,250,210,1)'], [0.25, 'rgba(255,190,70,0.95)'], [0.6, 'rgba(240,80,20,0.45)'], [1, 'rgba(160,30,0,0)']]);
const FLASH = () => glowSprite('flash', [[0, 'rgba(255,255,240,1)'], [0.3, 'rgba(255,230,160,0.7)'], [1, 'rgba(255,160,60,0)']]);
const SMOKE = () => glowSprite('smoke', [[0, 'rgba(70,72,78,0.85)'], [0.55, 'rgba(55,58,64,0.45)'], [1, 'rgba(40,42,48,0)']]);
const STEAM = () => glowSprite('steam', [[0, 'rgba(235,245,255,0.9)'], [0.5, 'rgba(210,230,245,0.4)'], [1, 'rgba(200,220,240,0)']]);

export function createEffects() {
  /** @type {object[]} */
  let parts = [];
  let shells = [];
  let shake = 0;

  const rand = (a, b) => a + Math.random() * (b - a);

  function add(p) {
    parts.push({ z: 0, vz: 0, vx: 0, vy: 0, grow: 0, drag: 0, gravity: 0, rot: 0, spin: 0, age: 0, ...p });
  }

  const api = {
    get busy() { return parts.length > 0 || shells.length > 0; },
    get shake() { return shake; },

    clear() { parts = []; shells = []; shake = 0; },

    /**
     * Eine Granate von `from` nach `to` (Brettkoordinaten). Das Versprechen
     * erfüllt sich beim Einschlag.
     */
    shell(from, to, cell, duration = 0.62) {
      return new Promise((resolve) => {
        shells.push({ from, to, cell, t: 0, duration, trail: [], resolve });
      });
    },

    splash(x, y, cell) {
      for (let i = 0; i < 26; i += 1) {
        const a = rand(0, Math.PI * 2);
        const s = rand(0.2, 1.3) * cell;
        add({ kind: 'drop', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(1.8, 4.2) * cell, gravity: 9 * cell, life: rand(0.6, 1.1), size: rand(0.04, 0.09) * cell });
      }
      for (let i = 0; i < 3; i += 1) {
        add({ kind: 'ring', x, y, life: 0.9 + i * 0.25, size: cell * 0.15, grow: cell * (0.9 + i * 0.35), width: cell * 0.06 });
      }
      for (let i = 0; i < 5; i += 1) {
        add({ kind: 'steam', x: x + rand(-0.15, 0.15) * cell, y: y + rand(-0.15, 0.15) * cell, life: rand(0.7, 1.2), size: cell * 0.35, grow: cell * 0.6 });
      }
      shake = Math.max(shake, cell * 0.04);
    },

    explosion(x, y, cell, big = false) {
      const k = big ? 1.6 : 1;
      add({ kind: 'flash', x, y, life: 0.28, size: cell * 1.4 * k, grow: cell * 1.8 * k });
      add({ kind: 'ring', x, y, life: 0.5, size: cell * 0.3, grow: cell * 2.6 * k, width: cell * 0.08, color: '255,220,160' });
      for (let i = 0; i < 22 * k; i += 1) {
        const a = rand(0, Math.PI * 2);
        const s = rand(0.3, 1.6) * cell * k;
        add({ kind: 'fire', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, drag: 2.6, life: rand(0.35, 0.8), size: rand(0.35, 0.7) * cell * k, grow: -0.2 * cell });
      }
      for (let i = 0; i < 14 * k; i += 1) {
        const a = rand(0, Math.PI * 2);
        const s = rand(1.2, 3.4) * cell;
        add({ kind: 'debris', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: rand(1.5, 4) * cell, gravity: 10 * cell, drag: 0.8, life: rand(0.6, 1.1), size: rand(0.04, 0.09) * cell, spin: rand(-12, 12) });
      }
      for (let i = 0; i < 10 * k; i += 1) {
        add({ kind: 'smoke', x: x + rand(-0.3, 0.3) * cell, y: y + rand(-0.3, 0.3) * cell, vx: rand(-0.2, 0.2) * cell, vy: rand(-0.5, -0.1) * cell, life: rand(1.2, 2.2), size: cell * rand(0.3, 0.5), grow: cell * 0.9, delay: rand(0.05, 0.3) });
      }
      shake = Math.max(shake, cell * (big ? 0.28 : 0.14));
    },

    /** Leises Nachglühen eines brennenden Treffers – Rauchfahne und Funken. */
    smolder(x, y, cell, dark) {
      add({ kind: 'smoke', x: x + rand(-0.15, 0.15) * cell, y: y - cell * 0.25 + rand(-0.1, 0.1) * cell, vx: rand(0.05, 0.25) * cell, vy: rand(-0.45, -0.2) * cell, life: rand(1.4, 2.4), size: cell * 0.18, grow: cell * (dark ? 0.75 : 0.55), alpha: dark ? 0.75 : 0.5 });
      if (!dark && Math.random() < 0.35) {
        add({ kind: 'spark', x: x + rand(-0.15, 0.15) * cell, y, vx: rand(-0.3, 0.3) * cell, vy: rand(-1.2, -0.5) * cell, life: rand(0.4, 0.8), size: cell * 0.03 });
      }
    },

    update(dt) {
      shake *= Math.pow(0.002, dt);
      if (shake < 0.05) shake = 0;

      for (const s of shells) {
        s.t += dt / s.duration;
        const p = shellPos(s, Math.min(1, s.t));
        s.trail.push(p);
        if (s.trail.length > 10) s.trail.shift();
      }
      const landed = shells.filter((s) => s.t >= 1);
      shells = shells.filter((s) => s.t < 1);
      for (const s of landed) s.resolve();

      for (const p of parts) {
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.age += dt;
        const drag = Math.exp(-p.drag * dt);
        p.vx *= drag;
        p.vy *= drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.gravity) {
          p.vz -= p.gravity * dt;
          p.z = Math.max(0, p.z + p.vz * dt);
        }
        p.size = Math.max(0, p.size + p.grow * dt);
        p.rot += p.spin * dt;
      }
      parts = parts.filter((p) => p.age < p.life && !(p.gravity && p.z <= 0 && p.age > 0.1 && p.kind === 'debris'));
    },

    /** Unter den Schiffen: Ringe auf dem Wasser. */
    drawUnder(ctx) {
      for (const p of parts) {
        if (p.kind !== 'ring' || p.delay > 0) continue;
        const k = 1 - p.age / p.life;
        ctx.strokeStyle = `rgba(${p.color ?? '220,240,255'},${0.55 * k})`;
        ctx.lineWidth = p.width * k + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.stroke();
      }
    },

    /** Über den Schiffen: alles, was fliegt, brennt oder qualmt. */
    drawOver(ctx) {
      for (const p of parts) {
        if (p.delay > 0) continue;
        const k = 1 - p.age / p.life;
        switch (p.kind) {
          case 'smoke':
            blit(ctx, SMOKE(), p.x, p.y, p.size, (p.alpha ?? 0.7) * Math.min(1, k * 1.6) * Math.min(1, p.age * 6));
            break;
          case 'steam':
            blit(ctx, STEAM(), p.x, p.y, p.size, 0.6 * k);
            break;
          default:
            break;
        }
      }
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        if (p.delay > 0) continue;
        const k = 1 - p.age / p.life;
        if (p.kind === 'fire') blit(ctx, FIRE(), p.x, p.y, p.size, k);
        else if (p.kind === 'flash') blit(ctx, FLASH(), p.x, p.y, p.size, k * k);
        else if (p.kind === 'spark') {
          ctx.fillStyle = `rgba(255,${180 + 60 * k | 0},90,${k})`;
          ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
        }
      }
      ctx.restore();
      for (const p of parts) {
        if (p.delay > 0) continue;
        const k = 1 - p.age / p.life;
        if (p.kind === 'drop') {
          const r = p.size * (1 + p.z * 0.004);
          ctx.fillStyle = `rgba(235,248,255,${0.85 * k})`;
          ctx.beginPath();
          ctx.arc(p.x, p.y - p.z * 0.35, r, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === 'debris') {
          ctx.save();
          ctx.translate(p.x, p.y - p.z * 0.35);
          ctx.rotate(p.rot);
          ctx.fillStyle = `rgba(30,24,20,${k})`;
          ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
          ctx.restore();
        }
      }
      for (const s of shells) drawShell(ctx, s);
    },
  };
  return api;
}

function shellPos(s, t) {
  const e = t;
  const x = s.from.x + (s.to.x - s.from.x) * e;
  const y = s.from.y + (s.to.y - s.from.y) * e;
  const h = Math.sin(Math.PI * e) * s.cell * 2.2;
  return { x, y, h };
}

function drawShell(ctx, s) {
  const t = Math.min(1, s.t);
  const p = shellPos(s, t);
  // Schatten auf dem Wasser, der zum Ziel hin schärfer wird
  ctx.fillStyle = `rgba(0,10,20,${0.15 + 0.3 * t})`;
  ctx.beginPath();
  ctx.ellipse(p.x, p.y, s.cell * 0.12, s.cell * 0.07, 0, 0, Math.PI * 2);
  ctx.fill();
  // Leuchtspur
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  s.trail.forEach((q, i) => {
    const k = (i + 1) / s.trail.length;
    blit(ctx, FIRE(), q.x, q.y - q.h, s.cell * 0.28 * k * (1 + q.h / s.cell * 0.15), 0.5 * k);
  });
  blit(ctx, FLASH(), p.x, p.y - p.h, s.cell * 0.45 * (1 + p.h / s.cell * 0.2), 0.9);
  ctx.restore();
}

function blit(ctx, image, x, y, size, alpha) {
  if (alpha <= 0 || size <= 0) return;
  ctx.globalAlpha = Math.min(1, alpha);
  ctx.drawImage(image, x - size, y - size, size * 2, size * 2);
  ctx.globalAlpha = 1;
}

export { FIRE as fireSprite, SMOKE as smokeSprite, blit };
