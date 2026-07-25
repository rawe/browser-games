// Streckengeometrie: Kontrollpunkte glätten, Positionen entlang der Ideallinie
// bestimmen und Weltkoordinaten auf die Strecke projizieren. Komplett DOM-frei.

export const WORLD = 1600;
export const ROAD_WIDTH = 100;

const TRACK_SCALE = 1.6;

// Chaikin-Glättung: ersetzt jede Ecke durch zwei Punkte auf ihren Kanten.
function chaikin(points) {
  const out = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
    out.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  return out;
}

/**
 * Baut aus einer Streckendefinition den geglätteten Linienzug samt
 * Längentabelle (`len` je Segment, `cum` kumuliert) für Fortschrittsrechnung.
 */
export function buildTrack(def) {
  let pts = def.points.map(([x, y]) => [x * TRACK_SCALE, y * TRACK_SCALE]);
  pts = chaikin(chaikin(pts));

  const n = pts.length;
  const len = [];
  const cum = [0];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    len.push(Math.hypot(b[0] - a[0], b[1] - a[1]));
    cum.push(cum[i] + len[i]);
  }
  return { def, pts, n, len, cum, total: cum[n] };
}

/** Position und Blickrichtung an der Bogenlänge `s` (läuft zyklisch um). */
export function posAt(track, s) {
  const d = ((s % track.total) + track.total) % track.total;
  let i = 0;
  while (i < track.n - 1 && track.cum[i + 1] <= d) i++;
  const t = (d - track.cum[i]) / track.len[i];
  const a = track.pts[i];
  const b = track.pts[(i + 1) % track.n];
  return {
    x: a[0] + (b[0] - a[0]) * t,
    y: a[1] + (b[1] - a[1]) * t,
    angle: Math.atan2(b[1] - a[1], b[0] - a[0]),
    seg: i,
  };
}

/**
 * Nächster Punkt auf der Ideallinie zu (x, y). `hint` ist das zuletzt bekannte
 * Segment – gesucht wird nur in dessen Umgebung, das hält die Suche billig und
 * verhindert Sprünge an Stellen, wo sich die Strecke selbst nahekommt.
 */
export function project(track, x, y, hint) {
  let best = null;
  for (let d = -8; d <= 8; d++) {
    const i = (((hint + d) % track.n) + track.n) % track.n;
    const a = track.pts[i];
    const b = track.pts[(i + 1) % track.n];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((x - a[0]) * dx + (y - a[1]) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const px = a[0] + dx * t;
    const py = a[1] + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (!best || dist < best.dist) best = { i, t, px, py, dist };
  }
  best.s = track.cum[best.i] + best.t * track.len[best.i];
  return best;
}
