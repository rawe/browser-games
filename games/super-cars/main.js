// Einstiegspunkt: Spielzustände (Menü → Rennen → Ergebnis → Shop → …) und Render-Loop.
import { tracks } from './tracks.js';
import { createRace, updateRace, playerCar, tryFire } from './race.js';
import {
  createCareer, prizeFor, repairCost, buyUpgrade, buyRepair, buyRocket,
  PRICES, MAX_AMMO,
} from './career.js';
import { createRenderer, createRaceScene } from './scene.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';

const canvas = document.getElementById('scene');
const overlay = document.getElementById('overlay');
const panel = document.getElementById('panel');

const renderer = createRenderer(canvas);
const hud = createHud();
const input = createInput();
const audio = createAudio();

let career = createCareer();
let race = null;
let sceneCtx = null;
let mode = 'menu'; // menu | race | overlay-*
let lastCountdownBeep = -1;

const euro = (n) => `${n.toLocaleString('de-DE')} €`;

function resize() {
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  if (sceneCtx) sceneCtx.resize(w, h);
}
window.addEventListener('resize', resize);

function showPanel(html) {
  panel.innerHTML = html;
  overlay.classList.add('visible');
}

function hidePanel() {
  overlay.classList.remove('visible');
}

/* ---------- Menü ---------- */
function showMenu() {
  mode = 'menu';
  audio.engineOff();
  showPanel(`
    <h1>Super Cars</h1>
    <p class="sub">Arcade-Rennen von schräg hinten – ${tracks.length} Strecken, 7 Rivalen,
    Raketen und ein Shop zwischen den Läufen. Nur die ersten drei kommen weiter.</p>
    <button class="primary-btn" id="start-btn">Meisterschaft starten</button>
    <p class="sub">🖮 Pfeile/WASD fahren, Leertaste feuert, Q wechselt die Waffe.<br>
    📱 Am Smartphone: Buttons unten – links lenken, rechts Gas, Bremse und Rakete.</p>
    <button class="ghost-btn" id="mute-btn">${audio.isMuted() ? '🔇 Ton an' : '🔊 Ton aus'}</button>
    ${document.body.dataset.standalone ? '' : '<a class="ghost-btn" style="text-align:center;text-decoration:none" href="../../index.html">← Zur Spiele-Übersicht</a>'}
  `);
  document.getElementById('start-btn').addEventListener('click', () => {
    audio.unlock();
    career = createCareer();
    startRace();
  });
  document.getElementById('mute-btn').addEventListener('click', (e) => {
    audio.setMuted(!audio.isMuted());
    e.target.textContent = audio.isMuted() ? '🔇 Ton an' : '🔊 Ton aus';
  });
}

/* ---------- Rennen ---------- */
function startRace() {
  const trackDef = tracks[career.stage];
  if (sceneCtx) sceneCtx.dispose();
  race = createRace(trackDef, career, career.stage);
  // Demo-Modus (?demo=1): Spielerwagen fährt selbst – zum Zuschauen und Testen
  race.autopilot = new URLSearchParams(location.search).has('demo');
  sceneCtx = createRaceScene(race);
  hud.prepareTrack(race.track);
  lastCountdownBeep = -1;
  resize();
  hidePanel();
  mode = 'race';
}

