// Overlay-Screens: Titel, Werkstatt, Ergebnis, Champion.
// Reines Markup + Klick-Bindung; alle Entscheidungen laufen über Callbacks.

import {
  QUALIFY_PLACES,
  canBuy, maxLevel, repairCost, startingSetupFor, upgradeCost,
} from './career.js';
import { DIFFICULTIES, profileFor } from './ai.js';
import { ITEMS } from './items.js';
import { tracks } from './tracks.js';
import {
  MAX_TUNING_CAP, NAMED_SEASONS, PEAK_SEASON,
  calendarFor, championBonus, racesIn, seasonAt, startChoices, tuningCap,
} from './seasons.js';

const money = (n) => `$${n.toLocaleString('de-DE')}`;

// Kaufwünsche laufen als Kennung durch `onBuy`. Ausrüstung trägt dabei diesen
// Vorsatz vor der Item-ID, damit `main.js` sie ohne eigene Liste erkennt.
export const ITEM_BUY_PREFIX = 'item:';

/** Segmentierte Auswahl der KI-Schwierigkeit. */
function difficultyPicker(current) {
  const buttons = DIFFICULTIES.map((d) =>
    `<button class="seg${d.id === current ? ' on' : ''}" data-difficulty="${d.id}">${d.name}</button>`).join('');
  return `
    <div class="segmented">${buttons}</div>
    <p class="seg-hint">${profileFor(current).hint}</p>`;
}

/**
 * Stufenanzeige. `cap` ist die in dieser Saison offene Grenze; darüber hinaus
 * bleiben die noch gesperrten Stufen als blasse Plätze sichtbar – so ist zu
 * sehen, dass es später weitergeht.
 */
function pips(level, cap) {
  let out = '<span class="pips">';
  for (let i = 0; i < MAX_TUNING_CAP; i++) {
    const state = i < level ? ' on' : (i >= cap ? ' locked' : '');
    out += `<span class="pip${state}"></span>`;
  }
  return `${out}</span>`;
}

/** Kalender einer Saison als Streckenliste. */
const calendarLine = (index) => calendarFor(index).map((t) => t.name).join(' → ');

/** Tastenbelegung der Ausrüstung für den Hilfetext – ohne feste Buchstaben. */
const itemKeyHint = () =>
  ITEMS.filter((item) => item.keyName)
    .map((item) => `${item.keyName} = ${item.name}`)
    .join(', ');

/** Eine Zeile je Ausrüstungsstück – rein aus `ITEMS` erzeugt. */
function arsenalRows(career) {
  return ITEMS.map((item) => shopRow(
    `buy-${item.id}`,
    `${item.icon} ${item.name} × ${career.ammo[item.id] ?? 0}`,
    `${item.hint} (max. ${item.max})`,
    money(item.cost),
    !canBuy(career, item.id),
  )).join('');
}

function shopRow(id, label, desc, priceLabel, disabled) {
  return `
    <div class="row">
      <span class="lbl">${label}<small>${desc}</small></span>
      <button class="buy" id="${id}"${disabled ? ' disabled' : ''}>${priceLabel}</button>
    </div>`;
}

