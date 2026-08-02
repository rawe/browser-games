import { WORLD, WEAPONS, clamp, terrainFor, surfaceAt, crater, makePlayers, placePlayers, shotVelocity, stepProjectile, damageAt, chooseAiShot, living } from './game.js';

const $ = (id) => document.getElementById(id);
const canvas = $('battle');
const ctx = canvas.getContext('2d');
const el = Object.fromEntries(['hud','controls','title','menu','shop','turn-name','round-label','wind','angle','power','weapon','weapon-icon','weapon-name','weapon-stock','fire','credits','shop-list','shop-title','shop-round'].map((id) => [id, $(id)]));
let players = [], terrain = terrainFor(Date.now()), particles = [], trails = [], projectile = null;
let current = 0, round = 0, wind = 0, playing = false, waiting = false, nextTimer = 0;

function weaponBy(id) { return WEAPONS.find((w) => w.id === id); }
function active() { return players[current]; }
function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(innerWidth * dpr); canvas.height = Math.round(innerHeight * dpr);
  ctx.setTransform(canvas.width / WORLD.width, 0, 0, canvas.height / WORLD.height, 0, 0);
}

function sky() {
  const g = ctx.createLinearGradient(0, 0, 0, WORLD.height);
  g.addColorStop(0, '#071426'); g.addColorStop(.58, '#224a61'); g.addColorStop(1, '#ef8e55');
  ctx.fillStyle = g; ctx.fillRect(0, 0, WORLD.width, WORLD.height);
  ctx.fillStyle = '#ffe5a0'; ctx.beginPath(); ctx.arc(790, 128, 42, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffffff55';
  for (let i = 0; i < 34; i += 1) ctx.fillRect((i * 157) % 930, 78 + (i * 43) % 125, 2, 2);
  ctx.fillStyle = '#163343'; ctx.beginPath(); ctx.moveTo(0, 355);
  for (let x = 0; x <= WORLD.width; x += 40) ctx.lineTo(x, 318 + Math.sin(x * .021) * 31 + Math.sin(x * .007) * 24);
  ctx.lineTo(WORLD.width, WORLD.height); ctx.lineTo(0, WORLD.height); ctx.fill();
}

function drawTerrain() {
  const g = ctx.createLinearGradient(0, 250, 0, WORLD.height); g.addColorStop(0, '#758b49'); g.addColorStop(.08, '#374d2d'); g.addColorStop(1, '#17251d');
  ctx.fillStyle = g; ctx.beginPath(); ctx.moveTo(0, WORLD.height);
  for (let x = 0; x < terrain.length; x += 2) ctx.lineTo(x, terrain[x]);
  ctx.lineTo(WORLD.width, WORLD.height); ctx.fill();
  ctx.strokeStyle = '#b3bd6d'; ctx.lineWidth = 2; ctx.beginPath();
  for (let x = 0; x < terrain.length; x += 2) x ? ctx.lineTo(x, terrain[x]) : ctx.moveTo(x, terrain[x]);
  ctx.stroke();
}

function drawTank(p) {
  if (p.hp <= 0) return;
  p.y = surfaceAt(terrain, p.x) - 8;
  ctx.save(); ctx.translate(p.x, p.y);
  ctx.strokeStyle = '#061018'; ctx.lineWidth = 4; ctx.fillStyle = p.color;
  ctx.beginPath(); ctx.roundRect(-15, -7, 30, 12, 4); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, -9, 8, Math.PI, 0); ctx.fill(); ctx.stroke();
  const a = -p.angle * Math.PI / 180 * p.facing;
  ctx.strokeStyle = p.color; ctx.lineWidth = 5; ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(Math.cos(a) * 20, -10 + Math.sin(a) * 20); ctx.stroke();
  ctx.fillStyle = '#071321'; ctx.fillRect(-13, 7, 26, 4); ctx.restore();
  ctx.fillStyle = '#071321aa'; ctx.fillRect(p.x - 19, p.y + 15, 38, 5); ctx.fillStyle = p.hp > 35 ? '#67e777' : '#ff665b'; ctx.fillRect(p.x - 19, p.y + 15, 38 * p.hp / 100, 5);
  ctx.fillStyle = '#fff'; ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillText(p.name, p.x, p.y + 33);
  if (playing && p === active()) { ctx.strokeStyle = p.color; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 23, 0, Math.PI * 2); ctx.stroke(); }
}

