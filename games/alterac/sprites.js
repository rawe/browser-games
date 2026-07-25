// Einheiten-Porträts aus einem Atlas (`assets/units/`): ein Bild mit acht
// Zellen à 128 px – vier Einheitentypen mal zwei Fraktionen.
//
// Die Grafik ist reine Kosmetik. Solange sie nicht geladen ist – oder gar nicht
// lädt – zeichnet der Renderer sein bisheriges Kreis-Token mit Kurzzeichen. Das
// Spiel darf nie an einer Grafik hängen, deshalb gibt es hier kein `await` und
// keinen Fehlerpfad, der nach außen dringt.
//
// Die Zellenliste kommt aus `units.json` (vom Bildpaket mitgeliefert und im
// Build eingebettet), nicht aus fest verdrahteten Koordinaten: Wächst der Atlas
// um Zeilen oder Typen, genügt die neue JSON. Die Schlüssel sind
// `<fraktion>.<typKey>` und passen damit direkt auf `g.faction` und
// `def.key` aus config.js.

import atlas from './assets/units/units.json';

// `new URL(..., import.meta.url)` statt nacktem Pfad: Nur so schreibt Vite die
// Adresse auf den gehashten Build-Namen um und der relative Pages-Build
// (`base: './'`) findet die Datei auch in einem Unterverzeichnis.
//
// Ausgeliefert wird allein die WebP. Das gleichnamige PNG daneben ist das
// verlustfreie Original für spätere Zuschnitte und wird bewusst nicht geladen –
// als Rückfall wäre es 186 kB Ballast in jedem Build für einen Fall, den es seit
// Jahren nicht mehr gibt.
const SOURCE = new URL('./assets/units/units.webp', import.meta.url).href;

let image = null;

{
  const img = new Image();
  img.onload = () => {
    image = img;
  };
  img.src = SOURCE;
}

// Zeichenfertige Quellangabe für eine Einheit oder null, wenn es für sie kein
// Porträt gibt (unbekannter Typ, Planungs-Platzhalter, Atlas noch nicht da).
export function unitSprite(faction, typeKey) {
  if (!image || !faction || !typeKey) return null;
  const f = atlas.frames[`${faction}.${typeKey}`];
  if (!f) return null;
  return { image, sx: f.x, sy: f.y, sw: f.w ?? atlas.cell, sh: f.h ?? atlas.cell };
}

// Zellenposition als Spalte/Zeile – für die HTML-Seite, die dieselbe Grafik als
// CSS-Hintergrund verwendet (Aufstellungsliste im Planungspanel). Anders als
// `unitSprite` hängt das nicht am geladenen Bild: Die Koordinaten stehen in der
// eingebetteten JSON, das Nachladen erledigt der Browser mit dem Stylesheet.
export function spriteCell(faction, typeKey) {
  const f = atlas.frames[`${faction}.${typeKey}`];
  if (!f) return null;
  return { col: f.x / atlas.cell, row: f.y / atlas.cell };
}
