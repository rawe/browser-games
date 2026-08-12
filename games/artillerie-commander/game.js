export const WORLD = { width: 960, height: 660, hud: 42 };
export const TANK = { halfWidth: 17, top: 20, bottom: 7 };
export const WALL_MODES = [
  { id: 'open', name: 'Keine Wände' },
  { id: 'solid', name: 'Feste Wände' },
  { id: 'mirror', name: 'Spiegelwände' },
];

export const WEAPONS = [
  { id: 'granate', name: 'Granate MK I', icon: '●', radius: 28, damage: 48, cost: 0, stock: Infinity, category: 'Sprengsätze', kind: 'blast', effect: 'blast', description: 'Zuverlässige Standardexplosion.' },
  { id: 'brecher', name: 'Brecher MK III', icon: '◉', radius: 48, damage: 76, cost: 260, stock: 2, category: 'Sprengsätze', kind: 'blast', effect: 'heavy', description: 'Doppelte Druckwelle und tiefer Krater.' },
  { id: 'titan', name: 'Titan MK VII', icon: '⬤', radius: 66, damage: 94, cost: 680, stock: 1, category: 'Sprengsätze', kind: 'nuke', effect: 'heavy', description: 'Schwere Flächenladung kurz unterhalb der Nuklearklasse.' },
  { id: 'nuke', name: 'Nova MK IX', icon: '☢', radius: 92, damage: 120, cost: 1300, stock: 1, category: 'Sprengsätze', kind: 'nuke', effect: 'nuke', description: 'Nuklearer Blitz und gewaltiger Krater.' },
  { id: 'mirv-3', name: 'MIRV Cluster 3', icon: '✣', radius: 25, damage: 40, cost: 360, stock: 2, category: 'Cluster', kind: 'mirv', effect: 'mirv', cluster: 3, description: 'Drei versetzte Einschläge.' },
  { id: 'mirv-5', name: 'MIRV Cluster 5', icon: '✣', radius: 25, damage: 38, cost: 650, stock: 1, category: 'Cluster', kind: 'mirv', effect: 'mirv', cluster: 5, description: 'Fünf Einschläge decken einen Hang ab.' },
  { id: 'mirv-7', name: 'MIRV Cluster 7', icon: '✺', radius: 24, damage: 35, cost: 1100, stock: 1, category: 'Cluster', kind: 'mirv', effect: 'mirv', cluster: 7, description: 'Sieben Sprengköpfe für ein ganzes Tal.' },
  { id: 'bohrer', name: 'Kettenbohrer', icon: '⌁', radius: 20, damage: 34, cost: 300, stock: 2, category: 'Geländebrecher', burrow: true, kind: 'drill', effect: 'drill', description: 'Frisst einen tiefen Schacht in den Boden.' },
  { id: 'saeure', name: 'Säure MK III', icon: '☂', radius: 55, damage: 22, cost: 390, stock: 2, category: 'Geländebrecher', acid: true, kind: 'acid', effect: 'acid', description: 'Zersetzt Erdreich; danach sackt der Hang ab.' },
  { id: 'saeure-9', name: 'Säure MK IX', icon: '☣', radius: 86, damage: 32, cost: 1050, stock: 1, category: 'Geländebrecher', acid: true, kind: 'acid', effect: 'acid', description: 'Löst einen breiten Bergabschnitt vollständig auf.' },
  { id: 'erde-klein', name: 'Erdformer MK I', icon: '▴', radius: 25, damage: 0, cost: 130, stock: 3, category: 'Erdformer', dirt: true, kind: 'dirt', effect: 'dirt', description: 'Kleine Erdkugel; Panzer können eingebettet werden.' },
  { id: 'erde', name: 'Erdformer MK III', icon: '▲', radius: 46, damage: 0, cost: 260, stock: 2, category: 'Erdformer', dirt: true, kind: 'dirt', effect: 'dirt', description: 'Erzeugt eine massive Erdkugel.' },
  { id: 'erde-gross', name: 'Erdformer MK IX', icon: '⛰', radius: 76, damage: 0, cost: 900, stock: 1, category: 'Erdformer', dirt: true, kind: 'dirt', effect: 'dirt', description: 'Hebt einen Berg und begräbt alles darin.' },
  { id: 'laser', name: 'Prismenlaser', icon: '━', radius: 16, damage: 0, cost: 760, stock: 1000, category: 'Energiewaffen', laser: true, kind: 'laser', effect: 'laser', description: '1000 Energie reichen für mehr als zwei Kartenbreiten.' },
];

