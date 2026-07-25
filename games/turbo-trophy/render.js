// Darstellung: Strecke einmalig auf ein Offscreen-Canvas backen, pro Frame
// Kamera, Fahrzeuge, Raketen und Partikel zeichnen – dazu die Minimap.

import { ROAD_WIDTH, WORLD } from './trackGeometry.js';

const MINIMAP_SIZE = 96;

/** Strecke (Gras, Curbs, Asphalt, Start/Ziel) als statisches Bild rendern. */
function bakeTrack(track) {
  const canvas = document.createElement('canvas');
  canvas.width = WORLD;
  canvas.height = WORLD;
  const g = canvas.getContext('2d');

  // Gras mit deterministischem Pseudo-Rauschen (gleiche Optik bei jedem Start).
  g.fillStyle = '#3f7d2e';
  g.fillRect(0, 0, WORLD, WORLD);
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  g.fillStyle = '#376e28';
  for (let i = 0; i < 2600; i++) g.fillRect(rnd() * WORLD, rnd() * WORLD, 4, 4);
  g.fillStyle = '#4a8f38';
  for (let i = 0; i < 1600; i++) g.fillRect(rnd() * WORLD, rnd() * WORLD, 3, 3);

  const path = () => {
    g.beginPath();
    g.moveTo(track.pts[0][0], track.pts[0][1]);
    for (let i = 1; i < track.n; i++) g.lineTo(track.pts[i][0], track.pts[i][1]);
    g.closePath();
  };
  g.lineJoin = 'round';
  g.lineCap = 'round';

  // Randsteine: weiße Basis, rote Striche darüber.
  path();
  g.strokeStyle = '#e9e9e9';
  g.lineWidth = ROAD_WIDTH + 16;
  g.stroke();
  path();
  g.strokeStyle = '#d3402f';
  g.setLineDash([20, 20]);
  g.stroke();
  g.setLineDash([]);

  path();
  g.strokeStyle = '#43474d';
  g.lineWidth = ROAD_WIDTH;
  g.stroke();
  path();
  g.strokeStyle = '#4b5057';
  g.lineWidth = ROAD_WIDTH - 26;
  g.stroke();

  path();
  g.strokeStyle = 'rgba(240,240,240,.55)';
  g.lineWidth = 4;
  g.setLineDash([22, 26]);
  g.stroke();
  g.setLineDash([]);

  // Start/Ziel-Schachbrett quer über die Fahrbahn.
  const a = track.pts[0];
  const b = track.pts[1];
  g.save();
  g.translate(a[0], a[1]);
  g.rotate(Math.atan2(b[1] - a[1], b[0] - a[0]));
  const sq = 12;
  const rows = Math.ceil(ROAD_WIDTH / sq);
  for (let col = 0; col < 3; col++) {
    for (let row = 0; row < rows; row++) {
      const y = -ROAD_WIDTH / 2 + row * sq;
      g.fillStyle = (col + row) % 2 === 0 ? '#f2f2f2' : '#111';
      g.fillRect(col * sq, y, sq, Math.min(sq, ROAD_WIDTH / 2 - y));
    }
  }
  g.restore();
  return canvas;
}

function drawCar(ctx, car, time) {
  if (car.respawn > 0) return;
  if (car.invuln > 0 && Math.floor(time / 5) % 2 === 0) return; // blinkt nach Respawn
  ctx.save();
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = 'rgba(0,0,0,.3)';
  ctx.fillRect(-14, -5, 28, 16);
  ctx.fillStyle = '#111';
  ctx.fillRect(-12, -10, 7, 4);
  ctx.fillRect(5, -10, 7, 4);
  ctx.fillRect(-12, 6, 7, 4);
  ctx.fillRect(5, 6, 7, 4);
  ctx.fillStyle = car.color;
  ctx.fillRect(-14, -7, 28, 14);
  ctx.fillStyle = 'rgba(255,255,255,.85)';
  ctx.fillRect(2, -5, 7, 10);
  ctx.fillStyle = 'rgba(0,0,0,.25)';
  ctx.fillRect(-14, -7, 6, 14);
  ctx.restore();
}

export function createRenderer(canvas, minimapCanvas) {
  const ctx = canvas.getContext('2d');
  const mctx = minimapCanvas.getContext('2d');
  let scale = 1;
  let baked = { track: null, image: null };

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Zoomstufe an die kürzere Bildschirmkante koppeln, damit auf dem Handy
    // ähnlich viel Strecke sichtbar ist wie am Desktop.
    scale = Math.max(0.62, Math.min(1.45, Math.min(window.innerWidth, window.innerHeight) / 460));
  }

  function drawMinimap(race) {
    const track = race.track;
    mctx.setTransform(2, 0, 0, 2, 0, 0);
    mctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    const s = (MINIMAP_SIZE - 8) / WORLD;
    const off = 4;
    mctx.beginPath();
    mctx.moveTo(off + track.pts[0][0] * s, off + track.pts[0][1] * s);
    for (let i = 1; i < track.n; i++) mctx.lineTo(off + track.pts[i][0] * s, off + track.pts[i][1] * s);
    mctx.closePath();
    mctx.lineJoin = 'round';
    mctx.strokeStyle = '#5a638f';
    mctx.lineWidth = 5;
    mctx.stroke();
    mctx.strokeStyle = '#20264a';
    mctx.lineWidth = 2.5;
    mctx.stroke();
    for (const car of race.cars) {
      if (car.respawn > 0) continue;
      const r = car.isPlayer ? 3 : 2.4;
      mctx.fillStyle = car.color;
      mctx.fillRect(off + car.x * s - r, off + car.y * s - r, r * 2, r * 2);
    }
  }

  function draw(race) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.fillStyle = '#20301a';
    ctx.fillRect(0, 0, w, h);
    if (!race) return;

    if (baked.track !== race.track) baked = { track: race.track, image: bakeTrack(race.track) };

    // Kamera läuft dem Spieler etwas voraus und bleibt am Weltrand stehen.
    const me = race.cars.find((c) => c.isPlayer);
    const viewW = w / scale;
    const viewH = h / scale;
    const camX = Math.max(-80, Math.min(WORLD - viewW + 80, me.x + Math.cos(me.angle) * 46 - viewW / 2));
    const camY = Math.max(-80, Math.min(WORLD - viewH + 80, me.y + Math.sin(me.angle) * 46 - viewH / 2));

    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-camX, -camY);
    ctx.drawImage(baked.image, 0, 0);

    for (const m of race.missiles) {
      ctx.save();
      ctx.translate(m.x, m.y);
      ctx.rotate(m.angle);
      ctx.fillStyle = '#eee';
      ctx.fillRect(-7, -2.5, 14, 5);
      ctx.fillStyle = '#ff5a2e';
      ctx.fillRect(4, -2.5, 4, 5);
      ctx.restore();
    }
    for (const car of race.cars) drawCar(ctx, car, race.time);
    for (const p of race.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawMinimap(race);
  }

  resize();
  return { resize, draw };
}
