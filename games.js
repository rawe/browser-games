// Manifest aller Spiele. Neues Spiel = neuer Eintrag hier + Verzeichnis unter games/.
//
// `cover` ist optional: Spiele mit Titelbild bekommen auf der Übersicht eine
// Bildkarte, alle anderen behalten die Emoji-Karte. Der Pfad muss über
// `new URL(..., import.meta.url)` laufen – nur so schreibt Vite ihn beim Build
// auf den gehashten Dateinamen um (nackte Strings kopiert der Build nicht mit).
export const games = [
  {
    slug: 'snake',
    title: 'Snake',
    description: 'Der Klassiker – iss, wachse, weiche dir selbst aus.',
    emoji: '🐍',
  },
  {
    slug: 'alterac',
    title: 'Alterac Combat Simulator',
    description: 'Taktik-Autobattler: Routen planen, Truppen fusionieren, Punkte halten – dann läuft die Schlacht von allein.',
    emoji: '⚔️',
    cover: new URL('./games/alterac/assets/title-banner.webp', import.meta.url).href,
    coverAlt: 'Der Fürst der Sturmlanze und der Kriegshäuptling des Frostwolfs stehen sich vor ihren Bannern im nächtlichen Alteractal gegenüber',
  },
  {
    slug: 'lumenweber',
    title: 'Lumenweber',
    description: 'Lichträtsel: Dreh die Spiegel, spalte den Strahl im Prisma, webe ihn durch alle Knoten.',
    emoji: '✦',
  },
  {
    slug: 'super-cars',
    title: 'Super Cars',
    description: 'Arcade-Rennen mit Raketen, Tuning-Shop und Meisterschaft – 3D von schräg hinten.',
    emoji: '🏎️',
  },
  {
    slug: 'turbo-trophy',
    title: 'Turbo Trophy',
    description: 'Arcade-Rennen mit Raketen, Werkstatt und Meisterschaft über mehrere Saisons – 2D von oben im Amiga-Stil.',
    emoji: '🏁',
  },
];
