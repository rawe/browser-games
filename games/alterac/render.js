// Canvas-Renderer: zeichnet die Karte (vorgerenderter Hintergrund), Knoten,
// Einheiten-Token, Planungs-Overlays und Effekte. Keine Spiellogik.

import { FACTIONS, enemyOf, edgePoint, shortestPath } from './map.js';

const TAU = Math.PI * 2;

// Deterministischer Zufall für die Landschaftsdeko.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createRenderer(canvas, map) {
  const W = map.width;
  const H = map.height;
  const ctx = canvas.getContext('2d');
  const bg = document.createElement('canvas');
  let scale = 1;
  let anim = 0; // fortlaufende Animationszeit in Sekunden

  const snow = [];
  {
    const rnd = mulberry32(7);
    for (let i = 0; i < 70; i++) {
      snow.push({
        x: rnd() * W,
        y: rnd() * H,
        r: 0.8 + rnd() * 1.8,
        vy: 14 + rnd() * 22,
        drift: rnd() * TAU,
      });
    }
  }

  function resize() {
    const cssWidth = canvas.clientWidth || W;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    scale = (cssWidth * dpr) / W;
    canvas.width = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    paintBackground();
  }

  // ---------------------------------------------------------------- Hintergrund
  function paintBackground() {
    bg.width = canvas.width;
    bg.height = canvas.height;
    const b = bg.getContext('2d');
    b.setTransform(scale, 0, 0, scale, 0, 0);

    const grad = b.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, '#2b2230');
    grad.addColorStop(0.2, '#232837');
    grad.addColorStop(0.5, '#1d2431');
    grad.addColorStop(0.8, '#1f2b3d');
    grad.addColorStop(1, '#20304a');
    b.fillStyle = grad;
    b.fillRect(0, 0, W, H);

    // Fraktionsglühen an beiden Enden.
    for (const [color, y] of [
      ['rgba(255,107,94,0.14)', 80],
      ['rgba(91,156,255,0.14)', 890],
    ]) {
      const g = b.createRadialGradient(240, y, 20, 240, y, 300);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      b.fillStyle = g;
      b.fillRect(0, 0, W, H);
    }

    // Bergketten an den Rändern.
    const rnd = mulberry32(42);
    drawRidge(b, rnd, true);
    drawRidge(b, rnd, false);

    // Schneefelder (weiche helle Flecken).
    for (let i = 0; i < 26; i++) {
      const x = 60 + rnd() * (W - 120);
      const y = 60 + rnd() * (H - 120);
      const r = 24 + rnd() * 60;
      const g = b.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(226,238,252,0.05)');
      g.addColorStop(1, 'rgba(226,238,252,0)');
      b.fillStyle = g;
      b.beginPath();
      b.arc(x, y, r, 0, TAU);
      b.fill();
    }

    // Wege.
    for (const e of map.edges) drawRoad(b, e);

    // Kiefern in den Randbereichen (nicht auf Wegen/Knoten).
    for (let i = 0; i < 46; i++) {
      const side = rnd();
      let x;
      if (side < 0.4) x = 14 + rnd() * 52;
      else if (side < 0.8) x = W - 66 + rnd() * 52;
      else x = 190 + rnd() * 100;
      const y = 120 + rnd() * (H - 220);
      if (nearNodeOrRoad(x, y)) continue;
      drawPine(b, x, y, 8 + rnd() * 9);
    }

    // Vignette.
    const v = b.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(4,6,10,0.42)');
    b.fillStyle = v;
    b.fillRect(0, 0, W, H);
  }

  function nearNodeOrRoad(x, y) {
    for (const n of map.nodeList) {
      if (Math.hypot(n.x - x, n.y - y) < 58) return true;
    }
    for (const e of map.edges) {
      for (let t = 0; t <= 1; t += 0.1) {
        const p = edgePoint(map, e.a, e.b, t);
        if (Math.hypot(p.x - x, p.y - y) < 34) return true;
      }
    }
    return false;
  }

  function drawRidge(b, rnd, left) {
    for (const [depth, color] of [
      [58, 'rgba(9,13,21,0.85)'],
      [34, 'rgba(15,21,32,0.9)'],
    ]) {
      b.beginPath();
      const edgeX = left ? 0 : W;
      b.moveTo(edgeX, 0);
      let y = 0;
      while (y < H) {
        const peak = depth * (0.5 + rnd() * 0.8);
        const px = left ? peak : W - peak;
        y += 40 + rnd() * 70;
        b.lineTo(px, Math.min(y, H));
      }
      b.lineTo(edgeX, H);
      b.closePath();
      b.fillStyle = color;
      b.fill();
    }
  }

  function roadPath(b, e) {
    b.beginPath();
    const p0 = edgePoint(map, e.a, e.b, 0);
    b.moveTo(p0.x, p0.y);
    for (let t = 0.08; t <= 1.001; t += 0.08) {
      const p = edgePoint(map, e.a, e.b, Math.min(t, 1));
      b.lineTo(p.x, p.y);
    }
  }

  function drawRoad(b, e) {
    b.lineCap = 'round';
    b.lineJoin = 'round';
    roadPath(b, e);
    b.strokeStyle = 'rgba(6,9,15,0.9)';
    b.lineWidth = 15;
    b.stroke();
    roadPath(b, e);
    b.strokeStyle = '#39445a';
    b.lineWidth = 10;
    b.stroke();
    roadPath(b, e);
    b.strokeStyle = 'rgba(230,240,255,0.14)';
    b.lineWidth = 1.6;
    b.setLineDash([7, 11]);
    b.stroke();
    b.setLineDash([]);
  }

  function drawPine(b, x, y, s) {
    b.fillStyle = '#101820';
    b.fillRect(x - 1, y, 2, s * 0.35);
    for (const [f, dy] of [
      [1.0, 0],
      [0.75, -s * 0.45],
    ]) {
      b.beginPath();
      b.moveTo(x, y - s * 1.15 + dy);
      b.lineTo(x - s * 0.52 * f, y + dy);
      b.lineTo(x + s * 0.52 * f, y + dy);
      b.closePath();
      b.fillStyle = '#26443f';
      b.fill();
    }
    b.beginPath();
    b.moveTo(x, y - s * 1.6);
    b.lineTo(x - s * 0.2, y - s * 1.2);
    b.lineTo(x + s * 0.2, y - s * 1.2);
    b.closePath();
    b.fillStyle = 'rgba(226,238,252,0.75)';
    b.fill();
  }

  // ---------------------------------------------------------------- Bausteine
  function label(x, y, text, opts = {}) {
    ctx.font = `${opts.weight ?? 500} ${opts.size ?? 11}px system-ui, sans-serif`;
    ctx.textAlign = opts.align ?? 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(5,8,13,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = opts.color ?? '#aebacd';
    ctx.fillText(text, x, y);
  }

  function drawCombatNode(n, ring) {
    ctx.beginPath();
    ctx.arc(n.x, n.y, 16, 0, TAU);
    const fill = ctx.createRadialGradient(n.x - 4, n.y - 5, 2, n.x, n.y, 16);
    fill.addColorStop(0, '#57667f');
    fill.addColorStop(1, '#2c3648');
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0a0f18';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(n.x, n.y, 10.5, 0, TAU);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(226,238,252,0.28)';
    ctx.stroke();
    if (ring) {
      ctx.beginPath();
      ctx.arc(n.x, n.y, 20, 0, TAU);
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = ring;
      ctx.stroke();
    }
  }

  function drawGraveyard(n) {
    const c = FACTIONS[n.faction];
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + 8, 15, 6, 0, 0, TAU);
    ctx.fillStyle = 'rgba(226,238,252,0.10)';
    ctx.fill();
    // Grabstein
    ctx.beginPath();
    ctx.moveTo(n.x - 6, n.y + 9);
    ctx.lineTo(n.x - 6, n.y - 4);
    ctx.arc(n.x, n.y - 4, 6, Math.PI, 0);
    ctx.lineTo(n.x + 6, n.y + 9);
    ctx.closePath();
    ctx.fillStyle = '#4a5468';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#0a0f18';
    ctx.stroke();
    // Kreuz
    ctx.strokeStyle = 'rgba(226,238,252,0.6)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(n.x, n.y - 6);
    ctx.lineTo(n.x, n.y + 2);
    ctx.moveTo(n.x - 3, n.y - 3);
    ctx.lineTo(n.x + 3, n.y - 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(n.x, n.y + 2, 13, 0, TAU);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = `${c.color}55`;
    ctx.stroke();
  }

  // Lebensanzeige: Balken mit aktuellem/maximalem Hitpoint-Stand darüber.
  function drawHpBar(cx, top, w, hp, maxHp) {
    const h = 5;
    const x = cx - w / 2;
    const ratio = Math.max(0, Math.min(1, hp / maxHp));
    const shown = hp > 0 ? Math.max(1, Math.round(hp)) : 0;
    ctx.fillStyle = 'rgba(5,8,13,0.85)';
    ctx.fillRect(x - 1.5, top - 1.5, w + 3, h + 3);
    ctx.fillStyle = '#2a3346';
    ctx.fillRect(x, top, w, h);
    ctx.fillStyle = ratio > 0.5 ? '#6ecf73' : ratio > 0.25 ? '#ffd76a' : '#ff6b5e';
    ctx.fillRect(x, top, w * ratio, h);
    label(cx, top - 7, `${shown}/${Math.round(maxHp)}`, { size: 9, weight: 700, color: '#e6eefb' });
  }

  function drawKeep(n, alive, bossState) {
    const c = FACTIONS[n.faction];
    // Plattform
    ctx.beginPath();
    ctx.ellipse(n.x, n.y + 16, 34, 11, 0, 0, TAU);
    ctx.fillStyle = 'rgba(10,15,24,0.65)';
    ctx.fill();
    // Turmkörper
    const w = 34;
    const h = 40;
    const x0 = n.x - w / 2;
    const y0 = n.y - h / 2 - 2;
    const stone = ctx.createLinearGradient(x0, y0, x0, y0 + h);
    stone.addColorStop(0, alive ? '#5d6a83' : '#3a4150');
    stone.addColorStop(1, alive ? '#333d52' : '#242a36');
    ctx.fillStyle = stone;
    ctx.fillRect(x0, y0, w, h);
    // Zinnen
    for (let i = 0; i < 4; i++) {
      ctx.fillRect(x0 + i * (w / 3.6), y0 - 6, w / 6, 7);
    }
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = '#0a0f18';
    ctx.strokeRect(x0, y0, w, h);
    // Tor
    ctx.beginPath();
    ctx.moveTo(n.x - 6, y0 + h);
    ctx.lineTo(n.x - 6, y0 + h - 12);
    ctx.arc(n.x, y0 + h - 12, 6, Math.PI, 0);
    ctx.lineTo(n.x + 6, y0 + h);
    ctx.closePath();
    ctx.fillStyle = '#12161f';
    ctx.fill();
    // Banner
    ctx.strokeStyle = '#0a0f18';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(n.x, y0 - 6);
    ctx.lineTo(n.x, y0 - 24);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(n.x, y0 - 24);
    ctx.lineTo(n.x + 16, y0 - 19);
    ctx.lineTo(n.x, y0 - 14);
    ctx.closePath();
    ctx.fillStyle = alive ? c.color : '#566073';
    ctx.fill();
    if (alive) {
      drawHpBar(n.x, y0 - 34, 48, bossState.hp, bossState.maxHp);
    } else {
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(255,90,80,0.9)';
      ctx.beginPath();
      ctx.moveTo(x0 - 4, y0 - 4);
      ctx.lineTo(x0 + w + 4, y0 + h + 4);
      ctx.moveTo(x0 + w + 4, y0 - 4);
      ctx.lineTo(x0 - 4, y0 + h + 4);
      ctx.stroke();
    }
  }

  function drawShieldIcon(x, y, s, color) {
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + s, y - s, x + s, y - s * 0.3);
    ctx.quadraticCurveTo(x + s, y + s * 0.55, x, y + s);
    ctx.quadraticCurveTo(x - s, y + s * 0.55, x - s, y - s * 0.3);
    ctx.quadraticCurveTo(x - s, y - s, x, y - s);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = '#0a0f18';
    ctx.stroke();
  }

  function drawSwords(x, y, t) {
    const flash = 0.55 + 0.45 * Math.sin(t * 7);
    ctx.beginPath();
    ctx.arc(x, y, 15, 0, TAU);
    ctx.fillStyle = `rgba(255,214,106,${0.12 + flash * 0.12})`;
    ctx.fill();
    ctx.lineCap = 'round';
    for (const rot of [-Math.PI / 4, Math.PI / 4]) {
      const dx = Math.cos(rot);
      const dy = Math.sin(rot);
      ctx.strokeStyle = '#e8eef8';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(x - dx * 11, y - dy * 11);
      ctx.lineTo(x + dx * 11, y + dy * 11);
      ctx.stroke();
      // Parierstange
      ctx.strokeStyle = '#b9884a';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(x + dx * 5 - dy * 4, y + dy * 5 + dx * 4);
      ctx.lineTo(x + dx * 5 + dy * 4, y + dy * 5 - dx * 4);
      ctx.stroke();
    }
  }

  function drawToken(x, y, g, opts = {}) {
    const c = FACTIONS[g.faction];
    const r = 11 + Math.min(9, g.size * 1.4);
    ctx.save();
    if (opts.ghost) ctx.globalAlpha = 0.45;
    if (g.fighting) {
      const pulse = 0.5 + 0.5 * Math.sin(anim * 8);
      ctx.beginPath();
      ctx.arc(x, y, r + 4 + pulse * 2, 0, TAU);
      ctx.strokeStyle = `rgba(255,120,100,${0.5 + pulse * 0.4})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(x, y + 2, r, 0, TAU);
    ctx.fillStyle = 'rgba(4,7,12,0.5)';
    ctx.fill();
    const fill = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.2, x, y, r);
    fill.addColorStop(0, c.color);
    fill.addColorStop(1, c.dark);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(8,12,20,0.9)';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, r - 2.5, -TAU * 0.38, -TAU * 0.08);
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    label(x, y + 0.5, String(g.size), { color: '#fff', weight: 700, size: r > 14 ? 13 : 12 });
    if (g.maxHp != null && !opts.ghost) {
      drawHpBar(x, y - r - 11, Math.max(28, r * 2.1), g.hp, g.maxHp);
    }
    if (g.state === 'defending' && g.entrenched && !opts.ghost) {
      drawShieldIcon(x + r * 0.85, y - r * 0.85, 5.5, '#ffd76a');
    }
    if (opts.countdown != null) {
      ctx.beginPath();
      ctx.arc(x, y, r + 4, -Math.PI / 2, -Math.PI / 2 + TAU * opts.countdown);
      ctx.strokeStyle = 'rgba(226,238,252,0.85)';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  // Vollständige Route eines Plans (Start → Ziele → ggf. Boss) als Punktliste.
  function routePoints(nodeSeq) {
    const pts = [];
    for (let i = 0; i < nodeSeq.length - 1; i++) {
      const seg = shortestPath(map, nodeSeq[i], nodeSeq[i + 1]);
      if (!seg) continue;
      for (let s = 0; s < seg.length - 1; s++) {
        for (let t = 0; t <= 1.001; t += 0.1) {
          pts.push(edgePoint(map, seg[s], seg[s + 1], Math.min(t, 1)));
        }
      }
    }
    return pts;
  }

  function strokeRoute(pts, color) {
    if (pts.length < 2) return;
    for (const [width, alpha] of [
      [9, 0.16],
      [3, 0.85],
    ]) {
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const p of pts) ctx.lineTo(p.x, p.y);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Pfeilspitze
    const last = pts[pts.length - 1];
    const prev = pts[Math.max(0, pts.length - 4)];
    const ang = Math.atan2(last.y - prev.y, last.x - prev.x);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(last.x - 11 * Math.cos(ang - 0.45), last.y - 11 * Math.sin(ang - 0.45));
    ctx.lineTo(last.x - 11 * Math.cos(ang + 0.45), last.y - 11 * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  // ---------------------------------------------------------------- Knoten
  function drawNodes(view) {
    const sim = view.sim;
    const bossHp = view.config.bossHp;
    for (const n of map.nodeList) {
      let ring = null;
      if (sim) {
        const here = sim.groups.filter(
          (g) => g.node === n.id && (g.state === 'atNode' || g.state === 'defending')
        );
        const fac = new Set(here.map((g) => g.faction));
        if (fac.size === 2 || here.some((g) => g.fighting)) {
          const pulse = 0.5 + 0.5 * Math.sin(anim * 6);
          ring = `rgba(255,120,100,${0.55 + pulse * 0.4})`;
        } else if (fac.size === 1) {
          ring = `${FACTIONS[[...fac][0]].color}cc`;
        }
      }
      if (n.type === 'combat') drawCombatNode(n, ring);
      else if (n.type === 'graveyard') drawGraveyard(n);
      else {
        const bossState = sim ? sim.boss[n.faction] : { hp: bossHp, maxHp: bossHp };
        drawKeep(n, sim ? sim.bossAlive[n.faction] : true, bossState);
      }
      label(n.x + (n.labelDx ?? 0), n.y + (n.labelDy ?? 30), n.name, {
        align: n.labelDx ? 'left' : 'center',
      });
    }
  }

  // ---------------------------------------------------------------- Simulation
  function drawSim(sim) {
    const byNode = new Map();
    const byEdge = new Map();
    const byEdgeCombat = new Map();
    const dead = [];
    for (const g of sim.groups) {
      if (g.state === 'moving') {
        const key = [g.edgeFrom, g.edgeTo].sort().join('>');
        if (!byEdge.has(key)) byEdge.set(key, []);
        byEdge.get(key).push(g);
      } else if (g.state === 'edgeFight') {
        if (!byEdgeCombat.has(g.edgeCombat)) byEdgeCombat.set(g.edgeCombat, []);
        byEdgeCombat.get(g.edgeCombat).push(g);
      } else if (g.state === 'dead') {
        dead.push(g);
      } else {
        if (!byNode.has(g.node)) byNode.set(g.node, []);
        byNode.get(g.node).push(g);
      }
    }

    for (const [key, list] of byEdge) {
      list.sort((a, b) => (a.id < b.id ? -1 : 1));
      list.forEach((g, i) => {
        const frac = Math.min(1, (sim.time - g.departT) / (g.arriveT - g.departT || 1));
        const p = edgePoint(map, g.edgeFrom, g.edgeTo, frac);
        const q = edgePoint(map, g.edgeFrom, g.edgeTo, Math.min(1, frac + 0.02));
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const len = Math.hypot(dx, dy) || 1;
        // Gegenverkehr weicht zur eigenen Seite aus, mehrere Gruppen fächern auf
        // (Abstand groß genug, damit sich die Lebensanzeigen nicht überlappen).
        const side = g.edgeFrom < g.edgeTo ? 1 : -1;
        const off = side * 7 + (i - (list.length - 1) / 2) * 15;
        drawToken(p.x + (-dy / len) * off, p.y + (dx / len) * off, g);
      });
    }

    // Begegnungskämpfe auf Wegstücken: Trupps stehen am Treffpunkt (rot in
    // Richtung Norden, blau in Richtung Süden), Schwerter markieren die Stelle.
    for (const [, list] of byEdgeCombat) {
      const first = list[0];
      const p = edgePoint(map, first.edgeFrom, first.edgeTo, first.edgeFrac);
      drawSwords(p.x, p.y, anim);
      const byFaction = { blue: [], red: [] };
      for (const g of list.sort((a, b) => (a.id < b.id ? -1 : 1))) byFaction[g.faction].push(g);
      for (const fac of ['red', 'blue']) {
        const fl = byFaction[fac];
        const base = fac === 'red' ? -Math.PI / 2 : Math.PI / 2;
        fl.forEach((g, i) => {
          const ang = base + (i - (fl.length - 1) / 2) * 1.05;
          drawToken(p.x + Math.cos(ang) * 30, p.y + Math.sin(ang) * 30, g);
        });
      }
    }

    for (const [nodeId, list] of byNode) {
      const n = map.nodes[nodeId];
      const both = new Set(list.map((g) => g.faction)).size === 2;
      const byFaction = { blue: [], red: [] };
      for (const g of list.sort((a, b) => (a.id < b.id ? -1 : 1))) byFaction[g.faction].push(g);
      // Schwerter zuerst, damit die Lebensanzeigen der Tokens lesbar darüberliegen.
      if (both || list.some((g) => g.fighting)) drawSwords(n.x, n.y, anim);
      for (const fac of ['red', 'blue']) {
        const fl = byFaction[fac];
        const base = fac === 'red' ? -Math.PI / 2 : Math.PI / 2;
        const spread = both || fl.length > 1;
        fl.forEach((g, i) => {
          const isBossNode = n.type === 'boss';
          const rad = spread || isBossNode ? (isBossNode ? 44 : 32) : 0;
          const ang = base + (i - (fl.length - 1) / 2) * 1.05;
          drawToken(n.x + Math.cos(ang) * rad, n.y + Math.sin(ang) * rad, g);
        });
      }
    }
    // Bosskampf ohne stehende Verteidiger sichtbar machen.
    for (const fac of ['blue', 'red']) {
      const bossNode = map.nodes[map.bosses[fac]];
      const attacked = sim.groups.some(
        (g) => g.node === bossNode.id && g.faction !== fac && g.fighting
      );
      if (attacked && !byNode.has(bossNode.id)) drawSwords(bossNode.x, bossNode.y, anim);
    }

    dead.sort((a, b) => (a.id < b.id ? -1 : 1));
    const perGy = new Map();
    for (const g of dead) {
      const i = perGy.get(g.graveyardNode) ?? 0;
      perGy.set(g.graveyardNode, i + 1);
      const n = map.nodes[g.graveyardNode];
      const remaining = Math.max(0, g.respawnAt - sim.time);
      drawToken(n.x - 26 - i * 24, n.y - 14, g, {
        ghost: true,
        countdown: 1 - remaining / sim.config.respawnTime,
      });
    }
  }

  // ---------------------------------------------------------------- Planung
  function drawPlanning(pl) {
    const faction = pl.faction;
    const c = FACTIONS[faction];
    const start = map.start[faction];
    const enemyBoss = map.bosses[enemyOf(faction)];

    // Kleine Marker: welche Punkte sind bereits in Befehlen enthalten?
    const attackCount = new Map();
    const defendCount = new Map();
    for (const o of pl.orders) {
      if (!o) continue;
      if (o.type === 'attack') for (const t of o.targets) attackCount.set(t, (attackCount.get(t) ?? 0) + 1);
      if (o.type === 'defend') defendCount.set(o.target, (defendCount.get(o.target) ?? 0) + 1);
    }

    // Route der ausgewählten Einheit hervorheben.
    const sel = pl.orders[pl.selected];
    let seq = null;
    if (!sel || sel.type === 'attack') {
      seq = [start, ...(sel?.targets ?? []), enemyBoss];
    } else if (sel.type === 'defend') {
      seq = [start, sel.target];
    }
    if (seq) strokeRoute(routePoints(seq), c.color);
    if (sel && sel.type === 'attack') {
      sel.targets.forEach((t, i) => {
        const n = map.nodes[t];
        ctx.beginPath();
        ctx.arc(n.x + 14, n.y - 14, 8.5, 0, TAU);
        ctx.fillStyle = c.dark;
        ctx.fill();
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = '#0a0f18';
        ctx.stroke();
        label(n.x + 14, n.y - 13.5, String(i + 1), { color: '#fff', weight: 700 });
      });
    }
    if (sel && sel.type === 'defend') {
      const n = map.nodes[sel.target];
      drawShieldIcon(n.x + 16, n.y - 14, 8, c.color);
    }

    for (const [t, count] of defendCount) {
      const n = map.nodes[t];
      drawShieldIcon(n.x - 17, n.y - 14, 6.5, 'rgba(255,215,106,0.9)');
      if (count > 1) label(n.x - 17, n.y - 26, `×${count}`, { color: '#ffd76a' });
    }
    for (const [t, count] of attackCount) {
      const n = map.nodes[t];
      label(n.x - 18, n.y + 14, `⚔${count > 1 ? '×' + count : ''}`, { color: '#f4c9c2', size: 12 });
    }

    // Eigene Truppe wartet am Start.
    const sn = map.nodes[start];
    drawToken(sn.x - 46, sn.y + 6, { faction, size: pl.unitCount, state: 'atNode' });
    // Gegnerische Truppe als Silhouette am anderen Ende.
    const en = map.nodes[map.start[enemyOf(faction)]];
    ctx.save();
    ctx.globalAlpha = 0.5;
    drawToken(en.x - 46, en.y + 6, { faction: enemyOf(faction), size: pl.unitCount, state: 'atNode' });
    ctx.restore();
  }

  // ---------------------------------------------------------------- Hauptzeichnung
  function draw(view, dt) {
    anim += dt;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bg, 0, 0, W, H);

    if (view.phase === 'plan' && view.planning) drawPlanning(view.planning);
    drawNodes(view);
    if (view.phase === 'sim' && view.sim) drawSim(view.sim);

    // Schnee
    ctx.fillStyle = 'rgba(235,243,252,0.55)';
    for (const f of snow) {
      f.y += f.vy * dt;
      f.x += Math.sin(anim * 0.7 + f.drift) * 12 * dt;
      if (f.y > H + 4) {
        f.y = -4;
      }
      if (f.x < -4) f.x = W + 4;
      if (f.x > W + 4) f.x = -4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, f.r, 0, TAU);
      ctx.fill();
    }
  }

  function hitNode(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    const y = ((clientY - rect.top) / rect.height) * H;
    let best = null;
    let bestD = 34;
    for (const n of map.nodeList) {
      const d = Math.hypot(n.x - x, n.y - y);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  }

  return { draw, resize, hitNode };
}
