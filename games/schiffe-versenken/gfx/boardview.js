// Ein Meer auf dem Bildschirm: Wasser, Raster, Schiffe, Schussmarken und
// Effekte. Kennt keine Regeln – was zu zeigen ist, setzt `main.js` über
// `set()`; Eingaben rechnet `cellAt()` in Felder um.

import { SIZE, COLS, xOf, yOf } from '../logic/rules.js';
import { MISS, HIT, WATER } from '../logic/board.js';
import { shipCells } from '../logic/fleet.js';
import { paintWater } from './water.js';
import { shipSprite, roundRect } from './ships.js';
import { createEffects, fireSprite, blit } from './effects.js';

const LOOKS = {
  own: { deep: '#06304a', shallow: '#0d5a78', glow: 1 },
  enemy: { deep: '#041526', shallow: '#0a3550', glow: 0.75 },
};

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{enemy?: boolean}} options
 */
export function createBoardView(canvas, { enemy = false } = {}) {
  const ctx = canvas.getContext('2d');
  const fx = createEffects();
  const look = enemy ? LOOKS.enemy : LOOKS.own;

  let dpr = 1;
  let width = 0;
  /** Rastergeometrie in CSS-Pixeln: Ursprung des Rasters und Feldgröße. */
  const geo = { cell: 0, ox: 0, oy: 0 };

  let state = {
    ships: [],
    shots: null,
    aim: -1,
    ghost: null,
    selectedId: null,
    blocked: null,
    dim: false,
    labels: true,
  };
  let pulses = [];
  let banner = null;
  let timers = [];
  let clock = 0;
  let last = 0;
  let smolderBudget = 0;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const size = Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
    const nextDpr = Math.min(2, window.devicePixelRatio || 1);
    if (size === width && nextDpr === dpr) return;
    width = size;
    dpr = nextDpr;
    canvas.width = Math.round(size * dpr);
    canvas.height = Math.round(size * dpr);
    // Ränder für die Koordinaten oben und links, schmaler Saum rechts/unten.
    const band = 0.62;
    const pad = 0.14;
    geo.cell = size / (SIZE + band + pad);
    geo.ox = geo.cell * band;
    geo.oy = geo.cell * band;
  }

  new ResizeObserver(resize).observe(canvas);

  const center = (idx) => ({ x: (xOf(idx) + 0.5) * geo.cell, y: (yOf(idx) + 0.5) * geo.cell });

  function draw() {
    const { cell, ox, oy } = geo;
    const grid = cell * SIZE;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, width);

    // Rahmen
    roundRect(ctx, 1, 1, width - 2, width - 2, cell * 0.35);
    const frame = ctx.createLinearGradient(0, 0, 0, width);
    frame.addColorStop(0, enemy ? '#1d2a3a' : '#22384a');
    frame.addColorStop(1, enemy ? '#0c131c' : '#0e1a26');
    ctx.fillStyle = frame;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = enemy ? 'rgba(255, 140, 110, 0.28)' : 'rgba(120, 200, 255, 0.28)';
    ctx.stroke();

    if (state.labels) paintLabels(cell, ox, oy);

    const shakeX = fx.shake ? (Math.random() - 0.5) * fx.shake * 2 : 0;
    const shakeY = fx.shake ? (Math.random() - 0.5) * fx.shake * 2 : 0;
    ctx.translate(ox + shakeX, oy + shakeY);

    paintWater(ctx, 0, 0, grid, grid, clock, look, cell / 40);
    paintGrid(cell, grid);
    if (enemy) paintSweep(grid);

    fx.drawUnder(ctx);
    paintBlocked(cell);
    paintShots(cell, true);
    paintShips(cell);
    paintShots(cell, false);
    paintGhost(cell);
    paintSelection(cell);
    fx.drawOver(ctx);
    paintFires(cell);
    paintPulses(cell);
    if (state.dim) {
      ctx.fillStyle = 'rgba(2, 8, 16, 0.42)';
      ctx.fillRect(0, 0, grid, grid);
    }
    paintAim(cell, grid);
    paintBanner(grid);
  }

  function paintLabels(cell, ox, oy) {
    ctx.fillStyle = enemy ? 'rgba(255, 200, 185, 0.72)' : 'rgba(190, 228, 255, 0.72)';
    ctx.font = `600 ${Math.max(7, cell * 0.36)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < SIZE; i += 1) {
      const highlight = state.aim >= 0 && (xOf(state.aim) === i);
      ctx.globalAlpha = highlight ? 1 : 0.8;
      ctx.fillText(COLS[i], ox + (i + 0.5) * cell, oy * 0.52);
      const rowHi = state.aim >= 0 && yOf(state.aim) === i;
      ctx.globalAlpha = rowHi ? 1 : 0.8;
      ctx.fillText(String(i + 1), ox * 0.5, oy + (i + 0.5) * cell);
    }
    ctx.globalAlpha = 1;
  }

  function paintGrid(cell, grid) {
    ctx.strokeStyle = enemy ? 'rgba(255, 190, 170, 0.13)' : 'rgba(170, 225, 255, 0.16)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < SIZE; i += 1) {
      const p = Math.round(i * cell * dpr) / dpr + 0.5 / dpr;
      ctx.moveTo(p, 0); ctx.lineTo(p, grid);
      ctx.moveTo(0, p); ctx.lineTo(grid, p);
    }
    ctx.stroke();
    ctx.strokeStyle = enemy ? 'rgba(255, 170, 140, 0.35)' : 'rgba(160, 220, 255, 0.4)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(0, 0, grid, grid);
  }

  /** Radarstrahl über dem Feindmeer – Stimmung, keine Information. */
  function paintSweep(grid) {
    if (!ctx.createConicGradient) return;
    const angle = clock * 0.9;
    const g = ctx.createConicGradient(angle, grid / 2, grid / 2);
    g.addColorStop(0, 'rgba(120, 255, 200, 0)');
    g.addColorStop(0.75, 'rgba(120, 255, 200, 0)');
    g.addColorStop(0.97, 'rgba(120, 255, 200, 0.07)');
    g.addColorStop(1, 'rgba(120, 255, 200, 0.12)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, grid, grid);
  }

  function paintBlocked(cell) {
    if (!state.blocked?.size) return;
    ctx.fillStyle = 'rgba(255, 90, 70, 0.12)';
    for (const idx of state.blocked) {
      ctx.fillRect(xOf(idx) * cell + 1, yOf(idx) * cell + 1, cell - 2, cell - 2);
    }
  }

  function placeShip(ship, cell, sunk, alpha = 1) {
    const sprite = shipSprite(ship.type, ship.length, cell, dpr, sunk);
    ctx.save();
    ctx.globalAlpha = alpha;
    // Sanftes Dümpeln – je Schiff phasenversetzt
    const bob = sunk ? 0 : Math.sin(clock * 1.3 + ship.x * 1.7 + ship.y) * cell * 0.012;
    if (ship.dir === 'h') {
      ctx.translate(ship.x * cell, ship.y * cell + bob);
    } else {
      ctx.translate((ship.x + 1) * cell + bob, ship.y * cell);
      ctx.rotate(Math.PI / 2);
    }
    const m = sprite.margin;
    ctx.drawImage(sprite.image, -m, -m, ship.length * cell + m * 2, cell + m * 2);
    ctx.restore();
  }

  function paintShips(cell) {
    for (const ship of state.ships) {
      if (state.ghost && state.ghost.ship.id === ship.id) continue;
      if (!ship.sunk && !ship.sunkLook) paintWake(ship, cell);
      placeShip(ship, cell, ship.sunk || ship.sunkLook);
    }
  }

  /** Bugwelle und Kielwasser: zwei helle Bögen, die leise pulsieren. */
  function paintWake(ship, cell) {
    ctx.save();
    if (ship.dir === 'h') ctx.translate(ship.x * cell, (ship.y + 0.5) * cell);
    else { ctx.translate((ship.x + 0.5) * cell, ship.y * cell); ctx.rotate(Math.PI / 2); }
    const len = ship.length * cell;
    const k = 0.5 + 0.5 * Math.sin(clock * 2 + ship.x + ship.y * 2);
    ctx.strokeStyle = `rgba(230, 245, 255, ${0.1 + 0.08 * k})`;
    ctx.lineWidth = Math.max(1, cell * 0.04);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(len - cell * 0.12, -cell * 0.12);
    ctx.quadraticCurveTo(len - cell * 0.45, -cell * 0.36, len - cell * 0.9, -cell * 0.4);
    ctx.moveTo(len - cell * 0.12, cell * 0.12);
    ctx.quadraticCurveTo(len - cell * 0.45, cell * 0.36, len - cell * 0.9, cell * 0.4);
    ctx.stroke();
    // Kielwasser hinter dem Heck: ein weicher, heller Fächer
    const foam = ctx.createRadialGradient(cell * 0.1, 0, 0, cell * 0.1, 0, cell * 0.45);
    foam.addColorStop(0, `rgba(230, 245, 255, ${0.16 + 0.08 * k})`);
    foam.addColorStop(1, 'rgba(230, 245, 255, 0)');
    ctx.fillStyle = foam;
    ctx.beginPath();
    ctx.ellipse(cell * 0.02, 0, cell * 0.45, cell * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * Schussmarken. Wassermarken liegen unter den Schiffen, Treffer und Feuer
   * darüber – `under` wählt die Lage.
   */
  function paintShots(cell, under) {
    const shots = state.shots;
    if (!shots) return;
    for (let idx = 0; idx < shots.length; idx += 1) {
      const s = shots[idx];
      const { x, y } = center(idx);
      if (under && s === MISS) {
        const phase = (clock * 0.6 + idx * 0.37) % 1;
        ctx.strokeStyle = `rgba(210, 240, 255, ${0.35 * (1 - phase)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.14 + phase * 0.3), 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.13, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(236, 246, 255, 0.92)';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.06, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(70, 120, 160, 0.9)';
        ctx.fill();
      } else if (under && s === WATER) {
        ctx.fillStyle = 'rgba(180, 220, 245, 0.35)';
        ctx.beginPath();
        ctx.arc(x, y, cell * 0.05, 0, Math.PI * 2);
        ctx.fill();
      } else if (!under && s === HIT) {
        const sunk = state.sunkCells?.has(idx);
        if (!sunk) {
          roundRect(ctx, x - cell * 0.46, y - cell * 0.46, cell * 0.92, cell * 0.92, cell * 0.12);
          ctx.fillStyle = 'rgba(255, 70, 40, 0.16)';
          ctx.fill();
        }
        if (!sunk) {
          // Rotes Kreuz als klare Trefferanzeige – auch ohne Effektblick lesbar.
          ctx.strokeStyle = 'rgba(255, 235, 220, 0.9)';
          ctx.lineWidth = Math.max(1.4, cell * 0.07);
          ctx.lineCap = 'round';
          const r = cell * 0.17;
          ctx.beginPath();
          ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
          ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
          ctx.stroke();
        }
      }
    }
  }

  /**
   * Brennende Treffer: über Rauch und Schiffen, damit die Glut leuchtet.
   * Auf versenkten Schiffen glimmt es nur noch.
   */
  function paintFires(cell) {
    const shots = state.shots;
    if (!shots) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let idx = 0; idx < shots.length; idx += 1) {
      if (shots[idx] !== HIT) continue;
      const { x, y } = center(idx);
      const sunk = state.sunkCells?.has(idx);
      const f1 = 0.8 + 0.2 * Math.sin(clock * 17 + idx * 2.1) * Math.sin(clock * 7.3 + idx);
      const f2 = 0.8 + 0.2 * Math.sin(clock * 13 + idx * 1.3);
      const k = sunk ? 0.55 : 1;
      blit(ctx, fireSprite(), x, y, cell * 0.42 * f1 * k, sunk ? 0.5 : 0.9);
      blit(ctx, fireSprite(), x - cell * 0.1, y - cell * 0.12 * f2, cell * 0.28 * f2 * k, sunk ? 0.35 : 0.85);
      blit(ctx, fireSprite(), x + cell * 0.12, y - cell * 0.2 * f1, cell * 0.2 * f1 * k, sunk ? 0.25 : 0.75);
    }
    ctx.restore();
  }

  function paintGhost(cell) {
    const ghost = state.ghost;
    if (!ghost) return;
    const cells = [];
    for (let i = 0; i < ghost.ship.length; i += 1) {
      cells.push(ghost.ship.dir === 'h' ? [ghost.ship.x + i, ghost.ship.y] : [ghost.ship.x, ghost.ship.y + i]);
    }
    ctx.fillStyle = ghost.valid ? 'rgba(110, 240, 160, 0.28)' : 'rgba(255, 80, 60, 0.34)';
    for (const [cx, cy] of cells) {
      if (cx < 0 || cy < 0 || cx >= SIZE || cy >= SIZE) continue;
      ctx.fillRect(cx * cell + 1, cy * cell + 1, cell - 2, cell - 2);
    }
    placeShip(ghost.ship, cell, false, 0.82);
  }

  function paintSelection(cell) {
    const ship = state.ships.find((s) => s.id === state.selectedId);
    if (!ship || state.ghost) return;
    const w = ship.dir === 'h' ? ship.length : 1;
    const h = ship.dir === 'v' ? ship.length : 1;
    roundRect(ctx, ship.x * cell + 2, ship.y * cell + 2, w * cell - 4, h * cell - 4, cell * 0.2);
    ctx.save();
    ctx.setLineDash([cell * 0.22, cell * 0.14]);
    ctx.lineDashOffset = -clock * cell;
    ctx.lineWidth = Math.max(1.5, cell * 0.06);
    ctx.strokeStyle = '#ffd36b';
    ctx.shadowColor = 'rgba(255, 211, 107, 0.8)';
    ctx.shadowBlur = cell * 0.3;
    ctx.stroke();
    ctx.restore();
  }

  function paintAim(cell, grid) {
    if (state.aim < 0) return;
    const { x, y } = center(state.aim);
    const pulse = 0.5 + 0.5 * Math.sin(clock * 6);
    ctx.fillStyle = 'rgba(255, 120, 80, 0.07)';
    ctx.fillRect(xOf(state.aim) * cell, 0, cell, grid);
    ctx.fillRect(0, yOf(state.aim) * cell, grid, cell);

    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = `rgba(255, ${110 + 60 * pulse | 0}, 80, 0.95)`;
    ctx.lineWidth = Math.max(1.5, cell * 0.06);
    ctx.shadowColor = 'rgba(255, 90, 50, 0.9)';
    ctx.shadowBlur = cell * 0.25;
    const r = cell * (0.36 + 0.04 * pulse);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(clock * 0.8);
    ctx.beginPath();
    for (let i = 0; i < 4; i += 1) {
      ctx.rotate(Math.PI / 2);
      ctx.moveTo(r * 0.55, 0);
      ctx.lineTo(r * 1.3, 0);
    }
    ctx.stroke();
    ctx.restore();
  }

  function paintPulses(cell) {
    pulses = pulses.filter((p) => clock - p.t0 < 2.4);
    for (const p of pulses) {
      const age = clock - p.t0;
      const { x, y } = center(p.idx);
      for (let k = 0; k < 3; k += 1) {
        const a = (age - k * 0.35);
        if (a < 0 || a > 1.2) continue;
        ctx.strokeStyle = `rgba(255, 214, 110, ${0.9 * (1 - a / 1.2)})`;
        ctx.lineWidth = Math.max(1.5, cell * 0.07);
        ctx.beginPath();
        ctx.arc(x, y, cell * (0.3 + a * 0.6), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  function paintBanner(grid) {
    if (!banner) return;
    const age = clock - banner.t0;
    if (age > banner.duration) { banner = null; return; }
    const appear = Math.min(1, age / 0.18);
    const fade = Math.min(1, (banner.duration - age) / 0.35);
    const scale = 1.5 - 0.5 * easeOut(appear);
    ctx.save();
    ctx.globalAlpha = Math.min(appear, fade);
    ctx.translate(grid / 2, grid / 2);
    ctx.scale(scale, scale);
    const size = Math.min(grid * 0.16, (grid * 0.9) / Math.max(4, banner.text.length * 0.62));
    ctx.font = `900 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = 'rgba(4, 10, 18, 0.85)';
    ctx.strokeText(banner.text, 0, 0);
    ctx.fillStyle = banner.color;
    ctx.shadowColor = banner.color;
    ctx.shadowBlur = size * 0.4;
    ctx.fillText(banner.text, 0, 0);
    ctx.restore();
  }

  const view = {
    canvas,
    fx,
    geo,

    set(patch) {
      state = { ...state, ...patch };
      if (patch.shots || patch.ships) {
        const sunkCells = new Set();
        for (const ship of state.ships) if (ship.sunk) for (const c of shipCells(ship)) sunkCells.add(c);
        state.sunkCells = sunkCells;
      }
    },
    get state() { return state; },

    /**
     * Bildschirmpunkt → Feld. `exact` liefert gebrochene Feldkoordinaten
     * (auch außerhalb des Rasters), sonst den Feldindex oder −1.
     */
    cellAt(clientX, clientY, exact = false) {
      const rect = canvas.getBoundingClientRect();
      const fx2 = (clientX - rect.left - geo.ox) / geo.cell;
      const fy2 = (clientY - rect.top - geo.oy) / geo.cell;
      if (exact) return { x: fx2, y: fy2 };
      const x = Math.floor(fx2);
      const y = Math.floor(fy2);
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return -1;
      return y * SIZE + x;
    },

    contains(clientX, clientY) {
      const rect = canvas.getBoundingClientRect();
      return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
    },

    pulse(indices) {
      for (const idx of indices) pulses.push({ idx, t0: clock });
    },

    showBanner(text, color = '#ffffff', duration = 1.3) {
      banner = { text, color, t0: clock, duration };
    },

    /**
     * Granate abfeuern; beim Einschlag folgen die Effekte zum `result`.
     * `sunkShip` lässt bei 'sunk' das ganze Schiff nacheinander auflodern.
     */
    async fireAt(idx, result, sunkShip = null) {
      const grid = geo.cell * SIZE;
      const to = center(idx);
      // Eigene Schüsse kommen von unten (dem Spieler), fremde von oben.
      const from = enemy ? { x: grid / 2, y: grid + geo.cell * 2.5 } : { x: grid / 2, y: -geo.cell * 2.5 };
      await fx.shell(from, to, geo.cell, 0.55 + Math.hypot(to.x - from.x, to.y - from.y) / grid * 0.25);
      const cell = geo.cell;
      if (result === 'miss') {
        fx.splash(to.x, to.y, cell);
      } else {
        fx.explosion(to.x, to.y, cell, result === 'sunk');
        if (result === 'sunk' && sunkShip) {
          shipCells(sunkShip).forEach((c, i) => {
            if (c === idx) return;
            const p = center(c);
            timers.push({ at: clock + 0.12 + i * 0.11, run: () => fx.explosion(p.x, p.y, cell, false) });
          });
        }
      }
    },

    /** Ein Bild zeichnen. Liefert, ob noch etwas in Bewegung ist. */
    frame(now) {
      const t = now / 1000;
      const dt = last ? Math.min(0.05, t - last) : 0.016;
      last = t;
      clock += dt;
      if (!width) resize();
      if (!width || !geo.cell) return;

      timers = timers.filter((timer) => {
        if (clock < timer.at) return true;
        timer.run();
        return false;
      });

      // Brennende Treffer qualmen – gedrosselt, damit eine große Flotte
      // in Flammen nicht das Handy in die Knie zwingt.
      if (state.shots) {
        smolderBudget += dt * 2.2;
        if (smolderBudget > 1) {
          const burning = [];
          for (let i = 0; i < state.shots.length; i += 1) if (state.shots[i] === HIT) burning.push(i);
          if (burning.length) {
            const n = Math.min(burning.length, Math.floor(smolderBudget * Math.min(4, burning.length / 2 + 1)));
            for (let k = 0; k < n; k += 1) {
              const idx = burning[(Math.random() * burning.length) | 0];
              const p = center(idx);
              fx.smolder(p.x, p.y - geo.cell * 0.1, geo.cell, state.sunkCells?.has(idx));
            }
          }
          smolderBudget = 0;
        }
      }

      fx.update(dt);
      draw();
    },

    resize,
  };
  return view;
}

const easeOut = (t) => 1 - (1 - t) ** 3;
