// Gemeinsame Bauteile aller Fahrzeugtypen: Unterboden, Kappen, Radhäuser.
// Alle Funktionen arbeiten auf dem Stationsformat aus facetKit (halbe
// Karosserie, z >= 0, Rolle 0 = untere Seitenkante).

/** Flacher, geschlossener Unterboden (Normalen nach unten). */
export function underbody(g, stations, y = 0.14, widthScale = 0.94) {
  for (let s = 0; s < stations.length - 1; s++) {
    const z0 = stations[s].pts[0][1] * widthScale;
    const z1 = stations[s + 1].pts[0][1] * widthScale;
    const x0 = stations[s].x; const x1 = stations[s + 1].x;
    g.quad([x0, y, -z0], [x0, y, z0], [x1, y, z1], [x1, y, -z1], 0);
  }
}

/**
 * Schließt eine Station als Fächerfläche (Bug- oder Heckkappe).
 * dir = +1 für die Front (Normale +X), -1 für das Heck (Normale -X).
 */
export function capStation(g, station, centerY, dir, shade = 2) {
  const { x, pts } = station;
  const ring = [];
  for (let i = 0; i < pts.length; i++) ring.push([x, pts[i][0], pts[i][1]]);
  for (let i = pts.length - 2; i >= 0; i--) ring.push([x, pts[i][0], -pts[i][1]]);
  ring.push([x, pts[0][0], pts[0][1]]);
  const center = [x, centerY, 0];
  for (let i = 0; i < ring.length - 1; i++) {
    if (dir > 0) g.triangle(center, ring[i + 1], ring[i], shade);
    else g.triangle(center, ring[i], ring[i + 1], shade);
  }
}

/**
 * Dunkle Radhaus-Auskleidung: Innenwand plus Deckel unter dem Kotflügel,
 * beidseitig. wheels: [{ x, span, rimY, innerZ, outerZ }]
 */
export function wheelWells(g, wheels) {
  for (const w of wheels) {
    const x0 = w.x + w.span; const x1 = w.x - w.span;
    // Linke Seite (+Z): Innenwand zeigt nach außen, Deckel nach unten.
    g.quad([x0, 0.12, w.innerZ], [x0, w.rimY, w.innerZ], [x1, w.rimY, w.innerZ], [x1, 0.12, w.innerZ], 0);
    g.quad([x0, w.rimY, w.innerZ], [x0, w.rimY, w.outerZ], [x1, w.rimY, w.outerZ], [x1, w.rimY, w.innerZ], 0, true);
    // Rechte Seite (-Z): gespiegelte Windung.
    g.quad([x0, 0.12, -w.innerZ], [x1, 0.12, -w.innerZ], [x1, w.rimY, -w.innerZ], [x0, w.rimY, -w.innerZ], 0);
    g.quad([x0, w.rimY, -w.innerZ], [x1, w.rimY, -w.innerZ], [x1, w.rimY, -w.outerZ], [x0, w.rimY, -w.outerZ], 0, true);
  }
}
