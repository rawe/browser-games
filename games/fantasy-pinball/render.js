import { TABLE } from './board-definition.js';

const COLORS = Object.freeze({
  wall: '#7f8aa8',
  launcher: '#687590',
  ramp: '#56cfe1',
  bumper: '#f7c95c',
  target: '#d96b78',
});

function polygon(ctx, vertices) {
  ctx.beginPath();
  ctx.moveTo(vertices[0].x, vertices[0].y);
  for (let i = 1; i < vertices.length; i += 1) ctx.lineTo(vertices[i].x, vertices[i].y);
  ctx.closePath();
}

function roundedSegment(ctx, element, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = element.thickness;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(element.ax, element.ay);
  ctx.lineTo(element.bx, element.by);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,.18)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function createRenderer(canvas, board, physics) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const pulses = new Map();
  let backdropGradient = null;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.round(TABLE.width * dpr);
    const height = Math.round(TABLE.height * dpr);
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    backdropGradient = ctx.createLinearGradient(0, 0, 0, TABLE.height);
    backdropGradient.addColorStop(0, '#162844');
    backdropGradient.addColorStop(0.52, '#111c34');
    backdropGradient.addColorStop(1, '#090e1c');
  }

  function pulse(id, now) {
    if (id) pulses.set(id, now);
  }

  function pulseStrength(id, now) {
    const start = pulses.get(id);
    if (start === undefined) return 0;
    const amount = 1 - (now - start) / 260;
    if (amount <= 0) { pulses.delete(id); return 0; }
    return amount;
  }

  function drawBackdrop(now) {
    ctx.fillStyle = backdropGradient;
    ctx.fillRect(0, 0, TABLE.width, TABLE.height);

    ctx.save();
    ctx.globalAlpha = 0.12;
    ctx.strokeStyle = '#9fc8ff';
    ctx.lineWidth = 1;
    for (let y = 105; y < 790; y += 84) {
      ctx.beginPath();
      ctx.arc(TABLE.width / 2, y, 72 + y * 0.15, Math.PI * 0.12, Math.PI * 0.88);
      ctx.stroke();
    }
    ctx.globalAlpha = 0.16 + Math.sin(now * 0.0013) * 0.025;
    for (let i = 0; i < 22; i += 1) {
      const x = 52 + (i * 83) % 432;
      const y = 70 + (i * 137) % 700;
      ctx.fillStyle = i % 3 ? '#9fc8ff' : '#f7c95c';
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.restore();

    // Die Runenrampe ist als eigener Weg schon unter ihren Kollisionsschienen sichtbar.
    ctx.save();
    ctx.fillStyle = 'rgba(42, 179, 196, .13)';
    ctx.beginPath();
    ctx.moveTo(316, 687);
    ctx.lineTo(342, 486);
    ctx.lineTo(415, 468);
    ctx.lineTo(376, 694);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawElement(element, now) {
    if (!element.active || element.type === 'drain' || element.type === 'npc-slot') return;
    const scale = element.presentation.scale;
    const hit = pulseStrength(element.id, now);

    if (element.type === 'segment') {
      const color = COLORS[element.role] ?? COLORS.wall;
      roundedSegment(ctx, element, color);
      return;
    }

    ctx.save();
    ctx.translate(element.x, element.y);
    ctx.rotate(element.angle ?? 0);
    ctx.scale(scale, scale);
    if (element.presentation.glow > 0 || hit > 0) {
      ctx.shadowColor = element.dynamic ? '#b896ff' : '#fff3a6';
      ctx.shadowBlur = 10 + 24 * Math.max(element.presentation.glow, hit);
    }

    if (element.type === 'bumper') {
      ctx.fillStyle = element.dynamic ? '#8e6ad8' : COLORS.bumper;
      ctx.strokeStyle = hit > 0 ? '#fff' : '#ffe9a3';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, element.radius * (1 + hit * 0.08), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1c2440';
      ctx.beginPath();
      ctx.arc(0, 0, element.radius * 0.42, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 8; i += 1) {
        ctx.rotate(Math.PI / 4);
        ctx.beginPath();
        ctx.moveTo(element.radius * 0.5, 0);
        ctx.lineTo(element.radius * 0.78, 0);
        ctx.stroke();
      }
    } else if (element.type === 'target' || element.type === 'gate') {
      ctx.fillStyle = element.accent ? '#a476dc' : (element.type === 'gate' ? '#53c8d6' : COLORS.target);
      ctx.strokeStyle = hit > 0 ? '#fff' : 'rgba(255,255,255,.6)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(-element.width / 2, -element.height / 2, element.width, element.height, 5);
      ctx.fill();
      ctx.stroke();
      if (element.accent) {
        ctx.fillStyle = '#f5eaff';
        ctx.font = 'bold 17px Georgia';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('ᚱ', 0, 0);
      }
    } else if (element.type === 'post') {
      ctx.fillStyle = '#d9e0ef';
      ctx.strokeStyle = '#75829f';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(0, 0, element.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawFlippers() {
    for (const flipper of physics.flippers.list) {
      ctx.save();
      ctx.shadowColor = '#ed5e80';
      ctx.shadowBlur = physics.flippers.controls[flipper.definition.side] ? 10 : 4;
      polygon(ctx, flipper.body.vertices);
      ctx.fillStyle = '#d84e6d';
      ctx.fill();
      ctx.strokeStyle = '#ffb2c2';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = '#f6d7de';
      ctx.beginPath();
      ctx.arc(flipper.definition.pivotX, flipper.definition.pivotY, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawBall() {
    const ball = physics.ball;
    if (!ball) return;
    const { x, y } = ball.position;
    ctx.save();
    ctx.shadowColor = '#d9f4ff';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#8293a8';
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#eaf5fb';
    ctx.beginPath();
    ctx.arc(x - 3.5, y - 4, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - 5, y - 5.5, 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function frame(now) {
    resize();
    ctx.clearRect(0, 0, TABLE.width, TABLE.height);
    drawBackdrop(now);
    for (const element of board.elements.values()) drawElement(element, now);
    drawFlippers();
    drawBall();
  }

  resize();
  return { frame, resize, pulse };
}