function render() {
  ctx.setTransform(canvas.width / WORLD.width, 0, 0, canvas.height / WORLD.height, 0, 0);
  sky(); drawTerrain(); players.forEach(drawTank);
  if (projectile) { ctx.fillStyle = '#fff7c7'; ctx.beginPath(); ctx.arc(projectile.x, projectile.y, 4, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#ffffff66'; for (const t of trails) ctx.fillRect(t.x - 1, t.y - 1, 2, 2);
  for (const p of particles) { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1;
  requestAnimationFrame(render);
}

function updateHud() {
  if (!players.length) return; const p = active(); const w = weaponBy(p.weapon);
  el['turn-name'].textContent = p.name; el['turn-name'].style.color = p.color; el.hud.style.setProperty('--player', p.color);
  el['round-label'].textContent = `Runde ${round} · ${p.hp} Panzerung`; el.wind.textContent = `${wind > 0 ? '→' : wind < 0 ? '←' : '·'} ${Math.abs(wind)}`;
  el.angle.textContent = `${p.angle}° ${p.facing > 0 ? '→' : '←'}`; el.power.textContent = p.power;
  el['weapon-icon'].textContent = w.icon; el['weapon-name'].textContent = w.name; el['weapon-stock'].textContent = Number.isFinite(p.inventory[w.id]) ? p.inventory[w.id] : '∞';
}

function beginRound() {
  round += 1; terrain = terrainFor(Date.now() + round * 911); placePlayers(players, terrain); trails = []; particles = []; projectile = null;
  wind = Math.round((Math.random() - .5) * 95); current = Math.floor(Math.random() * players.length); playing = true; waiting = false;
  el.shop.hidden = true; el.hud.hidden = false; el.controls.hidden = false; updateHud(); maybeAi();
}

function cycleWeapon() {
  if (!playing || waiting || !active().human) return;
  const p = active(), available = WEAPONS.filter((w) => p.inventory[w.id] > 0);
  p.weapon = available[(available.findIndex((w) => w.id === p.weapon) + 1) % available.length].id; updateHud();
}

function fire() {
  const p = active(); if (!playing || waiting || p.hp <= 0) return;
  const w = weaponBy(p.weapon); if (p.inventory[w.id] <= 0) { p.weapon = 'granate'; updateHud(); return; }
  if (Number.isFinite(p.inventory[w.id])) p.inventory[w.id] -= 1;
  const v = shotVelocity(p); projectile = { x: p.x + p.facing * 17, y: p.y - 12, ...v, age: 0, weapon: w, shooter: p, split: false };
  waiting = true; trails = []; updateHud();
}

function explode(x, y, weapon, shooter) {
  const bursts = weapon.mirv ? [-48, -24, 0, 24, 48] : [0];
  for (const offset of bursts) {
    const bx = clamp(x + offset, 0, WORLD.width - 1);
    crater(terrain, bx, y, weapon.radius, weapon.dirt);
    damageAt(players, bx, y, weapon, shooter);
    for (let i = 0; i < Math.min(90, weapon.radius * 1.2); i += 1) particles.push({ x: bx, y, vx:(Math.random()-.5)*240, vy:-Math.random()*210, life:1, size:3+Math.random()*7, color: weapon.dirt ? '#a88a55' : i%3 ? '#ff9f36' : '#fff2a8' });
  }
  if (weapon.burrow) { for (let i=1;i<5;i+=1) crater(terrain,x,y+i*17,weapon.radius*.72); }
  settleTanks(); projectile = null; setTimeout(finishTurn, 900);
}

function settleTanks() {
  for (const p of players) { if (p.hp <= 0) continue; const old = p.y; p.y = surfaceAt(terrain, p.x) - 8; const fall = p.y - old; if (fall > 45) p.hp = Math.max(0, p.hp - Math.round((fall - 35) * .6)); }
}

function finishTurn() {
  const alive = living(players);
  if (alive.length <= 1) { if (alive[0]) { alive[0].wins += 1; alive[0].score += 300; } openShop(alive[0]); return; }
  do { current = (current + 1) % players.length; } while (players[current].hp <= 0);
  waiting = false; updateHud(); maybeAi();
}

function maybeAi() {
  clearTimeout(nextTimer); const p = active(); if (!playing || p.human) return;
  waiting = true; nextTimer = setTimeout(() => { chooseAiShot(p, players, terrain, wind); updateHud(); waiting = false; fire(); }, 650);
}

function openShop(winner) {
  playing = false; waiting = false; el.hud.hidden = true; el.controls.hidden = true; el.shop.hidden = false;
  el['shop-round'].textContent = round; el['shop-title'].textContent = winner ? `${winner.name} hält das Feld` : 'Keine Überlebenden'; renderShop();
}

function renderShop() {
  const buyer = players.find((p) => p.human) || players[0]; el.credits.textContent = buyer.score; el['shop-list'].replaceChildren();
  for (const w of WEAPONS.slice(1)) { const b = document.createElement('button'); b.className = 'shop-item'; b.disabled = buyer.score < w.cost;
    b.innerHTML = `<span>${w.icon}</span><span><b>${w.name}</b><small>Vorrat ${buyer.inventory[w.id]} · +${w.stock}</small></span><span class="price">${w.cost}</span>`;
    b.onclick = () => { if (buyer.score < w.cost) return; buyer.score -= w.cost; buyer.inventory[w.id] += w.stock; renderShop(); }; el['shop-list'].append(b); }
}

function tick(now) {
  const dt = Math.min(.025, (now - (tick.last || now)) / 1000); tick.last = now;
  if (projectile) {
    stepProjectile(projectile, dt, wind); trails.push({x:projectile.x,y:projectile.y}); if (trails.length > 300) trails.shift();
    const w = projectile.weapon;
    if (projectile && (projectile.x < 0 || projectile.x >= WORLD.width || projectile.y > WORLD.height)) { projectile = null; setTimeout(finishTurn, 350); }
    else if (projectile && projectile.y >= surfaceAt(terrain, projectile.x)) explode(projectile.x, projectile.y, w, projectile.shooter);
  }
  for (const p of particles) { p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=260*dt;p.life-=dt*1.25; } particles=particles.filter((p)=>p.life>0);
  requestAnimationFrame(tick);
}

function startGame() { const humans=+$('humans').value, cpus=+$('opponents').value; players=makePlayers(Math.min(6,humans+cpus),humans); round=0; el.title.hidden=true; beginRound(); }
function adjust(action) { if(!playing||waiting||!active().human)return; const p=active(); if(action==='angle-down')p.angle=clamp(p.angle-1,5,85); if(action==='angle-up')p.angle=clamp(p.angle+1,5,85); if(action==='power-down')p.power=clamp(p.power-15,100,900); if(action==='power-up')p.power=clamp(p.power+15,100,900); updateHud(); }

$('start').onclick=startGame; $('rules').onclick=()=>{$('rules-panel').hidden=false}; $('rules-close').onclick=()=>{$('rules-panel').hidden=true};
$('pause').onclick=()=>{el.menu.hidden=false}; $('resume').onclick=()=>{el.menu.hidden=true}; $('restart').onclick=()=>location.reload();
$('next-round').onclick=beginRound; el.weapon.onclick=cycleWeapon; el.fire.onclick=fire;
document.querySelectorAll('[data-action]').forEach((b)=>{b.onclick=()=>adjust(b.dataset.action)});
addEventListener('keydown',(e)=>{ if(e.key==='ArrowLeft')adjust('angle-down');if(e.key==='ArrowRight')adjust('angle-up');if(e.key==='ArrowDown')adjust('power-down');if(e.key==='ArrowUp')adjust('power-up');if(e.key==='Tab'){e.preventDefault();cycleWeapon()}if(e.code==='Space'){e.preventDefault();fire()} });
addEventListener('resize',resize); resize(); requestAnimationFrame(render); requestAnimationFrame(tick);