const COLORS = ['#58c8ff', '#ff646f', '#ffd34e', '#8bf084', '#c58cff', '#ff9f43'];
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const mulberry32 = (seed) => () => {
  let t = seed += 0x6D2B79F5;
  t = Math.imul(t ^ t >>> 15, t | 1);
  t ^= t + Math.imul(t ^ t >>> 7, t | 61);
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};

export function terrainFor(seed, width = WORLD.width, height = WORLD.height) {
  const random = mulberry32(seed);
  const top = new Int16Array(width);
  const base = height * (0.58 + random() * 0.08);
  const a = 38 + random() * 40;
  const b = 18 + random() * 34;
  const f1 = 1.3 + random() * 1.8;
  const f2 = 3.4 + random() * 2.7;
  const p1 = random() * Math.PI * 2;
  const p2 = random() * Math.PI * 2;
  for (let x = 0; x < width; x += 1) {
    const n = (random() - 0.5) * 7;
    top[x] = Math.round(clamp(base + Math.sin(x / width * Math.PI * 2 * f1 + p1) * a
      + Math.sin(x / width * Math.PI * 2 * f2 + p2) * b + n, height * 0.37, height - 42));
  }
  return top;
}

export function surfaceAt(terrain, x) {
  return terrain[clamp(Math.round(x), 0, terrain.length - 1)];
}

export function crater(terrain, cx, cy, radius, fill = false, height = WORLD.height) {
  const start = Math.max(0, Math.floor(cx - radius));
  const end = Math.min(terrain.length - 1, Math.ceil(cx + radius));
  for (let x = start; x <= end; x += 1) {
    const dx = x - cx;
    const arc = Math.sqrt(Math.max(0, radius * radius - dx * dx));
    if (fill) terrain[x] = Math.min(terrain[x], Math.round(cy - arc * 0.72));
    else terrain[x] = Math.min(height, Math.max(terrain[x], Math.round(cy + arc * 0.72)));
  }
}

export function makePlayers(count, humans = 1) {
  return Array.from({ length: count }, (_, i) => ({
    id: i, name: i < humans ? `Commander ${i + 1}` : `CPU ${i - humans + 1}`,
    human: i < humans, color: COLORS[i], x: 0, y: 0, hp: 100, score: 700, wins: 0, deathTriggered: false,
    angle: 45, power: 480, facing: i < count / 2 ? 1 : -1, weapon: 'granate',
    inventory: Object.fromEntries(WEAPONS.map((w) => [w.id, w.id === 'granate' ? Infinity : 0])),
  }));
}

