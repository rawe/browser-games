// Porträts aus zwei Atlanten in `assets/units/`:
//
// `units.webp` – acht Zellen à 128 px, vier Einheitentypen mal zwei Fraktionen.
// `bosses.webp` – zwei Zellen à 256 px, je ein Boss pro Fraktion.
//
// Die Grafiken sind reine Kosmetik. Solange sie nicht geladen sind – oder gar
// nicht laden – zeichnet der Renderer sein bisheriges Kreis-Token mit
// Kurzzeichen und die Festung ohne Medaillon. Das Spiel darf nie an einer
// Grafik hängen, deshalb gibt es hier kein `await` und keinen Fehlerpfad, der
// nach außen dringt.

import atlas from './assets/units/units.json';

function loadAtlas(url) {
  const ref = { image: null };
  const img = new Image();
  img.onload = () => {
    ref.image = img;
  };
  img.src = url;
  return ref;
}

// `new URL(..., import.meta.url)` statt nacktem Pfad: Nur so schreibt Vite die
// Adresse auf den gehashten Build-Namen um und der relative Pages-Build
// (`base: './'`) findet die Datei auch in einem Unterverzeichnis.
//
// Vom Einheitenatlas wird allein die WebP ausgeliefert. Das gleichnamige PNG
// daneben ist das verlustfreie Original für spätere Zuschnitte und wird bewusst
// nicht geladen – als Rückfall wäre es 186 kB Ballast in jedem Build für einen
// Fall, den es seit Jahren nicht mehr gibt. Vom Bossatlas gibt es aus demselben
// Grund von vornherein nur die WebP.
const units = loadAtlas(new URL('./assets/units/units.webp', import.meta.url).href);
const bosses = loadAtlas(new URL('./assets/units/bosses.webp', import.meta.url).href);

// Die Zellenliste des Einheitenatlas kommt aus `units.json` (vom Bildpaket
// mitgeliefert und im Build eingebettet), nicht aus fest verdrahteten
// Koordinaten: Wächst der Atlas um Zeilen oder Typen, genügt die neue JSON. Die
// Schlüssel sind `<fraktion>.<typKey>` und passen damit direkt auf `g.faction`
// und `def.key` aus config.js.
//
// Der Bossatlas kommt ohne JSON aus. Seine Aufteilung ist mit einer Zelle je
// Fraktion abschließend – es gibt keine dritte Seite, um die er wachsen könnte.
// Die doppelte Zellgröße hat einen Grund: Das Boss-Medaillon steht auf der
// Karte größer als ein Trupp-Token und erscheint zusätzlich groß im
// Ergebnis-Overlay.
const BOSS_CELL = 256;
const BOSS_COL = { blue: 0, red: 1 };

// Zeichenfertige Quellangabe für eine Einheit oder null, wenn es für sie kein
// Porträt gibt (unbekannter Typ, Planungs-Platzhalter, Atlas noch nicht da).
export function unitSprite(faction, typeKey) {
  if (!units.image || !faction || !typeKey) return null;
  const f = atlas.frames[`${faction}.${typeKey}`];
  if (!f) return null;
  return { image: units.image, sx: f.x, sy: f.y, sw: f.w ?? atlas.cell, sh: f.h ?? atlas.cell };
}

// Dasselbe für den Boss einer Fraktion.
export function bossSprite(faction) {
  const col = BOSS_COL[faction];
  if (!bosses.image || col === undefined) return null;
  return { image: bosses.image, sx: col * BOSS_CELL, sy: 0, sw: BOSS_CELL, sh: BOSS_CELL };
}

// Zellenposition als Spalte/Zeile – für die HTML-Seite, die dieselben Grafiken
// als CSS-Hintergrund verwendet (Aufstellungsliste im Planungspanel,
// Ergebnis-Overlay). Anders als `unitSprite`/`bossSprite` hängt das nicht am
// geladenen Bild: Die Koordinaten stehen fest, das Nachladen erledigt der
// Browser mit dem Stylesheet.
export function spriteCell(faction, typeKey) {
  const f = atlas.frames[`${faction}.${typeKey}`];
  if (!f) return null;
  return { col: f.x / atlas.cell, row: f.y / atlas.cell };
}

export function bossCell(faction) {
  const col = BOSS_COL[faction];
  return col === undefined ? null : { col, row: 0 };
}
