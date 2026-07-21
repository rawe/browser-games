// Baut aus den Kontrollpunkten einer Strecke eine abgetastete Geometrie:
// Positionen, Tangenten, Normalen, Krümmung und Bogenlänge. DOM-frei.

const SUBDIV = 14; // Abtastpunkte pro Kontrollpunkt

function catmullRom(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return [
    0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t +
      (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 +
      (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
    0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t +
      (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 +
      (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
  ];
}

export function buildTrack(def) {
  const pts = def.points;
  const n = pts.length;
  const positions = [];
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    for (let j = 0; j < SUBDIV; j++) {
      positions.push(catmullRom(p0, p1, p2, p3, j / SUBDIV));
    }
  }

  const count = positions.length;
  const samples = new Array(count);
  let dist = 0;
  for (let i = 0; i < count; i++) {
    const [x, z] = positions[i];
    const [nx, nz] = positions[(i + 1) % count];
    const [px, pz] = positions[(i - 1 + count) % count];
    let tx = nx - px;
    let tz = nz - pz;
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl; tz /= tl;
    samples[i] = {
      x, z, tx, tz,
      nx: -tz, nz: tx, // Normale (links der Fahrtrichtung)
      s: 0, curvature: 0,
    };
  }
  for (let i = 0; i < count; i++) {
    samples[i].s = dist;
    const a = positions[i];
    const b = positions[(i + 1) % count];
    dist += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const length = dist;

  // Krümmung: Winkeländerung der Tangente pro Bogenlänge (leicht geglättet)
  for (let i = 0; i < count; i++) {
    const a = samples[(i - 1 + count) % count];
    const b = samples[(i + 1) % count];
    const angA = Math.atan2(a.tz, a.tx);
    const angB = Math.atan2(b.tz, b.tx);
    let dAng = angB - angA;
    while (dAng > Math.PI) dAng -= 2 * Math.PI;
    while (dAng < -Math.PI) dAng += 2 * Math.PI;
    const ds = ((samples[(i + 1) % count].s - samples[(i - 1 + count) % count].s) + length) % length || 1;
    samples[i].curvature = Math.abs(dAng / ds);
  }

  return {
    def,
    samples,
    count,
    length,
    width: def.width,
    halfWidth: def.width / 2,
    shoulder: 3.5,      // Grasstreifen bis zur Bande
    laps: def.laps,
  };
}

// Nächstgelegener Abtastpunkt; mit hint wird nur ein Fenster durchsucht (schnell pro Frame).
export function closestSampleIndex(track, x, z, hint = -1) {
  const { samples, count } = track;
  let best = 0;
  let bestD = Infinity;
  if (hint >= 0) {
    const WIN = 30;
    for (let o = -WIN; o <= WIN; o++) {
      const i = (hint + o + count) % count;
      const s = samples[i];
      const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
      if (d < bestD) { bestD = d; best = i; }
    }
    // Fenster verlassen? Dann global suchen.
    if (bestD < 400) return best;
  }
  bestD = Infinity;
  for (let i = 0; i < count; i++) {
    const s = samples[i];
    const d = (s.x - x) * (s.x - x) + (s.z - z) * (s.z - z);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}

// Signierter Querabstand zur Mittellinie am Abtastpunkt i (positiv = links).
export function lateralOffset(track, i, x, z) {
  const s = track.samples[i];
  return (x - s.x) * s.nx + (z - s.z) * s.nz;
}

// Maximale Krümmung im Streckenabschnitt voraus (für KI-Bremspunkte).
export function maxCurvatureAhead(track, i, meters) {
  const { samples, count } = track;
  let maxC = 0;
  let acc = 0;
  let idx = i;
  while (acc < meters) {
    const next = (idx + 1) % count;
    acc += ((samples[next].s - samples[idx].s) + track.length) % track.length;
    idx = next;
    if (samples[idx].curvature > maxC) maxC = samples[idx].curvature;
    if (idx === i) break;
  }
  return maxC;
}