function endRace() {
  const me = playerCar(race);
  // Zustand, Restmunition und Preisgeld in die Karriere übernehmen
  career.health = Math.max(5, Math.round(me.health));
  career.ammoF = me.ammoF;
  career.ammoR = me.ammoR;
  const prize = prizeFor(me.position);
  career.money += prize;
  audio.engineOff();
  if (prize > 0) audio.cash();

  const qualified = me.position <= 3;
  const isLastStage = career.stage >= tracks.length - 1;

  const rows = race.results.map((r) => `
    <li class="${r.isPlayer ? 'me' : ''}">
      <span class="rank">${r.position}.</span>
      <span class="dot" style="background:#${r.color.toString(16).padStart(6, '0')}"></span>
      <span>${r.name}</span>
      <span class="prize">${prizeFor(r.position) > 0 ? `+${euro(prizeFor(r.position))}` : ''}</span>
    </li>`).join('');

  let verdict;
  let buttons;
  if (qualified && isLastStage) {
    verdict = `<h2 style="color:var(--turbo)">🏆 Meisterschaft gewonnen!</h2>
      <p class="sub">Alle ${tracks.length} Läufe gemeistert – Endstand: ${euro(career.money)}.</p>`;
    buttons = `<button class="primary-btn" id="next-btn">Zurück zum Menü</button>`;
  } else if (qualified) {
    verdict = `<h2 style="color:var(--tacho)">Weiter!</h2>
      <p class="sub">Platz ${me.position} – Top 3 erreicht. Nächster Lauf: ${tracks[career.stage + 1].name}.</p>`;
    buttons = `<button class="primary-btn" id="next-btn">Zum Shop</button>`;
  } else {
    verdict = `<h2 style="color:var(--signal)">Ausgeschieden</h2>
      <p class="sub">Nur die ersten drei kommen weiter. Rüste nach und versuch's nochmal.</p>`;
    buttons = `<button class="primary-btn" id="next-btn">Zum Shop</button>`;
  }

  mode = 'overlay-results';
  showPanel(`
    <h2>${race.track.def.name} – Ergebnis</h2>
    <ol class="result-list">${rows}</ol>
    ${verdict}
    ${buttons}
  `);
  document.getElementById('next-btn').addEventListener('click', () => {
    if (qualified && isLastStage) { showMenu(); return; }
    if (qualified) career.stage++;
    showShop();
  });
}

/* ---------- Shop & Waffenauswahl ---------- */
function pips(level, max) {
  let s = '<span class="pips">';
  for (let i = 0; i < max; i++) s += `<span class="pip ${i < level ? 'on' : ''}"></span>`;
  return s + '</span>';
}

function shopItem(id, name, desc, priceLabel, disabled) {
  return `
    <div class="shop-item">
      <div class="info">
        <div class="name">${name}</div>
        <div class="desc">${desc}</div>
      </div>
      <button class="buy-btn" id="${id}" ${disabled ? 'disabled' : ''}>${priceLabel}</button>
    </div>`;
}

