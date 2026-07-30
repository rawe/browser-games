// Szene: aus Spielzustand werden Instanzen.
//
// Dieses Modul kennt kein WebGL. Es hält die weichen Animationszustände
// (Spiegelwinkel, Glut der Knoten, laufende Ringe) und schreibt daraus die
// Sprite-Instanzen und Strahl-Segmente in die übergebenen Stapel. So bleibt
// `webgl2.js` reine Grafikverwaltung und diese Datei reine Bildregie.
//
// Zwei Regeln ziehen sich durch: Nichts springt hart um – jeder Zustand wird
// rahmenratenunabhängig nachgeführt. Und im laufenden Bild wird nichts
// allokiert; Ringe kommen aus einem festen Vorrat, Kreuzungspunkte werden nur
// bei einer Änderung des Strahlverlaufs neu bestimmt.

import { cellCenter, gridToPixel } from '../layout.js';
import { KIND } from './kinds.js';

const lerp = (a, b, t) => a + (b - a) * t;
/** Rahmenratenunabhängiges Annähern. */
const approach = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

const DIR_ANGLE = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };

/** Zufälliger, aber je Level gleichbleibender Phasenversatz. */
const seedOf = (x, y) => ((x * 73856093) ^ (y * 19349663)) % 997 / 997;

const RING_POOL = 64;

