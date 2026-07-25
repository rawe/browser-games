// Computergegner „Leicht": stellt aus dem Ressourcenbudget eine zufällig
// gemischte Armee zusammen, teilt die zähesten Einheiten als Wachen für die
// eigenen Zugänge ein und verteilt die Angreifer auf zwei verschiedene Routen
// zum gegnerischen Boss. Vollständig datengetrieben über UNIT_TYPES, ROUTES und
// GUARD_POSTS – keine typ- oder kartenspezifischen Sonderfälle.
//
// Diese Stufe plant bewusst grob: keine Auftragsketten, keine Events, keine
// Abstimmung zwischen den Trupps. Sie ist der Einstiegsgegner (siehe ai-hard.js
// für die taktisch spielende Stufe).

import { resolveUnitTypes, resolveUnitTypeMap } from './config.js';
import { ROUTES, GUARD_POSTS, enemyOf } from './map.js';

export function planEasy(config, map, faction, rng = Math.random) {
  // Effektive Einheitenwerte dieser Partie (Datei-Defaults ggf. überschrieben).
  const unitTypes = resolveUnitTypes(config);
  const byKey = resolveUnitTypeMap(config);
  const units = [];
  let remaining = config.resources;
  for (;;) {
    const options = unitTypes.filter((t) => t.cost <= remaining);
    if (!options.length) break;
    const pick = options[Math.floor(rng() * options.length)];
    units.push({ type: pick.key, path: [], stance: 'attack' });
    remaining -= pick.cost;
  }

  // Ab mittlerer Armeegröße bewachen die zähesten Einheiten die eigenen
  // Zugänge (Zähigkeit datengetrieben über die Hitpoints des Typs).
  const byToughness = units
    .map((u, i) => ({ i, hp: byKey[u.type].hp }))
    .sort((a, b) => b.hp - a.hp || a.i - b.i);
  const guardCount = units.length >= 6 ? 2 : units.length >= 4 ? 1 : 0;
  const posts = GUARD_POSTS[faction];
  for (let k = 0; k < guardCount; k++) {
    const u = units[byToughness[k].i];
    u.stance = 'defend';
    u.path = [posts[k % posts.length]];
  }

  // Angreifer auf Haupt- und Nebenstoß über zwei verschiedene Routen verteilen.
  const attackers = units.filter((u) => u.stance === 'attack');
  const routes = ROUTES[faction];
  const mainIdx = Math.floor(rng() * routes.length);
  let sideIdx = Math.floor(rng() * (routes.length - 1));
  if (sideIdx >= mainIdx) sideIdx += 1;
  const mainCount = Math.max(1, Math.ceil(attackers.length * 0.6));
  attackers.forEach((u, k) => {
    u.path = [...routes[k < mainCount ? mainIdx : sideIdx].path];
  });

  // Ab zwei Angreifern macht der letzte einen Abstecher zu einem neutralen
  // Friedhof und nimmt ihn ein; danach marschiert er auf kürzestem Weg weiter
  // zum gegnerischen Boss (datengetrieben über die Friedhofskonfiguration).
  const neutral = map.graveyardIds.filter((id) => map.graveyards[id].owner == null);
  if (neutral.length && attackers.length >= 2) {
    attackers[attackers.length - 1].path = [neutral[Math.floor(rng() * neutral.length)]];
  }

  // Vorratslager: Ab mittlerer Armeegröße schickt die leichte Stufe gelegentlich
  // eine Einheit zum eigenen Lager (map.supplyCampOf) – Pfadende = Lager, sonst
  // wäre es nur ein Durchmarsch. Sie bleibt in Haltung „Angriff" stehen, bis das
  // Lager liefert, und zieht dann von selbst weiter zum gegnerischen Fürsten.
  // Bewusst grob und zufällig: Diese Stufe rechnet nicht nach, ob sich der
  // Umweg lohnt (die Abwägung steht in ai-hard.js).
  const ownCamp = config.supplyEnabled ? (map.supplyCampOf?.[faction] ?? null) : null;
  if (ownCamp && attackers.length >= 3 && rng() < 0.5) {
    attackers[0].path = [ownCamp];
  }

  // Türme: ein Teil der bossgebundenen Angreifer nimmt gegnerische Türme ins
  // Visier – der Pfad endet am Turm, wodurch der Turm angegriffen wird; nach
  // seiner Zerstörung schwächt das den gegnerischen Fürsten. Es bleibt stets
  // mindestens ein Angreifer direkt bossgebunden. Datengetrieben über die
  // Turmkonfiguration der Karte (map.towerSites) und config.towersPerFaction.
  const enemy = enemyOf(faction);
  const enemyBoss = map.bosses[enemy];
  const enemyTowers = (map.towerSites?.[enemy] ?? []).slice(0, config.towersPerFaction ?? 0);
  const bossBound = attackers.filter((u) => u.path[u.path.length - 1] === enemyBoss);
  const towerBudget = Math.min(
    enemyTowers.length,
    Math.max(0, bossBound.length - 1),
    attackers.length >= 4 ? 2 : 1
  );
  for (let k = 0; k < towerBudget; k++) {
    const tower = enemyTowers[k];
    const route = routes.find((r) => r.path.includes(tower));
    if (!route) continue;
    bossBound[k].path = route.path.slice(0, route.path.indexOf(tower) + 1);
  }

  return units;
}
