import { games } from './games.js';

const list = document.getElementById('game-list');

// Spiele mit `cover` bekommen eine Bildkarte, alle anderen die Emoji-Karte.
// Auf der Bildkarte liegt der Titel im Bild, damit das Motiv die volle
// Kartenbreite behält.
const cardFace = (game) =>
  game.cover
    ? `<span class="game-cover">
         <img src="${game.cover}" alt="${game.coverAlt ?? ''}" width="1536" height="640" />
         <span class="game-title">${game.title}</span>
       </span>`
    : `<span class="game-emoji">${game.emoji}</span>
       <span class="game-title">${game.title}</span>`;

list.innerHTML = games
  .map(
    (game) => `
    <li>
      <a class="game-card${game.cover ? ' has-cover' : ''}" href="./games/${game.slug}/index.html">
        ${cardFace(game)}
        <span class="game-description">${game.description}</span>
      </a>
    </li>`
  )
  .join('');
