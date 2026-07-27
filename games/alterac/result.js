// Ergebnisbildschirm: die Auswertung aus `report.js` als Blatt über der Karte.
//
// Drei Entscheidungen tragen den Aufbau:
//
// - **Es ist ein Blatt, keine Karte.** Der frühere Ergebniskasten trug drei
//   Zeilen; ein Bericht trägt sie nicht. Also dasselbe Gerüst wie die
//   Plan-Bibliothek (`#plan-card`): fester Kopf, fester Fuß, nur die Mitte
//   scrollt. Auf einem Telefon bleibt damit „Revanche" immer einen Daumen
//   entfernt, egal wie weit der Spieler im Bericht gelesen hat.
// - **Der Kern steht ohne Scrollen da:** Ausgang, Dauer und die Lebenspunkte
//   beider Fürsten. Alles darunter ist freiwillige Tiefe.
// - **Nichts wird neu erfunden, was es schon gibt.** Die Fürstenzeilen sind
//   dieselben `.boss-row`-Bausteine wie im Schlacht-HUD, die Truppenzeilen
//   benutzen Ziffer und Porträt der Planungsliste (`.chip-num`, `.chip-pic`).
//   Der Spieler soll denselben Trupp wiedererkennen, den er geplant und dann
//   auf der Karte verfolgt hat.

import { FACTIONS } from './map.js';
import { buildReport, fmtTime, TIME_BUCKETS } from './report.js';
import { bossCell, spriteCell } from './sprites.js';
import { planStore, encodePlan, MAX_NAME_LENGTH } from './plans.js';

const overlayEl = document.getElementById('overlay');
const overlayCard = document.getElementById('overlay-card');

const pct = (x) => `${Math.round(x * 100)} %`;
const round = (x) => Math.round(x);

// --------------------------------------------------------------- Kopfzeile
// Im Spiel gegen den Computer wird der Ausgang in der zweiten Person gesagt –
// „Sturmlanze siegt!" beantwortet die Frage „habe ich gewonnen?" erst nach
// einem Umweg über die eigene Fraktionsfarbe. Im Hotseat sitzen zwei Spieler
// am Gerät; dort bleibt es beim Fraktionsnamen.
function headMarkup(rep) {
  const title =
    rep.outcome === 'draw'
      ? 'Unentschieden'
      : rep.outcome === 'win'
        ? 'Du siegst!'
        : rep.outcome === 'loss'
          ? 'Du unterliegst'
          : `${FACTIONS[rep.winner].name} siegt!`;
  // Beim Sieger blickt sein Fürst aus dem Blatt – auch nach einer Niederlage:
  // Dann ist es das Gesicht, gegen das man verloren hat. Ein Unentschieden hat
  // keinen Sieger und damit kein Gesicht.
  const cell = rep.winner === 'draw' ? null : bossCell(rep.winner);
  const fac = rep.winner === 'draw' ? null : FACTIONS[rep.winner];
  const crest = cell
    ? `<div class="boss-portrait overlay-boss" style="--col:${cell.col};--fac:${fac.color};--fac-dark:${fac.dark}"></div>`
    : `<div class="overlay-emoji">${rep.outcome === 'draw' ? '🤝' : '🏆'}</div>`;
  const color = rep.winner === 'draw' ? '' : ` style="color:${FACTIONS[rep.winner].color}"`;
  return `
    <div class="result-head">
      ${crest}
      <h2${color}>${title}</h2>
      <p class="result-reason">${rep.reason} <span class="result-clock">${fmtTime(rep.duration)}</span></p>
    </div>`;
}

// ------------------------------------------------------ Duell der Fürsten
// Ticket-Kern: die Rest-Lebenspunkte beider Anführer. Dieselben Bausteine wie
// im Schlacht-HUD, nur ohne die laufende Aktualisierung – inklusive derselben
// Farbstufen des Balkens, damit der Endstand aussieht wie der letzte Blick auf
// das HUD.
function bossDuelMarkup(rep) {
  const rows = rep.order
    .map((f) => {
      const r = rep.factions[f];
      const cell = bossCell(f);
      const pic = cell ? `<span class="boss-portrait boss-pic" style="--col:${cell.col}"></span>` : '';
      const level = r.boss.frac > 0.5 ? 'high' : r.boss.frac > 0.25 ? 'mid' : 'low';
      return `
        <div class="boss-row${r.boss.alive ? '' : ' fallen'}" style="--fac:${r.color};--fac-dark:${r.dark}">
          ${pic}
          <div class="boss-head">
            <span class="boss-name">${r.name}</span>
            <span class="boss-hp">${round(r.boss.hp)} / ${round(r.boss.maxHp)}</span>
          </div>
          <div class="boss-bar"><i data-level="${level}" style="width:${(r.boss.frac * 100).toFixed(1)}%"></i></div>
        </div>`;
    })
    .join('');
  return `<div class="boss-board">${rows}</div>`;
}

