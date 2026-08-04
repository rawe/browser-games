// Werkzeugkasten für die facettierten Fahrzeugmeshes. Alle Dreiecke werden
// unindiziert gesammelt, damit computeVertexNormals harte Facetten liefert.
// Grauwert-Schattierungen (shade 0–4) multiplizieren später die Lackfarbe über
// Vertex-Colors; alternativ kann eine feste RGB-Farbe gesetzt werden (Lichter).
import * as THREE from 'three';

export const SHADES = [0.72, 0.82, 0.9, 1.0, 1.08];

export function facetBuilder() {
  const positions = [];
  const colors = [];
  let colorOverride = null;

  const setColor = (rgb) => { colorOverride = rgb; };
  const clearColor = () => { colorOverride = null; };

  const triangle = (a, b, c, shade = 2) => {
    positions.push(...a, ...b, ...c);
    if (colorOverride) {
      for (let i = 0; i < 3; i++) colors.push(...colorOverride);
    } else {
      const v = SHADES[Math.max(0, Math.min(4, Math.round(shade)))];
      colors.push(v, v, v, v, v, v, v, v, v);
    }
  };

  const quad = (a, b, c, d, shade = 2, flipDiagonal = false) => {
    if (flipDiagonal) {
      triangle(a, b, d, shade);
      triangle(b, c, d, Math.min(4, shade + 1));
    } else {
      triangle(a, b, c, shade);
      triangle(a, c, d, Math.max(0, shade - 1));
    }
  };

  const box = (x, y, z, sx, sy, sz, shade = 2) => {
    const x0 = x - sx / 2; const x1 = x + sx / 2;
    const y0 = y - sy / 2; const y1 = y + sy / 2;
    const z0 = z - sz / 2; const z1 = z + sz / 2;
    const p000 = [x0, y0, z0]; const p001 = [x0, y0, z1];
    const p010 = [x0, y1, z0]; const p011 = [x0, y1, z1];
    const p100 = [x1, y0, z0]; const p101 = [x1, y0, z1];
    const p110 = [x1, y1, z0]; const p111 = [x1, y1, z1];
    quad(p100, p110, p111, p101, shade); // vorn
    quad(p000, p001, p011, p010, shade - 1); // hinten
    quad(p010, p011, p111, p110, shade + 1); // oben
    quad(p000, p100, p101, p001, shade - 2); // unten
    quad(p001, p101, p111, p011, shade); // links
    quad(p000, p010, p110, p100, shade - 1); // rechts
  };

  /**
   * Verbindet zwei Profil-Linien (gleiche Punktzahl) mit Quads.
   * shadeFn(i) liefert die Schattierung pro Band, flipFn(i) die Diagonale.
   */
  const loft = (profileA, profileB, shadeFn = () => 2, flipFn = (i) => i % 2 === 1) => {
    for (let i = 0; i < profileA.length - 1; i++) {
      quad(profileA[i], profileA[i + 1], profileB[i + 1], profileB[i], shadeFn(i), flipFn(i));
    }
  };

  /** Spiegelt alle bisher gesammelten Dreiecke an der Z-Ebene (mit Windungsumkehr). */
  const mirrorZ = () => {
    const n = positions.length;
    for (let t = 0; t < n; t += 9) {
      // Reihenfolge a,c,b kehrt die Windung um, Z wird negiert.
      positions.push(
        positions[t], positions[t + 1], -positions[t + 2],
        positions[t + 6], positions[t + 7], -positions[t + 8],
        positions[t + 3], positions[t + 4], -positions[t + 5],
      );
      colors.push(
        colors[t], colors[t + 1], colors[t + 2],
        colors[t + 6], colors[t + 7], colors[t + 8],
        colors[t + 3], colors[t + 4], colors[t + 5],
      );
    }
  };

  const build = () => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  };

  const triangleCount = () => positions.length / 9;

  return { triangle, quad, box, loft, mirrorZ, setColor, clearColor, build, triangleCount };
}

/**
 * Hilfsfunktion: erzeugt aus Stationsdaten die Punktlinie einer Profilrolle.
 * stations: Array von { x, pts: [[y, z], ...] } — pts[role] liefert [y, z].
 */
export function roleLine(stations, role) {
  return stations.map((s) => [s.x, s.pts[role][0], s.pts[role][1]]);
}

/**
 * Loftet einen kompletten Stationssatz (halbe Karosserie, z >= 0) Band für Band.
 * bands: Array von { shade | shadeFn, flipFn } je Rolle-Übergang; optional.
 */
export function loftStations(g, stations, bandCount, bandStyle = {}) {
  for (let s = 0; s < stations.length - 1; s++) {
    for (let r = 0; r < bandCount; r++) {
      const style = bandStyle[r] || {};
      const shade = typeof style.shade === 'function' ? style.shade(s) : (style.shade ?? 2);
      const flip = typeof style.flip === 'function' ? style.flip(s) : ((s + r) % 2 === 1);
      const a0 = stations[s].pts[r]; const a1 = stations[s].pts[r + 1];
      const b0 = stations[s + 1].pts[r]; const b1 = stations[s + 1].pts[r + 1];
      const x0 = stations[s].x; const x1 = stations[s + 1].x;
      g.quad(
        [x0, a0[0], a0[1]], [x0, a1[0], a1[1]],
        [x1, b1[0], b1[1]], [x1, b0[0], b0[1]],
        shade, flip,
      );
    }
  }
}