function showShop() {
  mode = 'overlay-shop';
  const u = career.upgrades;
  const rc = repairCost(career);
  const nextPrice = (key) => PRICES[key][u[key]];

  showPanel(`
    <h2>Werkstatt &amp; Waffenshop</h2>
    <div class="money-row"><span class="sub">Preisgeld-Konto</span><span class="value">${euro(career.money)}</span></div>

    ${shopItem('buy-repair', `Reparatur <span class="desc">(Zustand ${Math.round(career.health)}%)</span>`,
      'Karosserie komplett instand setzen.',
      rc > 0 ? euro(rc) : 'wie neu', rc <= 0 || career.money < rc)}

    ${shopItem('buy-motor', `Motor ${pips(u.motor, PRICES.motor.length)}`,
      'Mehr Spitze und Beschleunigung.',
      u.motor < PRICES.motor.length ? euro(nextPrice('motor')) : 'max.',
      u.motor >= PRICES.motor.length || career.money < (nextPrice('motor') ?? Infinity))}

    ${shopItem('buy-handling', `Handling ${pips(u.handling, PRICES.handling.length)}`,
      'Direktere Lenkung, engere Kurven.',
      u.handling < PRICES.handling.length ? euro(nextPrice('handling')) : 'max.',
      u.handling >= PRICES.handling.length || career.money < (nextPrice('handling') ?? Infinity))}

    ${shopItem('buy-armor', `Panzerung ${pips(u.panzerung, PRICES.panzerung.length)}`,
      'Weniger Schaden durch Treffer und Rempler.',
      u.panzerung < PRICES.panzerung.length ? euro(nextPrice('panzerung')) : 'max.',
      u.panzerung >= PRICES.panzerung.length || career.money < (nextPrice('panzerung') ?? Infinity))}

    ${shopItem('buy-rf', `Raketen vorne · ${career.ammoF}/${MAX_AMMO}`,
      'Zielsuchend nach vorn – räumt den Weg frei.',
      `+1 · ${euro(PRICES.rocketFront)}`, career.ammoF >= MAX_AMMO || career.money < PRICES.rocketFront)}

    ${shopItem('buy-rr', `Raketen hinten · ${career.ammoR}/${MAX_AMMO}`,
      'Gegen Verfolger im Rückspiegel.',
      `+1 · ${euro(PRICES.rocketRear)}`, career.ammoR >= MAX_AMMO || career.money < PRICES.rocketRear)}

    <p class="weapon-note">Waffenauswahl im Rennen: <b>Q</b> bzw. <b>▲▼</b> wechselt zwischen Front- und Heckraketen.</p>

    <button class="primary-btn" id="race-btn">Start: ${tracks[career.stage].name} →</button>
  `);

  const rebind = () => showShop();
  const bind = (id, fn) => document.getElementById(id).addEventListener('click', () => { if (fn()) { audio.cash(); } rebind(); });
  bind('buy-repair', () => buyRepair(career));
  bind('buy-motor', () => buyUpgrade(career, 'motor'));
  bind('buy-handling', () => buyUpgrade(career, 'handling'));
  bind('buy-armor', () => buyUpgrade(career, 'panzerung'));
  bind('buy-rf', () => buyRocket(career, 'front'));
  bind('buy-rr', () => buyRocket(career, 'rear'));
  document.getElementById('race-btn').addEventListener('click', () => { audio.unlock(); startRace(); });
}

/* ---------- Loop ---------- */
let lastTime = performance.now();

function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (mode === 'race' && race) {
    const ctrl = input.read(dt);
    const me = playerCar(race);

    if (ctrl.toggle) {
      me.weapon = me.weapon === 'front' ? 'rear' : 'front';
    }
    if (ctrl.fire) {
      if (tryFire(race, me)) audio.fire();
    }

    // Physik mit fester Schrittweite (stabil auf 60/120-Hz-Displays)
    const STEP = 1 / 120;
    let acc = dt;
    while (acc > 0) {
      const h = Math.min(STEP, acc);
      updateRace(race, { throttle: ctrl.throttle, brake: ctrl.brake, steer: ctrl.steer }, h);
      acc -= h;
    }

    // Ereignisse in Bild + Ton übersetzen
    for (const ev of race.events) {
      sceneCtx.handleEvent(ev);
      const nearPlayer = ev.x === undefined ||
        Math.hypot((ev.x ?? 0) - me.state.x, (ev.z ?? 0) - me.state.z) < 70;
      if (!nearPlayer) continue;
      if (ev.type === 'explosion') audio.explosion();
      else if (ev.type === 'rocketHit') audio.hit();
      else if (ev.type === 'fire' && ev.carId !== 0) audio.fire();
      else if (ev.type === 'wallHit' && ev.carId === 0) audio.hit();
      else if (ev.type === 'go') audio.countdown(true);
    }
    race.events.length = 0;

    // Countdown-Pieptöne
    if (race.state === 'countdown') {
      const n = Math.ceil(race.countdown - 0.6);
      if (n !== lastCountdownBeep && n > 0) { audio.countdown(false); lastCountdownBeep = n; }
    }

    audio.engine(me.state.v / me.spec.vmax, !me.destroyed);
    hud.update(race);
    sceneCtx.update(dt);
    renderer.render(sceneCtx.scene, sceneCtx.camera);

    if (race.state === 'finished') endRace();
  } else if (sceneCtx) {
    // Hintergrund hinter Overlays weiterrendern (steht still)
    renderer.render(sceneCtx.scene, sceneCtx.camera);
  }
}

resize();
showMenu();
requestAnimationFrame(frame);
