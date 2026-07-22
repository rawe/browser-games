// Einfacher Computergegner: teilt die Truppe in Haupt- und Nebenstoß auf,
// stellt ab mittlerer Truppengröße Verteidiger ab und fusioniert Angreifer
// per Folgen-Befehl zu schlagkräftigen Gruppen.

const WEST = ['wn', 'ws'];
const EAST = ['en', 'es'];

export function aiPlan(unitCount, map, faction, rng = Math.random) {
  const orders = new Array(unitCount).fill(null);
  if (unitCount === 1) return orders; // Auto-Angriff auf den Boss

  const ownGate = faction === 'red' ? 'rgate' : 'sgate';
  const enemyGate = faction === 'red' ? 'sgate' : 'rgate';
  // Routen aus Sicht der eigenen Seite ordnen (rot zieht nach Süden, blau nach Norden).
  const routeFor = (r) => (faction === 'red' ? [...r] : [...r].reverse());

  let defenders = 0;
  if (unitCount >= 4) defenders = 1;
  if (unitCount >= 8) defenders = 2;
  if (defenders >= 1) orders[unitCount - 1] = { type: 'defend', target: ownGate };
  if (defenders >= 2) orders[unitCount - 2] = { type: 'defend', target: map.bosses[faction] };

  const attackers = [];
  for (let i = 0; i < unitCount - defenders; i++) attackers.push(i);

  const mainRoute = rng() < 0.5 ? WEST : EAST;
  const sideRoute = mainRoute === WEST ? EAST : WEST;
  const mainSize = Math.max(1, Math.ceil(attackers.length * 0.6));

  const mainLead = attackers[0];
  orders[mainLead] = { type: 'attack', targets: [...routeFor(mainRoute), enemyGate] };
  for (let k = 1; k < mainSize; k++) orders[attackers[k]] = { type: 'follow', target: mainLead };

  if (attackers.length > mainSize) {
    const sideLead = attackers[mainSize];
    // Der Nebenstoß nimmt gelegentlich die Feldmitte mit – etwas Varianz.
    const viaMid = rng() < 0.35;
    const targets = viaMid
      ? [routeFor(sideRoute)[0], 'mid', routeFor(sideRoute)[1], enemyGate]
      : [...routeFor(sideRoute), enemyGate];
    orders[sideLead] = { type: 'attack', targets };
    for (let k = mainSize + 1; k < attackers.length; k++) {
      orders[attackers[k]] = { type: 'follow', target: sideLead };
    }
  }
  return orders;
}
