// Szene: aus Spielzustand werden Instanzen.
//
// Dieses Modul kennt kein WebGL. Es hält die weichen Animationszustände
// (Bauteilwinkel, Glut der Knoten, laufende Ringe) und schreibt daraus die
// Sprite-Instanzen und Strahl-Segmente in die übergebenen Stapel. So bleibt
// `webgl2.js` reine Grafikverwaltung und diese Datei reine Bildregie.
//
// Drei Regeln ziehen sich durch: Nichts springt hart um – jeder Zustand wird
// rahmenratenunabhängig nachgeführt. Im laufenden Bild wird nichts allokiert;
// Ringe kommen aus einem festen Vorrat, Kreuzungspunkte kommen fertig aus der
// Strahlverfolgung. Und die Szene fragt nie nach Bauteilarten im Einzelnen,
// sondern läuft über `level.devices` – ein neues Spielprinzip braucht hier nur
// eine weitere Zeile in `DEVICE_KIND`.

import { cellCenter, gridToPixel } from '../layout.js';
import { deviceState } from '../level.js';
import { KIND } from './kinds.js';
import { beamTint, WANT_CODE } from './palette.js';

const lerp = (a, b, t) => a + (b - a) * t;
/** Rahmenratenunabhängiges Annähern. */
const approach = (current, target, rate, dt) => lerp(current, target, 1 - Math.exp(-rate * dt));

const DIR_ANGLE = { R: 0, D: Math.PI / 2, L: Math.PI, U: -Math.PI / 2 };

/** Welcher Sprite gehört zu welcher Bauteilart? */
const DEVICE_KIND = { mirror: KIND.MIRROR, prism: KIND.PRISM, socket: KIND.PRISM };

/** Zufälliger, aber je Level gleichbleibender Phasenversatz. */
const seedOf = (x, y) => ((x * 73856093) ^ (y * 19349663)) % 997 / 997;

const RING_POOL = 64;