export function createScreens(overlayEl) {
  const show = (html) => {
    overlayEl.innerHTML = html;
    overlayEl.classList.remove('hidden');
    overlayEl.scrollTop = 0;
  };
  const onClick = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  const bindDifficulty = (fn) => {
    overlayEl.querySelectorAll('[data-difficulty]').forEach((btn) => {
      btn.addEventListener('click', () => fn(btn.dataset.difficulty));
    });
  };

  const screens = {
    hide() {
      overlayEl.classList.add('hidden');
    },

    title({ onStart, onContinue, onEditor, onDifficulty, onSeason, difficulty, startSeason = 0, saved, audio }) {
      const chosen = seasonAt(startSeason);
      const setup = startingSetupFor(startSeason);
      // Wer später einsteigt, fährt nicht mit dem Anfängerwagen los – hier
      // steht schwarz auf weiß, womit es losgeht.
      const setupLine = startSeason === 0
        ? 'Serienwagen, $1.000 Startkapital – der Anfang'
        : `Motor ${setup.engine} • Handling ${setup.handling} • Panzerung ${setup.armor}`
          + ` • ${money(setup.money)} • ${ITEMS.map((i) => `${i.icon} ${setup.ammo[i.id] ?? 0}`).join(' ')}`;
      // Ein gespeicherter Stand steht ganz oben – Weiterfahren ist der
      // wahrscheinlichste Wunsch, wenn schon eine Karriere läuft.
      const resume = saved ? `
        <div class="panel">
          <h3>LAUFENDE KARRIERE</h3>
          <div class="row"><span class="lbl">${seasonAt(saved.season).name}<small>Rennen ${saved.stage + 1} von ${racesIn(saved.season)} • ${saved.points} Punkte</small></span></div>
          <div class="row"><span class="lbl">Titel<small>Gewonnene Saisons</small></span><span class="moneytag">${saved.titles} 🏆</span></div>
          <div class="row"><span class="lbl">Konto</span><span class="moneytag">${money(saved.money)}</span></div>
        </div>
        <button class="big" id="resume-btn">KARRIERE FORTSETZEN &#9654;</button>` : '';

      show(`
        <div class="logo">TURBO<br>TROPHY</div>
        <div class="sub">TOP-DOWN-ARCADE-RENNEN IM GEIST VON SUPER CARS</div>
        ${resume}
        <div class="panel">
          <h3>MEISTERSCHAFT</h3>
          <div class="row"><span class="lbl">${tracks.length} Strecken<small>Werde Erster bis Dritter, um weiterzukommen</small></span></div>
          <div class="row"><span class="lbl">${NAMED_SEASONS.length} Saisons + offene Meisterschaft<small>Nach dem Titel geht es weiter – Wagen, Arsenal und Konto kommen mit</small></span></div>
          <div class="row"><span class="lbl">Streckenelemente<small>Schanzen, Öllachen, Schranken und Brücken über die Kreuzungen</small></span></div>
          <div class="row"><span class="lbl">Preisgeld<small>Investiere zwischen den Rennen in Tuning &amp; Arsenal</small></span></div>
          <div class="row"><span class="lbl">Arsenal<small>${ITEMS.map((i) => i.name).join(' • ')}</small></span></div>
        </div>
        <div class="panel">
          <h3>${saved ? 'NEU ANFANGEN – WOMIT?' : 'WOMIT ANFANGEN?'}</h3>
          ${startChoices().map((s) => `
            <button class="season${s.index === startSeason ? ' on' : ''}" data-season="${s.index}">
              <span class="lbl">${s.name}<small>${racesIn(s.index)} Rennen • ${s.hint}</small></span>
            </button>`).join('')}
          <p class="seg-hint">
            Jeder Cup ist sofort wählbar. Wer später einsteigt, bekommt den Wagen,
            den ein Aufsteiger dort hätte – die Gegner sind entsprechend stärker.<br>
            Gewinnst du einen Cup, geht es mit dem nächsten weiter.
            ${saved ? '<br><b>Achtung:</b> Die oben laufende Karriere wird dabei verworfen.' : ''}
          </p>
        </div>
        <div class="panel">
          <h3>START IM ${chosen.name}</h3>
          <div class="row"><span class="lbl">Kalender<small>${calendarLine(startSeason)}</small></span></div>
          <div class="row"><span class="lbl">Dein Wagen<small>${setupLine}</small></span></div>
          <div class="row"><span class="lbl">Werkstatt<small>Ausbau bis Stufe ${tuningCap(startSeason)} offen${
            tuningCap(startSeason) < MAX_TUNING_CAP ? ' – weitere Stufen gibt die nächste Saison frei' : ''}</small></span></div>
        </div>
        <div class="panel">
          <h3>GEGNERSTÄRKE</h3>
          ${difficultyPicker(difficulty)}
        </div>
        <button class="big${saved ? ' alt' : ''}" id="start-btn">${
          saved ? `NEUE KARRIERE: ${chosen.name}` : `${chosen.name} STARTEN &#9654;`}</button>
        <button class="buy" id="editor-btn">&#128736; STRECKENEDITOR</button>
        <p class="hint">
          📱 Buttons unten – links lenken, rechts GAS &amp; Ausrüstung.<br>
          GAS kurz antippen = <b>Dauergas</b> (Hände frei für die Ausrüstung),
          erneut tippen oder BREMSE beendet es. Halten geht weiterhin.<br>
          🖮 Pfeile/WASD fahren, ${itemKeyHint()}.
        </p>
        <button class="buy" id="mute-btn">${audio.isMuted() ? '🔇 TON AN' : '🔊 TON AUS'}</button>
        <a class="overview-link" href="../../index.html">← Zur Spiele-Übersicht</a>
      `);
      onClick('start-btn', onStart);
      if (saved) onClick('resume-btn', onContinue);
      onClick('editor-btn', onEditor);
      bindDifficulty(onDifficulty);
      overlayEl.querySelectorAll('[data-season]').forEach((btn) => {
        btn.addEventListener('click', () => onSeason(Number(btn.dataset.season)));
      });
      onClick('mute-btn', (e) => {
        audio.setMuted(!audio.isMuted());
        e.target.textContent = audio.isMuted() ? '🔇 TON AN' : '🔊 TON AUS';
      });
    },

    shop({ career, track, onBuy, onStart, onDifficulty }) {
      const repair = repairCost(career);
      const cap = maxLevel(career);
      const upgrade = (key) => {
        const cost = upgradeCost(career, career[key]);
        return {
          label: cost === null ? (cap >= MAX_TUNING_CAP ? 'MAX' : 'GESPERRT') : money(cost),
          disabled: cost === null || career.money < cost,
        };
      };
      const motor = upgrade('engine');
      const handling = upgrade('handling');
      const armor = upgrade('armor');
      const season = seasonAt(career.season);
      // Solange die Ausbaugrenze noch wächst, gehört der Hinweis darauf in die
      // Werkstatt – sonst wirkt „GESPERRT" wie ein Fehler.
      const capHint = cap < MAX_TUNING_CAP
        ? `Stufe ${cap + 1} und höher gibt erst die nächste Saison frei.`
        : 'Alle Ausbaustufen sind offen.';

      show(`
        <div class="logo small">WERKSTATT</div>
        <div class="sub">${season.name} • RENNEN ${career.stage + 1}/${racesIn(career.season)}</div>
        <div class="sub">NÄCHSTES RENNEN: ${track.name} • ${track.laps} RUNDEN</div>
        <div class="panel">
          <h3>KONTO &amp; ZUSTAND</h3>
          <div class="row"><span class="lbl">Preisgeld</span><span class="moneytag">${money(career.money)}</span></div>
          ${shopRow('buy-repair', 'Karosserie', `${career.hp}/100 – Schaden aus dem letzten Lauf`,
            repair > 0 ? `REPARIEREN ${money(repair)}` : 'OK', repair <= 0 || career.money < repair)}
        </div>
        <div class="panel">
          <h3>TUNING</h3>
          ${shopRow('buy-engine', `Motor ${pips(career.engine, cap)}`, 'Höhere Endgeschwindigkeit', motor.label, motor.disabled)}
          ${shopRow('buy-handling', `Handling ${pips(career.handling, cap)}`, 'Engere Kurven', handling.label, handling.disabled)}
          ${shopRow('buy-armor', `Panzerung ${pips(career.armor, cap)}`, 'Weniger Schaden', armor.label, armor.disabled)}
          <p class="seg-hint">${capHint}</p>
        </div>
        <div class="panel">
          <h3>ARSENAL</h3>
          ${arsenalRows(career)}
        </div>
        <div class="panel">
          <h3>GEGNERSTÄRKE</h3>
          ${difficultyPicker(career.difficulty)}
        </div>
        <button class="big" id="race-btn">ZUM RENNEN &#9654;</button>
        <p class="hint">
          ${career.points} Punkte in dieser Saison${career.titles ? ` • ${career.titles} Titel 🏆` : ''}<br>
          Kalender: ${calendarLine(career.season)}
        </p>
      `);

      const rerender = () => screens.shop({ career, track, onBuy, onStart, onDifficulty });
      const bind = (id, kind) => onClick(id, () => {
        onBuy(kind);
        rerender();
      });
      bindDifficulty((id) => {
        onDifficulty(id);
        rerender();
      });
      bind('buy-repair', 'repair');
      bind('buy-engine', 'engine');
      bind('buy-handling', 'handling');
      bind('buy-armor', 'armor');
      for (const item of ITEMS) bind(`buy-${item.id}`, `${ITEM_BUY_PREFIX}${item.id}`);
      onClick('race-btn', onStart);
    },

    results({ result, career, onNext }) {
      const rows = result.order.map((car, i) => `
        <tr class="${car.isPlayer ? 'me' : ''}">
          <td>${i + 1}.</td>
          <td><span class="dot" style="background:${car.color}"></span>${car.name}</td>
          <td style="text-align:right">${car.isPlayer ? money(result.prize) : ''}</td>
        </tr>`).join('');

      show(`
        <div class="logo small">${result.qualified ? 'GESCHAFFT!' : 'AUSGESCHIEDEN'}</div>
        <div class="sub">${result.trackName} • RENNEN ${career.stage + 1}/${racesIn(career.season)} • ${seasonAt(career.season).name}</div>
        <div class="panel"><h3>PLATZIERUNG</h3><table class="results">${rows}</table></div>
        <div class="panel">
          <div class="row"><span class="lbl">Preisgeld</span><span class="moneytag">+${money(result.prize)}</span></div>
          <div class="row"><span class="lbl">Kontostand</span><span class="moneytag">${money(career.money)}</span></div>
          <div class="row"><span class="lbl">Punkte gesamt</span><span class="moneytag">${career.points}</span></div>
        </div>
        <div class="sub">${result.qualified
          ? `Platz ${result.place + 1} – qualifiziert!`
          : `Nur die Top ${QUALIFY_PLACES} kommen weiter.`}</div>
        <button class="big${result.qualified ? '' : ' alt'}" id="next-btn">
          ${result.qualified ? 'WEITER &#9654;' : 'NOCHMAL VERSUCHEN'}
        </button>
      `);
      onClick('next-btn', onNext);
    },

    /**
     * Saisonende. Kein Abspann, sondern eine Beförderung: Der Bildschirm zeigt,
     * was mitgenommen wird und was in der nächsten Saison anders ist.
     * `career` ist der Stand *vor* dem Wechsel.
     */
    champion({ career, onNextSeason, onRestart }) {
      const done = seasonAt(career.season);
      const next = seasonAt(career.season + 1);
      const bonus = championBonus(career.season);
      const capNow = tuningCap(career.season);
      const capNext = tuningCap(career.season + 1);
      const titles = (career.titles ?? 0) + 1;
      const tune = [
        `Motor ${career.engine}`, `Handling ${career.handling}`, `Panzerung ${career.armor}`,
      ].join(' • ');
      const ammo = ITEMS.map((i) => `${i.icon} ${career.ammo[i.id] ?? 0}`).join('  ');

      show(`
        <div class="logo">TITEL!</div>
        <div class="sub">${done.name} GEWONNEN • ${titles}. TITEL</div>
        <div class="panel">
          <h3>SAISONBILANZ</h3>
          <div class="row"><span class="lbl">Punkte der Saison</span><span class="moneytag">${career.points}</span></div>
          <div class="row"><span class="lbl">Punkte der Karriere</span><span class="moneytag">${career.totalPoints ?? career.points}</span></div>
          <div class="row"><span class="lbl">Meisterprämie</span><span class="moneytag">+${money(bonus)}</span></div>
          <div class="row"><span class="lbl">Konto danach</span><span class="moneytag">${money(career.money + bonus)}</span></div>
        </div>
        <div class="panel">
          <h3>DAS KOMMT MIT</h3>
          <div class="row"><span class="lbl">Wagen<small>${tune}</small></span></div>
          <div class="row"><span class="lbl">Arsenal<small>${ammo}</small></span></div>
          <div class="row"><span class="lbl">Karosserie<small>Schaden bleibt – reparieren kostet wie immer</small></span></div>
        </div>
        <div class="panel">
          <h3>NÄCHSTE SAISON: ${next.name}</h3>
          <div class="row"><span class="lbl">${racesIn(next.index)} Rennen<small>${calendarLine(next.index)}</small></span></div>
          <div class="row"><span class="lbl">Gegner<small>${next.index <= PEAK_SEASON
            ? 'Stärkeres Feld, besser ausgerüstet als in dieser Saison'
            : 'Am Anschlag – härter wird es nicht mehr'}</small></span></div>
          <div class="row"><span class="lbl">Werkstatt<small>${capNext > capNow
            ? `Ausbaustufe ${capNext} wird freigeschaltet (bisher ${capNow})`
            : 'Alle Ausbaustufen sind bereits offen'}</small></span></div>
        </div>
        <button class="big" id="next-season-btn">${next.name} STARTEN &#9654;</button>
        <button class="buy" id="again-btn">Karriere beenden und Cup neu wählen</button>
        <a class="overview-link" href="../../index.html">← Zur Spiele-Übersicht</a>
      `);
      onClick('next-season-btn', onNextSeason);
      onClick('again-btn', onRestart);
    },
  };

  return screens;
}