// ------------------------------------------------------------- Bilanzblock
// Gegenüberstellung statt Kachelraster: Jede Kennzahl ist erst dann eine
// Aussage, wenn die Zahl der Gegenseite danebensteht („3 Verluste" heißt wenig,
// „3 gegen 9" alles). Die eigene Seite steht links.
//
// Eine Zeile erscheint nur, wenn ihr Teilsystem in dieser Partie lief – ohne
// Türme keine Turmzeile, ohne Lager keine Vorratszeile. Dieselbe Regel wendet
// schon das Boss-HUD an.
function tallyMarkup(rep) {
  const rows = [];
  const add = (label, pick) =>
    rows.push({ label, values: rep.order.map((f) => pick(rep.factions[f], f)) });

  add('Verluste', (r) => `${r.losses}`);
  add('Schaden', (r) => `${round(r.dealt)}`);
  if (rep.has.towers) add('Türme gefällt', (r) => `${r.towersFelled.count} / ${r.towersFelled.total}`);
  if (rep.has.shield) {
    // Der Anteil des eigenen Schadens am gegnerischen Fürsten, den dessen
    // Schild verschluckt hat: die Zahl, die den Umweg über die Türme erklärt.
    // Sie steht in der Zeile der angreifenden Seite – „–" heißt: nie am Boss
    // gewesen.
    add('am Schild verpufft', (r) => (r.shieldShare == null ? '–' : pct(r.shieldShare)));
  }
  add('Friedhöfe', (r) => `${r.graveyards.count} / ${r.graveyards.total}`);
  if (rep.has.supply) {
    add('Vorrat', (r) => (r.supply.allySummoned ? '✦ Verbündeter' : `${r.supply.have} / ${r.supply.cost}`));
  }

  const head = rep.order
    .map((f) => `<span class="tally-side" style="color:${rep.factions[f].color}">${rep.factions[f].name}</span>`)
    .join('<span></span>');
  const body = rows
    .map(
      (r) => `
      <span class="tally-val">${r.values[0]}</span>
      <span class="tally-label">${r.label}</span>
      <span class="tally-val">${r.values[1]}</span>`
    )
    .join('');
  return `<div class="tally"><div class="tally-head">${head}</div><div class="tally-grid">${body}</div></div>`;
}

// ------------------------------------------------------------ Truppenbericht
// Die eigentliche Lehre der Schlacht. Der Zeitbalken steht bewusst vor den
// Schadenszahlen: Eine Einheit, die 80 % der Schlacht marschiert ist, hat kein
// Kampfproblem, sondern ein Wegproblem – und das sieht man nur hier.
function timeBarMarkup(u) {
  // Die Zeit vor dem Erscheinen führt den Balken an – sie liegt am Anfang der
  // Schlacht, nicht an ihrem Ende (siehe `absent` in report.js).
  const lead =
    u.absent > 0.001
      ? `<i class="tb-absent" style="width:${(u.absent * 100).toFixed(2)}%" title="noch nicht auf dem Feld"></i>`
      : '';
  const seg = TIME_BUCKETS.map(
    (b) =>
      `<i class="tb-${b.key}" style="width:${(u.share[b.key] * 100).toFixed(2)}%" title="${b.label}: ${Math.round(u.seconds[b.key])} s"></i>`
  ).join('');
  return `<div class="troop-time">${lead}${seg}</div>`;
}