export function createScene() {
  let level = null;
  let beamLenPx = 0;

  const state = {
    /** Je Bauteil: Winkel, Glut, und wie weit es „da“ ist (Fassungen blenden auf). */
    deviceAngle: [],
    deviceLit: [],
    devicePresence: [],
    targetLit: [],
    targetImpact: [],
    /** Spiegelbild der zuletzt gesehenen Reglerstellung – erkennt neue Strahlwege. */
    lastConfig: [],
    lastTargetOn: [],
    /** Vorgefertigte "x,y"-Schlüssel – sonst entstünde je Bild ein String je Ziel. */
    targetKeys: [],
    crossings: [],
    splits: [],
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

  /** Ruhewinkel eines Bauteils. Eine leere Fassung behält den letzten Winkel. */
  const angleOf = (orient) => (orient === '\\' ? Math.PI / 4 : -Math.PI / 4);

  function setLevel(next) {
    level = next;
    const devices = level ? level.devices : [];
    state.deviceAngle = devices.map((d) => angleOf(d.states[d.start]));
    state.deviceLit = devices.map(() => 0);
    state.devicePresence = devices.map((d) => (d.states[d.start] === null ? 0 : 1));
    state.targetLit = level ? level.targets.map(() => 0) : [];
    state.targetImpact = level ? level.targets.map(() => 0) : [];
    state.lastConfig = level ? level.controls.map(() => -1) : [];
    state.lastTargetOn = level ? level.targets.map(() => false) : [];
    state.targetKeys = level ? level.targets.map((t) => `${t.x},${t.y}`) : [];
    state.crossings = [];
    state.splits = [];
    state.reveal = 0;
    state.celebrateAt = -1e9;
    state.winGlow = 0;
    state.flash = 0;
    state.wave = -1;
    for (const r of rings) r.active = false;
  }

  /** Gesamtlänge des Fadens in Pixeln – Maßstab für Weben und Siegeswelle. */
  function measureBeam(trace, cell) {
    let total = 0;
    for (const { points } of trace.paths) {
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

    // Hat sich die Reglerstellung geändert? Dann neu weben.
    let changed = false;
    for (let i = 0; i < state.lastConfig.length; i += 1) {
      if (state.lastConfig[i] !== session.config[i]) {
        state.lastConfig[i] = session.config[i];
        changed = true;
      }
    }
    if (changed) {
      state.crossings = trace.crossings;
      state.splits = trace.splits;
      state.reveal = 0;
    }
    beamLenPx = measureBeam(trace, cell);

    const rate = calm ? 60 : 16;
    level.devices.forEach((device, i) => {
      const orient = deviceState(level, session.config, device);
      // Eine leere Fassung fährt herunter, statt in eine Ruhelage zu springen.
      state.devicePresence[i] = approach(state.devicePresence[i], orient === null ? 0 : 1, 14, dt);
      if (orient !== null) state.deviceAngle[i] = approach(state.deviceAngle[i], angleOf(orient), rate, dt);
      state.deviceLit[i] = approach(state.deviceLit[i], trace.litDevices.has(i) ? 1 : 0, 12, dt);
    });

    level.targets.forEach((t, i) => {
      const on = trace.litTargets.has(state.targetKeys[i]);
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
      state.reveal += dt * Math.max(beamLenPx / 0.22, cell * 16);
    }

    for (const r of rings) {
      if (!r.active) continue;
      if (r.delay > 0) { r.delay -= dt; continue; }
      r.t += dt / r.dur;
      if (r.t >= 1) r.active = false;
    }

    const since = (nowMs - state.celebrateAt) / 1000;
    if (since >= 0 && since < 3) {
      state.flash = Math.max(0, 1 - since / 0.45);
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
        state.targetLit[i], state.targetImpact[i], seedOf(t.x, t.y), WANT_CODE[t.want]);
    });

    const ready = session.prismsLeft > 0 ? 1 : 0;
    level.devices.forEach((device, i) => {
      const { px, py } = cellCenter(layout, device.x, device.y);
      const locked = device.locked ? 1 : 0;
      const isHover = hover && hover.x === device.x && hover.y === device.y && !device.locked ? 1 : 0;
      const presence = state.devicePresence[i];

      // Eine leere Fassung zeigt nur ihren Umriss – dort ist Platz, kein Bauteil.
      if (device.kind === 'socket' && presence < 0.995) {
        batch.add(px, py, half, 0, KIND.SOCKET, 1, 0, 0, 1, 1, 1, 1 - presence,
          ready, isHover, 0, 0);
      }
      if (presence < 0.005) return;

      batch.add(px, py, half, 0, KIND.BEZEL, presence, 0, 0, 1, 1, 1, 1,
        locked, isHover, state.deviceLit[i], 0);
      batch.add(px, py, half * presence, state.deviceAngle[i], DEVICE_KIND[device.kind],
        1, 0, 0, 1, 1, 1, presence,
        locked, state.deviceLit[i], seedOf(device.x, device.y), 0);
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
      if (cellData?.device !== undefined && cellData.device !== -1
        && !level.devices[cellData.device].locked) {
        const { px, py } = cellCenter(layout, hover.x, hover.y);
        batch.add(px, py, cell * 0.9, 0, KIND.HALO, 0.35, 0, 0, 0.35, 0.62, 1.0, 1, 0, 0, 0, 0);
      }
    }

    level.targets.forEach((t, i) => {
      const lit = state.targetLit[i];
      const impact = state.targetImpact[i];
      if (lit < 0.01 && impact < 0.01) return;
      const { px, py } = cellCenter(layout, t.x, t.y);
      const bloom = 1 + state.winGlow * 0.35;
      batch.add(px, py, cell * 1.5, 0, KIND.TARGET_GLOW, bloom, 0, 0, 1, 1, 1, 1,
        lit, impact, seedOf(t.x, t.y), WANT_CODE[t.want]);
    });

    // Teilt dieses Prisma gerade wirklich? Dann fächert sein Glanz auf.
    const splitting = new Set(state.splits.map((s) => `${s.x},${s.y}`));
    level.devices.forEach((device, i) => {
      const lit = state.deviceLit[i] * state.devicePresence[i];
      if (lit < 0.01) return;
      const { px, py } = cellCenter(layout, device.x, device.y);
      if (device.kind === 'mirror') {
        batch.add(px, py, cell * 0.62, state.deviceAngle[i], KIND.MIRROR_GLINT, 1, 0, 0, 1, 1, 1, 1,
          lit, 0, 0, 0);
      } else {
        const split = splitting.has(`${device.x},${device.y}`) ? 1 : 0;
        batch.add(px, py, cell * 0.72, state.deviceAngle[i], KIND.PRISM_GLINT, 1, 0, 0, 1, 1, 1, 1,
          lit, split, 0, 0);
      }
    });

    for (const s of level.sources) {
      const { px, py } = cellCenter(layout, s.x, s.y);
      batch.add(px, py, cell * 1.45, 0, KIND.SOURCE_CORONA, 1 + state.winGlow * 0.4, 0, 0, 1, 1, 1, 1, 0, 0, 0, 0);
    }

    for (const c of state.crossings) {
      const { px, py } = cellCenter(layout, c.x, c.y);
      batch.add(px, py, cell * 0.6, 0, KIND.SPARK, 0.9, 0, 0, 1, 1, 1, 1, seedOf(c.x, c.y), 0, 0, 0);
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

  /**
   * Strahl-Segmente in Pixeln, mit fortlaufender Bogenlänge.
   *
   * Jede Linie bringt ihre eigene Farbe mit – die Bogenlänge zählt je Linie neu,
   * damit die Energiepakete hinter einem Prisma auf beiden Ästen weiterlaufen.
   */
  function emitBeam(buffer, session, layout) {
    if (!level || !session?.trace) return;
    const { cell, originX, originY } = layout;
    const half = Math.max(3, cell * 0.5);
    for (const { points, colors } of session.trace.paths) {
      const tint = beamTint(colors);
      buffer.setTint(tint.warm, tint.cool);
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