export function placePlayers(players, terrain, random = Math.random) {
  const positions = players.map((_, i) => {
    const section = terrain.length / players.length;
    return Math.round(section * (i + 0.18 + random() * 0.64));
  });
  for (let i = positions.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  players.forEach((p, i) => {
    p.x = positions[i];
    p.y = surfaceAt(terrain, p.x) - 9;
    p.hp = 100;
    p.deathTriggered = false;
    p.facing = p.x < terrain.length / 2 ? 1 : -1;
  });
}

export function shotVelocity(player) {
  const a = player.angle * Math.PI / 180;
  return { vx: Math.cos(a) * player.power * player.facing, vy: -Math.sin(a) * player.power };
}

export function muzzlePoint(player, length = 25) {
  const a = player.angle * Math.PI / 180;
  return {
    x: player.x + Math.cos(a) * length * player.facing,
    y: player.y - 10 - Math.sin(a) * length,
  };
}

export function stepProjectile(projectile, dt, wind) {
  projectile.vx += wind * dt;
  projectile.vy += 230 * dt;
  projectile.x += projectile.vx * dt;
  projectile.y += projectile.vy * dt;
  projectile.age += dt;
  return projectile;
}

export function tankAt(players, x, y, shooter = null, shotAge = Infinity, grace = 0.12) {
  return players.find((player) => player.hp > 0
    && !(player === shooter && shotAge < grace)
    && x >= player.x - TANK.halfWidth && x <= player.x + TANK.halfWidth
    && y >= player.y - TANK.top && y <= player.y + TANK.bottom) ?? null;
}

export function boundaryHit(projectile, mode, world = WORLD) {
  const left = projectile.x <= 0, right = projectile.x >= world.width;
  const top = projectile.y <= world.hud, bottom = projectile.y >= world.height;
  if (!left && !right && !top && !bottom) return null;
  if (mode === 'open') return { action: 'leave', bottom };
  if (mode === 'solid') return { action: 'explode', bottom };
  if (left || right) projectile.vx *= -1;
  if (top || bottom) projectile.vy *= -1;
  projectile.x = clamp(projectile.x, 1, world.width - 1);
  projectile.y = clamp(projectile.y, world.hud + 1, world.height - 1);
  return { action: 'bounce', bottom };
}

export function previewPath(player, terrain, wind, wallMode = 'open', seconds = 0.72) {
  const v = shotVelocity(player);
  const muzzle = muzzlePoint(player);
  const p = { ...muzzle, ...v, age: 0 };
  const points = [];
  for (let i = 0; i < seconds * 120; i += 1) {
    stepProjectile(p, 1 / 120, wind);
    const edge = boundaryHit(p, wallMode);
    points.push({ x: p.x, y: p.y });
    if ((edge && edge.action !== 'bounce') || p.y >= surfaceAt(terrain, p.x)) break;
    if (edge?.action === 'bounce') break;
  }
  return points;
}

export function predictImpact(player, terrain, wind, weapon = WEAPONS[0]) {
  const v = shotVelocity(player);
  const muzzle = muzzlePoint(player);
  const p = { ...muzzle, ...v, age: 0 };
  for (let i = 0; i < 1200; i += 1) {
    stepProjectile(p, 1 / 120, wind);
    if (p.x < 0 || p.x >= terrain.length || p.y > WORLD.height) return { x: p.x, y: p.y, out: true };
    if (p.y >= surfaceAt(terrain, p.x)) return { x: p.x, y: p.y, weapon };
  }
  return { x: p.x, y: p.y, out: true };
}

export function damageAt(players, x, y, weapon, shooter) {
  const hits = [];
  for (const player of players) {
    if (player.hp <= 0) continue;
    const distance = Math.hypot(player.x - x, player.y - y);
    if (distance >= weapon.radius) continue;
    const damage = Math.round(weapon.damage * (1 - distance / weapon.radius));
    player.hp = Math.max(0, player.hp - damage);
    if (damage) hits.push({ player, damage });
    if (player !== shooter && damage) shooter.score += damage * 2;
    if (player.hp === 0 && player !== shooter) shooter.score += 100;
  }
  return hits;
}

export function chooseAiShot(player, targets, terrain, wind) {
  const target = targets.filter((p) => p.hp > 0 && p !== player)
    .sort((a, b) => Math.abs(a.x - player.x) - Math.abs(b.x - player.x))[0];
  if (!target) return player;
  player.facing = target.x >= player.x ? 1 : -1;
  let best = { miss: Infinity, angle: 45, power: 450 };
  for (let angle = 18; angle <= 78; angle += 3) {
    for (let power = 220; power <= 850; power += 24) {
      player.angle = angle; player.power = power;
      const hit = predictImpact(player, terrain, wind);
      const miss = hit.out ? 9999 : Math.abs(hit.x - target.x);
      if (miss < best.miss) best = { miss, angle, power };
    }
  }
  player.angle = clamp(best.angle + Math.round((Math.random() - 0.5) * 5), 0, 180);
  player.power = clamp(best.power + Math.round((Math.random() - 0.5) * 28), 100, 900);
  return player;
}

export function living(players) { return players.filter((p) => p.hp > 0); }
