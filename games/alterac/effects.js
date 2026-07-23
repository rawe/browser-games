// Effekt-System: kurzlebige Partikel über dem Spielfeld – Schadenszahlen,
// Funken, Geister auf dem Weg zum Friedhof, Respawn-Lichtsäulen, Rauch und
// die Erschütterung beim Fall eines Bosses. Übersetzt die typisierten
// Sim-Ereignisse in Partikel; keine Spiellogik.

import { edgePoint } from './map.js';

const TAU = Math.PI * 2;

export function createEffects(map) {
  const parts = [];
  let eventIndex = 0;
  let lastSim = null;
  let shake = 0;

  const rand = (a, b) => a + Math.random() * (b - a);
  const facColor = (f) => (f === 'blue' ? 'rgba(140,190,255,0.95)' : 'rgba(255,150,120,0.95)');

  function resolve(where) {
    if (where.node != null) {
      const n = map.nodes[where.node];
      return { x: n.x, y: n.y };
    }
    return edgePoint(map, where.edge.a, where.edge.b, where.edge.frac);
  }

  // Partikel mit negativem Alter starten verzögert.
  function push(p) {
    parts.push({ ...p, age: p.delay ? -p.delay : 0 });
  }

  function sparks(x, y, color, count = 8, speed = 60) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const v = speed * rand(0.35, 1.25);
      push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 22,
        life: rand(0.3, 0.65),
        size: rand(1, 2.4),
        color,
        grav: 170,
      });
    }
  }

  function damageNumber(x, y, amount, opts = {}) {
    push({
      kind: 'text',
      x: x + rand(-16, 16),
      y: y - 16,
      vx: rand(-8, 8),
      vy: -30,
      life: 1.0,
      text: `-${Math.max(1, Math.round(amount))}`,
      size: opts.big ? 16 : 12,
      color: opts.color ?? '#ffd76a',
    });
  }

  function ring(x, y, color, maxR = 34, life = 0.55, width = 3, delay = 0) {
    push({ kind: 'ring', x, y, maxR, life, width, color, delay });
  }

  function wisp(x, y, tx, ty) {
    push({ kind: 'wisp', sx: x, sy: y, tx, ty, life: 1.5 });
  }

  function beam(x, y) {
    push({ kind: 'beam', x, y, life: 1.0 });
    for (let i = 0; i < 10; i++) {
      push({
        kind: 'spark',
        x: x + rand(-10, 10),
        y: y + rand(-2, 8),
        vx: rand(-4, 4),
        vy: rand(-55, -30),
        life: rand(0.5, 1.0),
        size: rand(1, 2.2),
        color: 'rgba(170,225,255,0.9)',
        grav: 0,
        delay: rand(0, 0.25),
      });
    }
  }

  function puff(x, y, color, size, life = 0.6, vy = -12) {
    push({ kind: 'puff', x, y, vx: rand(-6, 6), vy, life, size, grow: size * 1.6, color });
  }

  function smoke(x, y) {
    puff(x, y, 'rgba(46,50,62,0.5)', rand(4, 8), rand(1.2, 2), rand(-22, -12));
  }

  function snowKick(x, y) {
    puff(x, y, 'rgba(220,232,248,0.35)', rand(2, 3.5), rand(0.3, 0.5), -6);
  }

  function bossFall(x, y) {
    shake = 1;
    push({ kind: 'flash', x, y, life: 0.45, size: 130 });
    ring(x, y, 'rgba(255,200,120,0.9)', 90, 0.7, 5);
    ring(x, y, 'rgba(255,240,200,0.8)', 130, 0.9, 3, 0.15);
    sparks(x, y, 'rgba(255,190,90,0.95)', 42, 170);
    for (let i = 0; i < 8; i++) smoke(x + rand(-18, 18), y + rand(-14, 6));
  }

  // Flächen-Gegenschlag des Bosses: eine schnell aufreißende Schockwelle in der
  // Fraktionsfarbe des Fürsten samt Funkenkranz – die Schadenszahlen an den
  // getroffenen Einheiten kommen wie gewohnt über die einzelnen `damage`-Ereignisse.
  function bossNova(x, y, color) {
    shake = Math.max(shake, 0.3);
    ring(x, y, color, 62, 0.55, 5);
    ring(x, y, 'rgba(255,215,150,0.7)', 92, 0.72, 3, 0.08);
    sparks(x, y, color, 18, 120);
  }

  // Turmsturz: kleiner als der Boss-Fall, aber deutlich – Einsturzstaub inklusive.
  function towerFall(x, y) {
    shake = Math.max(shake, 0.55);
    push({ kind: 'flash', x, y, life: 0.4, size: 80 });
    ring(x, y, 'rgba(255,200,120,0.9)', 58, 0.6, 4);
    ring(x, y, 'rgba(255,240,200,0.75)', 88, 0.8, 2.5, 0.12);
    sparks(x, y, 'rgba(255,190,90,0.95)', 26, 130);
    for (let i = 0; i < 7; i++) smoke(x + rand(-14, 14), y + rand(-12, 8));
  }

  // Neue Sim-Ereignisse seit dem letzten Aufruf in Partikel übersetzen.
  // Ein Simulationswechsel (Revanche/Planung) setzt alles zurück.
  function consume(sim) {
    if (sim !== lastSim) {
      parts.length = 0;
      eventIndex = 0;
      shake = 0;
      lastSim = sim;
    }
    if (!sim) return;
    const evs = sim.events;
    for (; eventIndex < evs.length; eventIndex++) {
      const ev = evs[eventIndex];
      const p = resolve(ev.where);
      if (ev.type === 'damage') {
        damageNumber(p.x, p.y, ev.amount, {
          big: ev.boss || ev.tower,
          color: ev.boss ? '#ffb14e' : ev.tower ? '#dfe6f2' : '#ffd76a',
        });
        sparks(p.x, p.y - 4, facColor(ev.faction), ev.tower ? 7 : 5, 55);
      } else if (ev.type === 'bossAoe') {
        bossNova(p.x, p.y, facColor(ev.faction));
      } else if (ev.type === 'towerFight') {
        ring(p.x, p.y, facColor(ev.faction), 30, 0.5, 2.5);
      } else if (ev.type === 'towerDown') {
        towerFall(p.x, p.y);
      } else if (ev.type === 'combatStart') {
        ring(p.x, p.y, 'rgba(255,150,110,0.8)', 34, 0.5, 3);
        sparks(p.x, p.y, 'rgba(255,230,180,0.9)', 12, 90);
      } else if (ev.type === 'death') {
        puff(p.x, p.y, 'rgba(200,215,235,0.4)', 7, 0.8);
        // Ohne kontrollierten Friedhof verweht der Geist an Ort und Stelle.
        const gy = ev.graveyard ? map.nodes[ev.graveyard] : null;
        if (gy) wisp(p.x, p.y - 6, gy.x, gy.y - 10);
      } else if (ev.type === 'captureStart') {
        ring(p.x, p.y, facColor(ev.faction), 26, 0.6, 2.5);
      } else if (ev.type === 'graveyardCaptured') {
        ring(p.x, p.y, facColor(ev.faction), 44, 0.7, 4);
        sparks(p.x, p.y - 6, facColor(ev.faction), 16, 90);
        beam(p.x, p.y);
      } else if (ev.type === 'respawn') {
        beam(p.x, p.y);
      } else if (ev.type === 'bossDown') {
        bossFall(p.x, p.y);
      }
    }
  }

  function draw(ctx, dt) {
    shake = Math.max(0, shake - dt * 1.8);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.age += dt;
      if (p.age < 0) continue;
      if (p.age >= p.life) {
        parts.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      const fade = 1 - k;
      ctx.save();
      if (p.kind === 'spark') {
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * (1 - k * 0.5), 0, TAU);
        ctx.fill();
      } else if (p.kind === 'puff') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = fade * 0.9;
        const r = p.size + p.grow * k;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'text') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 14 * dt;
        const popIn = Math.min(1, p.age / 0.12);
        const size = p.size * (0.6 + 0.4 * popIn);
        ctx.globalAlpha = k > 0.55 ? (1 - k) / 0.45 : 1;
        ctx.font = `800 ${size}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10,8,4,0.9)';
        ctx.strokeText(p.text, p.x, p.y);
        ctx.fillStyle = p.color;
        ctx.fillText(p.text, p.x, p.y);
      } else if (p.kind === 'ring') {
        const r = p.maxR * (1 - fade * fade);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fade;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = p.width * fade + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, TAU);
        ctx.stroke();
      } else if (p.kind === 'beam') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fade;
        const w = 16 * (1 - k * 0.5);
        const g = ctx.createLinearGradient(p.x - w, 0, p.x + w, 0);
        g.addColorStop(0, 'rgba(150,215,255,0)');
        g.addColorStop(0.5, 'rgba(190,235,255,0.55)');
        g.addColorStop(1, 'rgba(150,215,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(p.x - w, p.y - 72, w * 2, 78);
      } else if (p.kind === 'wisp') {
        const e = k * k * (3 - 2 * k);
        const wx = p.sx + (p.tx - p.sx) * e + Math.sin(p.age * 7) * 5;
        const wy = p.sy + (p.ty - p.sy) * e - Math.sin(Math.PI * e) * 26;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
        const g = ctx.createRadialGradient(wx, wy, 0, wx, wy, 9);
        g.addColorStop(0, 'rgba(200,240,255,0.9)');
        g.addColorStop(0.4, 'rgba(150,215,255,0.5)');
        g.addColorStop(1, 'rgba(150,215,255,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(wx, wy, 9, 0, TAU);
        ctx.fill();
      } else if (p.kind === 'flash') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = fade;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
        g.addColorStop(0, 'rgba(255,235,190,0.8)');
        g.addColorStop(1, 'rgba(255,180,90,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }
  }

  return {
    consume,
    draw,
    smoke,
    snowKick,
    get shake() {
      return shake;
    },
  };
}