function troopMarkup(u) {
  const cell = spriteCell(u.faction, u.typeKey);
  const fac = FACTIONS[u.faction];
  const pic = cell
    ? `<span class="chip-pic" style="--col:${cell.col};--row:${cell.row};--fac-dark:${fac.dark}"></span>`
    : '';
  const num = u.roman ? `<span class="chip-num">${u.roman}</span>` : `<span class="chip-num">✦</span>`;
  // Zustand am Schlachtende: Wer wartet, ist gefallen – wer endgültig fiel,
  // kommt nicht wieder (der Verbündete, oder eine Fraktion ohne Friedhof).
  const state = u.gone
    ? '<em class="troop-state gone">endgültig gefallen</em>'
    : u.standing
      ? `<em class="troop-state">${round(u.hp)}/${round(u.maxHp)} LP</em>`
      : '<em class="troop-state down">gefallen</em>';
  // Wortmarken statt Symbolen: „⚔ 1 · 💀 2" ist eine Zeile, die man erst
  // entziffern muss, und die Zeichen fallen je nach Gerät auf verschiedene
  // Ersatzglyphen zurück.
  const meta = [
    `${u.kills} erschlagen`,
    u.deaths ? `${u.deaths}× gefallen` : 'nie gefallen',
    u.perCost != null ? `${round(u.perCost)} Schaden je ⬢` : null,
    u.idle ? '<b class="troop-warn">nie im Kampf</b>' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `
    <div class="troop${u.idle ? ' idle' : ''}" style="--fac:${fac.color}">
      ${num}${pic}
      <span class="troop-name">${u.name}${state}</span>
      <span class="troop-dmg">${round(u.dealt)}</span>
      ${timeBarMarkup(u)}
      <span class="troop-meta">${meta}</span>
    </div>`;
}

// Die Legende erklärt beides, was in einer Truppenzeile ohne Beschriftung
// steht: die Farben des Zeitbalkens und die große Zahl am rechten Rand.
function legendMarkup() {
  const dots = TIME_BUCKETS.map((b) => `<span><i class="tb-${b.key}"></i>${b.label}</span>`).join('');
  return `<div class="troop-legend">${dots}<span class="troop-legend-dmg">Schaden</span></div>`;
}

function troopsMarkup(rep) {
  const [first, second] = rep.order;
  const block = (f) => rep.factions[f].units.map(troopMarkup).join('');
  const ownTitle = rep.viewFaction === first ? 'Deine Truppen' : rep.factions[first].name;
  return `
    <section class="troops">
      <h3>${ownTitle}</h3>
      ${legendMarkup()}
      ${block(first)}
    </section>
    <details class="troops-enemy">
      <summary>${rep.factions[second].name} anzeigen</summary>
      ${block(second)}
    </details>`;
}

// --------------------------------------------------------------- Sicherung
// Ticket-Punkt 3. Die Bibliothek selbst bleibt im Planer – hier steht nur der
// Eingang zu ihr: ein Name und ein Knopf. Nach einer Schlacht weiß der Spieler,
// was der Aufmarsch getaugt hat; das ist der Moment, ihn zu benennen.
function saveMarkup(rep, humanFactions) {
  if (!humanFactions.length) return '';
  const outcomeName = (f) => {
    const won = rep.winner === f;
    const lost = rep.winner !== 'draw' && rep.winner !== f;
    return `${won ? 'Sieg' : lost ? 'Niederlage' : 'Remis'} ${fmtTime(rep.duration)}`;
  };
  const rows = humanFactions
    .map((f) => {
      // Im Hotseat gehören zwei Aufmärsche zu dieser Schlacht – jeder braucht
      // seine eigene Zeile, sonst wäre nicht klar, welcher gesichert wird.
      const label =
        humanFactions.length > 1
          ? `<span class="save-side" style="color:${FACTIONS[f].color}">${FACTIONS[f].name}</span>`
          : '';
      return `
        <div class="save-entry">
          ${label}
          <div class="plan-row">
            <input class="plan-input" type="text" maxlength="${MAX_NAME_LENGTH}" autocomplete="off"
              data-save-name="${f}" value="${outcomeName(f)}" placeholder="Name des Aufmarschs">
            ${planStore.available ? `<button class="btn ghost plan-act" type="button" data-save="${f}">💾 Sichern</button>` : ''}
          </div>
          <button class="btn ghost plan-act" type="button" data-share="${f}">🔗 Als Link kopieren</button>
        </div>`;
    })
    .join('');
  return `<div class="result-save" id="result-save" hidden>${rows}
    ${planStore.available ? '' : '<p class="plan-note">Dieser Browser speichert nichts (privater Modus?) – der Teilen-Link funktioniert trotzdem.</p>'}
  </div>`;
}

// ------------------------------------------------------------------- Aufbau
// Der Zustand der gerade gezeigten Auswertung. Er lebt im Modul, weil der
// Klick-Handler nur **einmal** angemeldet wird: Das Blatt entsteht bei jeder
// Schlacht neu, ein Handler je Aufbau würde sich still aufsummieren.
let ctx = null;

export function showResult({ sim, map, config, plans, humanFactions, onRematch, onNewSettings }) {
  const viewFaction = humanFactions.length === 1 ? humanFactions[0] : null;
  const rep = buildReport({ sim, map, config, viewFaction });
  ctx = { rep, map, config, plans, onRematch, onNewSettings };

  overlayCard.classList.add('result-card');
  overlayCard.innerHTML = `
    ${headMarkup(rep)}
    <div class="result-body">
      ${bossDuelMarkup(rep)}
      ${tallyMarkup(rep)}
      ${troopsMarkup(rep)}
    </div>
    <div class="result-foot">
      ${saveMarkup(rep, humanFactions)}
      <p class="plan-note" id="result-note"></p>
      <div class="overlay-buttons">
        <button class="btn primary" id="btn-rematch">Revanche</button>
        ${humanFactions.length ? '<button class="btn ghost" id="btn-keep">💾 Aufmarsch sichern</button>' : ''}
        <button class="btn ghost" id="btn-new">Neue Einstellungen</button>
      </div>
    </div>
  `;
  overlayEl.hidden = false;
  // Der Bericht ist lang – ein Blatt aus der vorigen Schlacht könnte noch
  // gescrollt sein.
  overlayCard.querySelector('.result-body').scrollTop = 0;
}

function setNote(text, { warn = false } = {}) {
  const noteEl = overlayCard.querySelector('#result-note');
  if (!noteEl) return;
  noteEl.textContent = text;
  noteEl.classList.toggle('warn', warn);
}

function closeResult() {
  overlayEl.hidden = true;
  overlayCard.classList.remove('result-card');
  ctx = null;
}

// Aufmarsch einer Seite in die Bibliothek legen – dieselbe Bibliothek, aus der
// die Planung lädt. Sie selbst bleibt im Planer; hier steht nur der Eingang.
function keepPlan(faction) {
  const nameEl = overlayCard.querySelector(`[data-save-name="${faction}"]`);
  const res = planStore.save({
    name: nameEl.value.trim(),
    faction,
    units: ctx.plans[faction] ?? [],
    config: ctx.config,
  });
  setNote(res.ok ? `„${res.entry.name}" gesichert – steht jetzt in der Bibliothek.` : res.error, {
    warn: !res.ok,
  });
}

function sharePlan(faction) {
  const code = encodePlan(ctx.plans[faction] ?? [], { map: ctx.map, faction });
  if (!code) {
    setNote('Dieser Aufmarsch lässt sich nicht als Code darstellen.', { warn: true });
    return;
  }
  const url = `${location.href.split('#')[0].split('?')[0]}?plan=${code}`;
  const nameEl = overlayCard.querySelector(`[data-save-name="${faction}"]`);
  // Ohne sicheren Kontext (etwa per file:// geöffnet) gibt es keine
  // Zwischenablage – dann steht der Link markiert im Feld, wie im Planer auch.
  const manual = () => {
    nameEl.value = url;
    nameEl.focus();
    nameEl.select();
    setNote('Link steht im Feld – bitte von Hand kopieren.');
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(url)
      .then(() => setNote('Link kopiert – er enthält den kompletten Aufmarsch.'), manual);
  } else {
    manual();
  }
}

overlayCard.addEventListener('click', (ev) => {
  if (!ctx) return; // das Blatt zeigt gerade etwas anderes (Geräteübergabe)
  const t = ev.target;
  if (t.closest('#btn-rematch')) {
    const next = ctx.onRematch;
    closeResult();
    next();
    return;
  }
  if (t.closest('#btn-new')) {
    const next = ctx.onNewSettings;
    closeResult();
    next();
    return;
  }
  if (t.closest('#btn-keep')) {
    const box = overlayCard.querySelector('#result-save');
    box.hidden = !box.hidden;
    if (!box.hidden) box.querySelector('.plan-input')?.select();
    return;
  }
  const save = t.closest('[data-save]');
  if (save) {
    keepPlan(save.dataset.save);
    return;
  }
  const share = t.closest('[data-share]');
  if (share) sharePlan(share.dataset.share);
});
