// Overlay-Screens: Titel, Werkstatt, Ergebnis, Champion.
// Reines Markup + Klick-Bindung; alle Entscheidungen laufen über Callbacks.

import {
  MAX_AMMO, MAX_LEVEL, AMMO_COSTS, QUALIFY_PLACES,
  repairCost, upgradeCost,
} from './career.js';
import { DIFFICULTIES, profileFor } from './ai.js';
import { tracks } from './tracks.js';

const money = (n) => `$${n.toLocaleString('de-DE')}`;

/** Segmentierte Auswahl der KI-Schwierigkeit. */
function difficultyPicker(current) {
  const buttons = DIFFICULTIES.map((d) =>
    `<button class="seg${d.id === current ? ' on' : ''}" data-difficulty="${d.id}">${d.name}</button>`).join('');
  return `
    <div class="segmented">${buttons}</div>
    <p class="seg-hint">${profileFor(current).hint}</p>`;
}

function pips(level) {
  let out = '<span class="pips">';
  for (let i = 0; i < MAX_LEVEL; i++) out += `<span class="pip${i < level ? ' on' : ''}"></span>`;
  return `${out}</span>`;
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

    title({ onStart, onEditor, onDifficulty, difficulty, audio }) {
      show(`
        <div class="logo">TURBO<br>TROPHY</div>
        <div class="sub">TOP-DOWN-ARCADE-RENNEN IM GEIST VON SUPER CARS</div>
        <div class="panel">
          <h3>MEISTERSCHAFT</h3>
          <div class="row"><span class="lbl">${tracks.length} Strecken<small>Werde Erster bis Dritter, um weiterzukommen</small></span></div>
          <div class="row"><span class="lbl">Streckenelemente<small>Schanzen, Öllachen, Schranken und eine Brücke über die Kreuzung</small></span></div>
          <div class="row"><span class="lbl">Preisgeld<small>Investiere zwischen den Rennen in Tuning &amp; Waffen</small></span></div>
          <div class="row"><span class="lbl">Raketen<small>Nach vorn und nach hinten – Gegner ausschalten!</small></span></div>
        </div>
        <div class="panel">
          <h3>GEGNERSTÄRKE</h3>
          ${difficultyPicker(difficulty)}
        </div>
        <button class="big" id="start-btn">SAISON STARTEN</button>
        <button class="buy" id="editor-btn">&#128736; STRECKENEDITOR</button>
        <p class="hint">
          📱 Buttons unten – links lenken, rechts GAS &amp; Raketen.<br>
          GAS kurz antippen = <b>Dauergas</b> (Hände frei für Raketen),
          erneut tippen oder BREMSE beendet es. Halten geht weiterhin.<br>
          🖮 Pfeile/WASD fahren, Leertaste = Rakete vor, X = Rakete zurück.
        </p>
        <button class="buy" id="mute-btn">${audio.isMuted() ? '🔇 TON AN' : '🔊 TON AUS'}</button>
        <a class="overview-link" href="../../index.html">← Zur Spiele-Übersicht</a>
      `);
      onClick('start-btn', onStart);
      onClick('editor-btn', onEditor);
      bindDifficulty(onDifficulty);
      onClick('mute-btn', (e) => {
        audio.setMuted(!audio.isMuted());
        e.target.textContent = audio.isMuted() ? '🔇 TON AN' : '🔊 TON AUS';
      });
    },

    shop({ career, track, onBuy, onStart, onDifficulty }) {
      const repair = repairCost(career);
      const upgrade = (key) => {
        const cost = upgradeCost(career[key]);
        return { label: cost === null ? 'MAX' : money(cost), disabled: cost === null || career.money < cost };
      };
      const motor = upgrade('engine');
      const handling = upgrade('handling');
      const armor = upgrade('armor');

      show(`
        <div class="logo small">WERKSTATT</div>
        <div class="sub">NÄCHSTES RENNEN: ${track.name} • ${track.laps} RUNDEN</div>
        <div class="panel">
          <h3>KONTO &amp; ZUSTAND</h3>
          <div class="row"><span class="lbl">Preisgeld</span><span class="moneytag">${money(career.money)}</span></div>
          ${shopRow('buy-repair', 'Karosserie', `${career.hp}/100 – Schaden aus dem letzten Lauf`,
            repair > 0 ? `REPARIEREN ${money(repair)}` : 'OK', repair <= 0 || career.money < repair)}
        </div>
        <div class="panel">
          <h3>TUNING</h3>
          ${shopRow('buy-engine', `Motor ${pips(career.engine)}`, 'Höhere Endgeschwindigkeit', motor.label, motor.disabled)}
          ${shopRow('buy-handling', `Handling ${pips(career.handling)}`, 'Engere Kurven', handling.label, handling.disabled)}
          ${shopRow('buy-armor', `Panzerung ${pips(career.armor)}`, 'Weniger Schaden', armor.label, armor.disabled)}
        </div>
        <div class="panel">
          <h3>WAFFENAUSWAHL</h3>
          ${shopRow('buy-ammo-front', `&#9650; Front-Rakete × ${career.ammoFront}`,
            `Feuert nach vorn (max. ${MAX_AMMO})`, money(AMMO_COSTS.front),
            career.ammoFront >= MAX_AMMO || career.money < AMMO_COSTS.front)}
          ${shopRow('buy-ammo-rear', `&#9660; Heck-Rakete × ${career.ammoRear}`,
            `Feuert nach hinten (max. ${MAX_AMMO})`, money(AMMO_COSTS.rear),
            career.ammoRear >= MAX_AMMO || career.money < AMMO_COSTS.rear)}
        </div>
        <div class="panel">
          <h3>GEGNERSTÄRKE</h3>
          ${difficultyPicker(career.difficulty)}
        </div>
        <button class="big" id="race-btn">ZUM RENNEN &#9654;</button>
        <p class="hint">Rennen ${career.stage + 1}/${tracks.length} • ${career.points} Punkte</p>
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
      bind('buy-ammo-front', 'ammoFront');
      bind('buy-ammo-rear', 'ammoRear');
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
        <div class="sub">${result.trackName} • ERGEBNIS</div>
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

    champion({ career, onRestart }) {
      show(`
        <div class="logo">CHAMPION!</div>
        <div class="sub">DU HAST DIE TURBO TROPHY GEWONNEN</div>
        <div class="panel">
          <div class="row"><span class="lbl">Punkte</span><span class="moneytag">${career.points}</span></div>
          <div class="row"><span class="lbl">Restguthaben</span><span class="moneytag">${money(career.money)}</span></div>
        </div>
        <button class="big" id="again-btn">NEUE SAISON</button>
        <a class="overview-link" href="../../index.html">← Zur Spiele-Übersicht</a>
      `);
      onClick('again-btn', onRestart);
    },
  };

  return screens;
}