export function createScene() {
  let level = null;
  let beamLenPx = 0;

  const state = {
    mirrorAngle: [],
    mirrorLit: [],
    targetLit: [],
    targetImpact: [],
    /** Spiegelbild der zuletzt gesehenen Stellungen – erkennt neue Strahlwege. */
    lastOrient: [],
    lastTargetOn: [],
    crossings: [],
    reveal: 0,
    celebrateAt: -1e9,
    winGlow: 0,
    flash: 0,
    wave: -1,
  };

  // Fester Vorrat an Ringen und Blitzen: `active` schaltet sie ein und aus.
  const rings = Array.from({ length: RING_POOL }, () => ({
    active: false, x: 0, y: 0, t: 0, dur: 1, size: 1, warm: 0, delay: 0, halo: 0,
  }));

  function spawnRing(x, y, dur, size, warm, delay = 0, halo = 0) {
    const slot = rings.find((r) => !r.active);
    if (!slot) return;
    slot.active = true;
    slot.x = x; slot.y = y; slot.t = 0; slot.dur = dur;
    slot.size = size; slot.warm = warm; slot.delay = delay; slot.halo = halo;
  }

  function setLevel(next) {
    level = next;
    state.mirrorAngle = level ? level.mirrors.map((m) => (m.start === '/' ? -Math.PI / 4 : Math.PI / 4)) : [];
    state.mirrorLit = level ? level.mirrors.map(() => 0) : [];
    state.targetLit = level ? level.targets.map(() => 0) : [];
    state.targetImpact = level ? level.targets.map(() => 0) : [];
    state.lastOrient = level ? level.mirrors.map(() => '') : [];
    state.lastTargetOn = level ? level.targets.map(() => false) : [];
    state.crossings = [];
    state.reveal = 0;
    state.celebrateAt = -1e9;
    state.winGlow = 0;
    state.flash = 0;
    state.wave = -1;
    for (const r of rings) r.active = false;
  }

  /** Zellen, durch die der Faden mehr als einmal läuft – dort blitzt es. */
  function rebuildCrossings(trace) {
    const found = [];
    for (const [key, count] of trace.visits) {
      if (count < 2) continue;
      const comma = key.indexOf(',');
      found.push({
        x: Number(key.slice(0, comma)),
        y: Number(key.slice(comma + 1)),
        power: Math.min(1.6, 0.7 + (count - 2) * 0.35),
      });
    }
    state.crossings = found;
  }

  /** Gesamtlänge des Fadens in Pixeln – Maßstab für Weben und Siegeswelle. */
  function measureBeam(trace, cell) {
    let total = 0;
    for (const points of trace.paths) {
      for (let i = 1; i < points.length; i += 1) {
        total += (Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y)) * cell;
      }
    }
    return total;
  }

  /**
   * Alle Zustände einen Zeitschritt weiterführen.
   * @param {number} dt   Sekunden seit dem letzten Bild
   * @param {boolean} calm  `prefers-reduced-motion`
   */
  function update(dt, nowMs, session, layout, calm) {
    if (!level || !session) return;
    const { cell } = layout;
    const trace = session.trace;

    // Hat sich der Strahlverlauf geändert? Dann neu weben.
    let changed = false;
    for (let i = 0; i < state.lastOrient.length; i += 1) {
      if (state.lastOrient[i] !== session.orientations[i]) {
        state.lastOrient[i] = session.orientations[i];
        changed = true;
      }
    }
    if (changed) {
      rebuildCrossings(trace);
      state.reveal = 0;
    }
    beamLenPx = measureBeam(trace, cell);

    const rate = calm ? 60 : 16;
    for (let i = 0; i < level.mirrors.length; i += 1) {
      const target = session.orientations[i] === '/' ? -Math.PI / 4 : Math.PI / 4;
      state.mirrorAngle[i] = approach(state.mirrorAngle[i], target, rate, dt);
      const on = trace.litMirrors.has(i) ? 1 : 0;
      state.mirrorLit[i] = approach(state.mirrorLit[i], on, 12, dt);
    }

    level.targets.forEach((t, i) => {
      const on = trace.litTargets.has(`${t.x},${t.y}`);
      if (on && !state.lastTargetOn[i]) {
        // Einschlag: kurzer heller Kern plus ein Ring, der nach außen läuft.
        state.targetImpact[i] = 1;
        spawnRing(t.x + 0.5, t.y + 0.5, 0.62, cell * 1.5, 1);
      }
      state.lastTargetOn[i] = on;
      state.targetLit[i] = approach(state.targetLit[i], on ? 1 : 0, 11, dt);
      state.targetImpact[i] = Math.max(0, state.targetImpact[i] - dt * 2.6);
    });

    // Weben: die Front läuft in gut einer Viertelsekunde durch den ganzen Faden.
    if (calm) {
      state.reveal = beamLenPx + cell * 4;
    } else if (state.reveal < beamLenPx + cell * 2) {
      state.reveal += dt * Math.max(beamLenPx / 0.26, cell * 14);
    }

    for (const r of rings) {
      if (!r.active) continue;
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t += dt / r.dur;
      if (r.t >= 1) r.active = false;
    }

    const since = (nowMs - state.celebrateAt) / 1000;
    if (since >= 0 && since < 3) {
      state.flash = Math.max(0, 1 - since / 0.7);
      state.winGlow = Math.min(1, since * 3) * Math.max(0, 1 - Math.max(0, since - 1.2) / 1.6);
      state.wave = since < 1.5 ? (since / 1.2) * (beamLenPx + cell * 2) : -1;
    } else {
      state.flash = approach(state.flash, 0, 6, dt);
      state.winGlow = approach(state.winGlow, 0, 4, dt);
      state.wave = -1;
    }
  }

  /* ---------- Instanzen schreiben ---------- */

  function emitSolid(batch, session, layout, hover, cursor) {
    if (!level || !session) return;
    const { cell } = layout;
    const half = cell * 0.5;

    for (const c of level.cells) {
      if (c.type !== 'wall') continue;
      const { px, py } = cellCenter(layout, c.x, c.y);
      batch.add(px, py, half, 0, KIND.WALL, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0);
    }

    level.targets.forEach((t, i) => {
      const { px, py } = cellCenter(layout, t.x, t.y);
      batch.add(px, py, half, 0, KIND.TARGET, 1, 0, 0, 1, 1, 1, 1,
        state.targetLit[i], state.targetImpact[i], seedOf(t.x, t.y), 0);
    });

    level.mirrors.forEach((m, i) => {
      const { px, py } = cellCenter(layout, m.x, m.y);
      const locked = m.locked ? 1 : 0;
      const isHover = hover && hover.x === m.x && hover.y === m.y && !m.locked ? 1 : 0;
      batch.add(px, py, half, 0, KIND.BEZEL, 1, 0, 0, 1, 1, 1, 1,
        locked, isHover, state.mirrorLit[i], 0);
      batch.add(px, py, half, state.mirrorAngle[i], KIND.MIRROR, 1, 0, 0, 1, 1, 1, 1,
        locked, state.mirrorLit[i], seedOf(m.x, m.y), 0);
    });

    for (const s of level.sources) {
      const { px, py } = cellCenter(layout, s.x, s.y);
      batch.add(px, py, half, DIR_ANGLE[s.dir] ?? 0, KIND.SOURCE, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0);
    }

    if (cursor) {
      const { px, py } = cellCenter(layout, cursor.x, cursor.y);
      batch.add(px, py, half, 0, KIND.CURSOR, 1, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0);
    }
  }

  function emitGlow(batch, session, layout, hover) {
    if (!level || !session) return;
    const { cell } = layout;

    if (hover) {
      const cellData = level.cells[hover.y * level.width + hover.x];
      if (cellData?.type === 'mirror' && !cellData.locked) {
        const { px, py } = cellCenter(layout, hover.x, hover.y);
        batch.add(px, py, cell * 0.9, 0, KIND.HALO, 0.35, 0, 0, 0.35, 0.62, 1.0, 1, 0, 0, 0, 0);
      }
    }

    level.targets.forEach((t, i) => {
      const lit = state.targetLit[i];
      const impact = state.targetImpact[i];
      if (lit < 0.01 && impact < 0.01) return;
      const { px, py } = cellCenter(layout, t.x, t.y);
      const bloom = 1 + state.winGlow * 1.6;
      batch.add(px, py, cell * 1.5, 0, KIND.TARGET_GLOW, bloom, 0, 0, 1, 1, 1, 1,
        lit, impact, seedOf(t.x, t.y), 0);
    });

    level.mirrors.forEach((m, i) => {
      const lit = state.mirrorLit[i];
      if (lit < 0.01) return;
      const { px, py } = cellCenter(layout, m.x, m.y);
      batch.add(px, py, cell * 0.62, state.mirrorAngle[i], KIND.MIRROR_GLINT, 1, 0, 0, 1, 1, 1, 1,
        lit, 0, 0, 0);
    });

    for (const s of level.sources) {
      const { px, py } = cellCenter(layout, s.x, s.y);
      batch.add(px, py, cell * 1.6, 0, KIND.SOURCE_CORONA, 1 + state.winGlow, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0);
    }

    for (const c of state.crossings) {
      const { px, py } = cellCenter(layout, c.x, c.y);
      batch.add(px, py, cell * 0.6, 0, KIND.SPARK, c.power, 0, 0, 1, 1, 1, 1, seedOf(c.x, c.y), 0, 0, 0);
    }

    for (const r of rings) {
      if (!r.active || r.delay > 0) continue;
      const { px, py } = gridToPixel(layout, r.x, r.y);
      if (r.halo > 0) {
        batch.add(px, py, r.size, 0, KIND.HALO, (1 - r.t) * r.halo, 0, 0,
          0.6, 0.85, 1.0, 1, 0, 0, 0, 0);
      }
      batch.add(px, py, r.size, 0, KIND.RING, 1, 0, 0, 1, 1, 1, 1, r.t, r.warm, 0, 0);
    }
  }

  /** Strahl-Segmente in Pixeln, mit fortlaufender Bogenlänge. */
  function emitBeam(buffer, session, layout) {
    if (!level || !session?.trace) return;
    const { cell, originX, originY } = layout;
    const half = Math.max(3, cell * 0.5);
    for (const points of session.trace.paths) {
      let arc = 0;
      for (let i = 1; i < points.length; i += 1) {
        const a = points[i - 1];
        const b = points[i];
        arc += buffer.addSegment(
          originX + a.x * cell, originY + a.y * cell,
          originX + b.x * cell, originY + b.y * cell,
          half, arc, 1,
        );
      }
    }
  }

  return {
    state,
    setLevel,
    update,
    emitSolid,
    emitGlow,
    emitBeam,
    get beamLength() { return beamLenPx; },
    tap(x, y, cell) {
      spawnRing(x + 0.5, y + 0.5, 0.5, cell * 1.05, 0, 0, 0.8);
    },
    celebrate(nowMs, layout) {
      state.celebrateAt = nowMs;
      if (!level) return;
      const cell = layout.cell;
      // Die Knoten blühen nacheinander auf – das gibt dem Moment einen Takt.
      level.targets.forEach((t, i) => {
        spawnRing(t.x + 0.5, t.y + 0.5, 0.9, cell * 2.2, 1, 0.12 * i + 0.25);
      });
      for (const s of level.sources) spawnRing(s.x + 0.5, s.y + 0.5, 1.1, cell * 3.0, 0.35);
    },
  };
}
