// Die Legende: dieselben Zeilen für die Regelseite und für das laufende Spiel.
//
// Beide Orte brauchen dieselbe Auskunft, nur in unterschiedlichem Umfang: Die
// Regelseite zeigt alle vier Knotenarten, die Legende neben dem Brett nur die,
// die in diesem Level wirklich vorkommen – dazu, wie viele davon schon
// leuchten. Deshalb eine Bauform mit zwei Aufrufen statt zweier Bauformen, die
// mit der Zeit auseinanderdriften.

import { NODE_NAME, NODE_RULE, LIGHTS, nodeIcon, passes, lightCss } from './nodes.js';

/**
 * Was durch diesen Knoten passt – drei Marken, eine je Lichtsorte.
 *
 * Das Häkchen trägt die Farbe des Lichts, das Kreuz bleibt stumm. So liest man
 * die Zeile auch quer: Wo Farbe steht, geht Licht durch.
 */
function passMarks(want) {
  return LIGHTS.map((light) => {
    const ok = passes(want, light.colors);
    const tint = ok ? ` style="--c:${lightCss(light.colors)}"` : '';
    return `<span class="pass${ok ? ' is-yes' : ' is-no'}"${tint}>`
      + `<span class="pass-mark" aria-hidden="true">${ok ? '✓' : '✗'}</span>${light.name}</span>`;
  }).join('');
}

/**
 * Eine Zeile: Symbol, Name, was durchpasst, Klartext.
 *
 * `count` ist optional – nur die Legende im Spiel kennt einen Zählerstand.
 */
function row(want, count) {
  const done = count && count.lit === count.total;
  const tally = count
    ? `<span class="legend-count${done ? ' is-done' : ''}">${count.lit}/${count.total}</span>`
    : '';
  return `<li class="legend-row${done ? ' is-done' : ''}">
    <span class="legend-icon">${nodeIcon(want)}</span>
    <span class="legend-text">
      <span class="legend-head"><b>${NODE_NAME[want]}</b>${tally}</span>
      <span class="legend-pass">${passMarks(want)}</span>
      <span class="legend-rule">${NODE_RULE[want]}</span>
    </span>
  </li>`;
}

/**
 * @param {string[]} wants   welche Knotenarten gezeigt werden
 * @param {Object<string,{lit:number,total:number}>} [counts] Zählerstand je Art
 */
export const legendList = (wants, counts = null) =>
  `<ul class="legend-list">${wants.map((w) => row(w, counts?.[w])).join('')}</ul>`;
