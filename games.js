// Manifest aller Spiele. Neues Spiel = neuer Eintrag hier + Verzeichnis unter games/.
//
// `cover` ist optional: Spiele mit Titelbild bekommen auf der Übersicht eine
// Bildkarte, alle anderen behalten die Emoji-Karte. Der Pfad muss über
// `new URL(..., import.meta.url)` laufen – nur so schreibt Vite ihn beim Build
// auf den gehashten Dateinamen um (nackte Strings kopiert der Build nicht mit).
export const games = [
  {
    slug: 'artillerie-commander',
    title: 'Artillerie Commander',
    description: 'Rundenbasierte Panzerschlachten: Winkel, Ladung und Wind meistern, Gelände sprengen und das Arsenal aufrüsten.',
    emoji: '💥',
    cover: new URL('./games/artillerie-commander/assets/title-banner.webp', import.meta.url).href,
    coverAlt: 'Zwei farbige Pixelpanzer beschießen sich über eine Kraterlandschaft, während eine Granate im hohen Bogen fliegt',
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
    description: 'Lichträtsel: Dreh die Spiegel, spalte den Strahl im Prisma, webe ihn durch alle Knoten. Mit Editor für eigene Level – teilbar per Link.',
    emoji: '✦',
    cover: new URL('./games/lumenweber/assets/title-banner.webp', import.meta.url).href,
    coverAlt: 'Ein Prisma teilt weißes Licht in einen cyanfarbenen und einen bernsteinfarbenen Pfad, die an einem zweiten Prisma wieder weiß zusammenlaufen',
  },
  {
    slug: 'schach',
    title: 'Schach',
    description: 'Zu zweit am selben Gerät oder gegen den Rechner: gedrehtes Brett, Uhr, Zugliste – und eine Engine mit drei Spielstärken.',
    emoji: '♛',
    cover: new URL('./games/schach/assets/title-banner.webp', import.meta.url).href,
    coverAlt: 'Eine weiße Dame steht auf einem perspektivisch fluchtenden Brett vor dem umgekippten schwarzen König',
  },
  {
    slug: 'super-cars',
    title: 'Super Cars',
    description: 'Arcade-Rennen mit Raketen, Tuning-Shop und Meisterschaft – 3D von schräg hinten.',
    emoji: '🏎️',
    cover: new URL('./games/super-cars/assets/title-banner.webp', import.meta.url).href,
    coverAlt: 'Ein roter Sportwagen verfolgt drei Rivalen und eine Rakete auf einer kurvigen 3D-Rennstrecke bei Sonnenuntergang',
  },
  {
    slug: 'turbo-trophy',
    title: 'Turbo Trophy',
    description: 'Arcade-Rennen mit Raketen, Werkstatt und Meisterschaft über mehrere Saisons – 2D von oben im Amiga-Stil.',
    emoji: '🏁',
    cover: new URL('./games/turbo-trophy/assets/title-banner.webp', import.meta.url).href,
    coverAlt: 'Vier farbige Pixelautos liefern sich aus der Draufsicht ein bewaffnetes Rennen auf einer geschwungenen Strecke',
  },
];
