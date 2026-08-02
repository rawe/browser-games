export const WORLD = { width: 960, height: 660, hud: 42 };
export const TANK = { halfWidth: 17, top: 20, bottom: 7 };
export const WALL_MODES = [
  { id: 'open', name: 'Keine Wände' },
  { id: 'solid', name: 'Feste Wände' },
  { id: 'mirror', name: 'Spiegelwände' },
];

export const WEAPONS = [
  { id: 'granate', name: 'Feldgranate', icon: '●', radius: 28, damage: 48, cost: 0, stock: Infinity, kind: 'blast', description: 'Zuverlässige Standardexplosion.' },
  { id: 'brecher', name: 'Brecher', icon: '◉', radius: 48, damage: 76, cost: 180, stock: 2, kind: 'blast', description: 'Größerer Krater und kräftige Druckwelle.' },
  { id: 'nuke', name: '20-kT-Nova', icon: '☢', radius: 82, damage: 105, cost: 440, stock: 1, kind: 'nuke', description: 'Gewaltige Explosion für ganze Hügelkuppen.' },
  { id: 'mirv', name: 'MIRV-Fächer', icon: '✣', radius: 24, damage: 38, cost: 380, stock: 1, mirv: true, kind: 'mirv', description: 'Fünf Einschläge nebeneinander.' },
  { id: 'bohrer', name: 'Kettenbohrer', icon: '⌁', radius: 20, damage: 34, cost: 270, stock: 2, burrow: true, kind: 'drill', description: 'Frisst einen tiefen Schacht in den Boden.' },
  { id: 'erde-klein', name: 'Erdkapsel', icon: '▴', radius: 25, damage: 0, cost: 110, stock: 3, dirt: true, kind: 'dirt', description: 'Baut einen kleinen schützenden Hügel.' },
  { id: 'erde', name: 'Erdformer', icon: '▲', radius: 46, damage: 0, cost: 190, stock: 2, dirt: true, kind: 'dirt', description: 'Erzeugt eine massive Erdkugel.' },
  { id: 'erde-gross', name: 'Bergbauer', icon: '⛰', radius: 72, damage: 0, cost: 360, stock: 1, dirt: true, kind: 'dirt', description: 'Hebt einen ganzen Berg aus dem Nichts.' },
  { id: 'saeure', name: 'Säureregen', icon: '☂', radius: 60, damage: 24, cost: 340, stock: 1, acid: true, kind: 'acid', description: 'Löst eine breite Säule Erdreich nach unten auf.' },
  { id: 'laser', name: 'Prismenlaser', icon: '━', radius: 20, damage: 82, cost: 620, stock: 1000, laser: true, kind: 'laser', description: '1000 Energie; Leistung bestimmt Reichweite und Verbrauch.' },
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

export function placePlayers(players, terrain) {
  players.forEach((p, i) => {
    const section = terrain.length / players.length;
    p.x = Math.round(section * (i + 0.5));
    p.y = surfaceAt(terrain, p.x) - 9;
    p.hp = 100;
    p.deathTriggered = false;
    p.facing = i < players.length / 2 ? 1 : -1;
  });
}

export function shotVelocity(player) {
  const a = player.angle * Math.PI / 180;
  return { vx: Math.cos(a) * player.power * player.facing, vy: -Math.sin(a) * player.power };
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
  const p = { x: player.x + player.facing * 19, y: player.y - 12, ...v, age: 0 };
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
  const p = { x: player.x + player.facing * 15, y: player.y - 10, ...v, age: 0 };
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
