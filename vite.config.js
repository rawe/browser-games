import { defineConfig } from 'vite';
import { globSync } from 'node:fs';
import { resolve } from 'node:path';

// Jedes games/*/index.html wird automatisch als eigener Einstiegspunkt gebaut.
const gameEntries = Object.fromEntries(
  globSync('games/*/index.html').map((file) => [
    file.split('/')[1],
    resolve(import.meta.dirname, file),
  ])
);

export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        ...gameEntries,
      },
    },
  },
});
