import { games } from './games.js';

const list = document.getElementById('game-list');

list.innerHTML = games
  .map(
    (game) => `
    <li>
      <a class="game-card" href="./games/${game.slug}/index.html">
        <span class="game-emoji">${game.emoji}</span>
        <span class="game-title">${game.title}</span>
        <span class="game-description">${game.description}</span>
      </a>
    </li>`
  )
  .join('');
