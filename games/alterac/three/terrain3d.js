// Gelände des 3D-Modus: verschneites Alteractal als Höhenfeld.
//
// VERTRAG (renderer3d.js verlässt sich darauf):
//   createTerrain3D({ map }) → {
//     group,            // THREE.Group mit allem Gelände + Dekoration
//     heightAt(x, y),   // Terrainhöhe (Welt-Y) an KARTENkoordinate (x, y);
//                       // schnell, allokationsfrei, außerhalb der Karte
//                       // liefert sie den geklemmten Randwert
//     dispose(),        // Geometrien/Materialien/Texturen freigeben
//   }
//
// Aufbau: EIN Höhenfeld (97×177 Stützstellen über Karte + Rand) trägt alles.
// heightAt liest bilinear daraus; die Geometrie ist dasselbe Feld als
// unindiziertes Dreiecksnetz mit Facettenfarben (Low-Poly, flat shading).
// Wege (EDGE-Polylinien) und Wegpunkt-Umgebungen bleiben auf den glatten,
// niederfrequenten Höhenanteilen – das feine Gelände wird dort weich
// ausgeblendet, damit Einheiten und Bauwerke exakt auf begehbarem Grund
// stehen und nie über Buckel springen. Jenseits des Spielfelds steigen
// verrauschte Felsgrate (150–260 hoch) als natürlicher Weltabschluss auf,
// auch hinter den Festungen im Norden und Süden. Dekoration (Kiefern,
// Felsbrocken, gefrorener Bergsee) ist deterministisch über seededRand
// verteilt und meidet Wege und Wegpunkte.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { toWorldX, toWorldZ, MAP_W, MAP_H, PALETTE, seededRand } from './world.js';
import { edgePoint } from '../map.js';

// ------------------------------------------------------------------- Raster
// Das Höhenfeld überspannt die Karte plus RAND Pixel je Seite: genug Platz
// für die Bergflanken, ohne das Dreiecksbudget zu sprengen (96×176 Zellen
// ≈ 33 800 Dreiecke bei ≈ 9×8 Kartenpixel Zellgröße).
const RAND = 200;
const GX0 = -RAND;
const GY0 = -RAND;
const GW = MAP_W + 2 * RAND; // 880
const GH = MAP_H + 2 * RAND; // 1360
const SEG_X = 96;
const SEG_Y = 176;
const VX = SEG_X + 1;
const VY = SEG_Y + 1;
const CELL_X = GW / SEG_X;
const CELL_Y = GH / SEG_Y;

// Begehbarer Kern: außerhalb steigen die Grate auf. Norden/Süden enden
// bewusst schon bei y = 40 bzw. 920 – die Bosse (y = 78/896) stehen so mit
// dem Rücken zur Felswand, ohne dass ihre Wegumgebung mit angehoben wird.
const WALK_X0 = 0;
const WALK_X1 = MAP_W;
const WALK_Y0 = 40;
const WALK_Y1 = MAP_H - 40;

// Wege: im Kern exakt Wegniveau, danach weiche Blende. Zusammen mit dem
// Knotenradius ergibt das die geforderte glatte Zone (~34 px um Knoten,
// ~26 px Übergang).
const PATH_CORE = 8;
const NODE_R = 34;
const BLEND = 26;
const EDGE_SAMPLES = 24;

function sstep(e0, e1, x) {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// Wert-Rauschen über einem seededRand-Gitter, weich interpoliert, Werte in
// [-1, 1]. Bewusst an die Terrainausdehnung gebunden (GX0/GW): jede Oktave
// ist überall im Feld definiert und bei jedem Laden identisch.
function makeNoise(seed, nx, ny) {
  const rand = seededRand(seed);
  const vals = new Float32Array((nx + 1) * (ny + 1));
  for (let i = 0; i < vals.length; i++) vals[i] = rand() * 2 - 1;
  return (x, y) => {
    let u = ((x - GX0) / GW) * nx;
    let v = ((y - GY0) / GH) * ny;
    u = Math.min(Math.max(u, 0), nx - 1e-6);
    v = Math.min(Math.max(v, 0), ny - 1e-6);
    const i = Math.floor(u);
    const j = Math.floor(v);
    let fu = u - i;
    let fv = v - j;
    fu = fu * fu * (3 - 2 * fu);
    fv = fv * fv * (3 - 2 * fv);
    const r = j * (nx + 1) + i;
    const a = vals[r];
    const b = vals[r + 1];
    const c = vals[r + nx + 1];
    const d = vals[r + nx + 2];
    const top = a + (b - a) * fu;
    return top + (c + (d - c) * fu - top) * fv;
  };
}

// Abstand zum begehbaren Rechteck (0 innerhalb) – Basis des Bergkranzes.
function rectDist(x, y) {
  const dx = Math.max(WALK_X0 - x, 0, x - WALK_X1);
  const dy = Math.max(WALK_Y0 - y, 0, y - WALK_Y1);
  return Math.hypot(dx, dy);
}

// Kürzester Abstand zu allen Weg-Segmenten (flaches Array ax,ay,bx,by,…).
function polyDist(x, y, segs) {
  let best = Infinity;
  for (let i = 0; i < segs.length; i += 4) {
    const ax = segs[i];
    const ay = segs[i + 1];
    const dx = segs[i + 2] - ax;
    const dy = segs[i + 3] - ay;
    let t = ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy);
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const ex = ax + t * dx - x;
    const ey = ay + t * dy - y;
    const d = ex * ex + ey * ey;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

function pointDist(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - x;
    const dy = pts[i + 1] - y;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

// Bilineare Abtastung eines Feldes in Stützstellen-Auflösung; klemmt an den
// Rändern (liefert also außerhalb den Randwert). Allokationsfrei – heightAt
// ist genau diese Funktion über dem Höhenfeld.
function sampleField(field, x, y) {
  let u = ((x - GX0) / GW) * SEG_X;
  let v = ((y - GY0) / GH) * SEG_Y;
  u = u < 0 ? 0 : u > SEG_X - 1e-6 ? SEG_X - 1e-6 : u;
  v = v < 0 ? 0 : v > SEG_Y - 1e-6 ? SEG_Y - 1e-6 : v;
  const i = u | 0;
  const j = v | 0;
  const fu = u - i;
  const fv = v - j;
  const r = j * VX + i;
  const a = field[r];
  const b = field[r + 1];
  const c = field[r + VX];
  const d = field[r + VX + 1];
  return a + (b - a) * fu + (c - a) * fv + (a - b - c + d) * fu * fv;
}

// ------------------------------------------------------ gebackene Bodentextur
// Eine Canvas-Textur (1024×2048, multipliziert mit den Facettenfarben) malt
// die festgetretenen Spuren: mehrere versetzte, halbtransparente Züge je Weg
// ergeben einen zur Mitte dichteren Trampelpfad statt einer aufgeklebten
// Linie; dazu Verschattungsflecken, damit der Schnee nicht steril wirkt.
//
// Der Bake läuft bis zu zweimal: beim Aufbau rein prozedural (vollwertiger
// Fallback aus Flächen und Verläufen), und sobald die gemalten Kacheln aus
// assets/3d/ geladen sind, EINMAL erneut mit CanvasPattern-Füllungen (imgs)
// in dieselbe Canvas. Gezeichnet wird in Kartenkoordinaten; die Muster werden
// dort über Pattern-Transformen auf feste Kachelgrößen skaliert und je Lage
// leicht rotiert, damit kein Kachelraster ablesbar wird. Die Platzierung ist
// bewusst zufallsfrei – seededRand bleibt den bestehenden Streuungen
// vorbehalten und liefert bei jedem Bake dieselbe Folge.
const SNOW_TILE = 104; // Kartenpixel je Schneekachel (Grundfläche)
const PATH_TILE = 72; //  Kartenpixel je Trampelpfad-Kachel
const ROCK_TILE = 128; // Kartenpixel je Felskachel (Bergkranz)
const ROCK_FEATHER = 50; // Ausfederung der Fels-Innenkante in Kartenpixeln

// Detail-Kachelgrößen (Kartenpixel je Kachel) für die Shader-Detail-Maps in
// nativer Texturauflösung – bewusst feiner als die Makro-Muster der Canvas,
// die auf 1024×2048 gestaucht nur noch die Fernsicht trägt.
const DETAIL_SNOW_TILE = 70;
const DETAIL_PATH_TILE = 52;
const DETAIL_ROCK_TILE = 104;

// Wegzug-Lagen, außen breit und dünn, innen schmal und dicht. `c` ist die
// Fallback-Farbe (Alpha eingebacken – unverändert der bisherige prozedurale
// Look), `pat` die deutlich zurückgenommene Deckkraft des Muster-Bakes
// (~45 % von früher: die Struktur kommt jetzt aus der Shader-Detail-Map, die
// Canvas liefert nur noch die weiche Makro-Abdunklung), `mask` die
// Wegintensität für den R-Kanal der Masken-Textur, `rot` die
// Pattern-Rotation je Lage.
const PASSES = [
  { w: 44, c: 'rgba(172, 180, 200, 0.20)', pat: 0.09, mask: 0.2, rot: 0.4 },
  { w: 28, c: 'rgba(159, 168, 190, 0.35)', pat: 0.16, mask: 0.35, rot: -0.35 },
  { w: 16, c: 'rgba(147, 156, 180, 0.42)', pat: 0.2, mask: 0.42, rot: 0.15 },
  { w: 8, c: 'rgba(136, 146, 172, 0.35)', pat: 0.16, mask: 0.35, rot: 0 },
];

// Zeichnet alle Wegzüge mit dem aktuellen Stroke-Stil. Der Jitter kommt aus
// `rand` – Aufrufer mit gleichem Seed-Stand erzeugen deckungsgleiche Züge.
function strokePolys(ctx, polys, rand) {
  for (const pts of polys) {
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      const jx = pts[i] + (rand() - 0.5) * 4.5;
      const jy = pts[i + 1] + (rand() - 0.5) * 4.5;
      if (i === 0) ctx.moveTo(jx, jy);
      else ctx.lineTo(jx, jy);
    }
    ctx.stroke();
  }
}

// Bandzerlegung der Fels-Innenkante: K Ringe (Versatz e, Deckkraft a), deren
// multiplikative Wirkung – destination-out auf Alpha oder schwarzes
// source-over auf einer opaken Farbe – genau dem smoothstep-Restwert der
// jeweiligen Bandmitte über ROCK_FEATHER Kartenpixel entspricht.
function rockFeatherBands(K = 14) {
  const bandT = [];
  for (let j = 1; j <= K; j++) bandT.push(sstep(0, ROCK_FEATHER, (ROCK_FEATHER * (j - 0.5)) / K));
  const bands = [];
  for (let j = K; j >= 1; j--) {
    const next = j < K ? bandT[j] : 1;
    bands.push({ e: (ROCK_FEATHER * j) / K, a: 1 - bandT[j - 1] / next });
  }
  return bands;
}

// Wiederholmuster aus einem Bild, skaliert auf `tile` Kartenpixel je Kachel
// und optional rotiert (bricht die Rasterwirkung mehrerer Lagen). Liefert
// null, wenn der Browser das Bild (noch) nicht als Pattern hergibt – die
// Aufrufer fallen dann auf die prozeduralen Farben zurück.
function makePattern(ctx, img, tile, rot = 0) {
  const p = ctx.createPattern(img, 'repeat');
  if (p && p.setTransform) {
    const m = new DOMMatrix();
    m.rotateSelf((rot * 180) / Math.PI);
    m.scaleSelf(tile / img.width);
    p.setTransform(m);
  }
  return p;
}

// Rund maskierte Pattern-Scheibe für die Wegpunkt-Plätze: Offscreen das
// Muster füllen, per destination-in mit einem Radialverlauf maskieren, dann
// aufs Ziel stempeln. Die Offscreen-Transform hält das Muster in
// Kartenkoordinaten – es läuft also nahtlos in die Wegzüge weiter.
function stampPatternDisc(ctx, img, x, y, r) {
  const S = 2; // Offscreen-Auflösung: 2 px je Kartenpixel reicht für die Maske
  const off = document.createElement('canvas');
  off.width = off.height = Math.ceil(2 * r * S);
  const octx = off.getContext('2d');
  octx.setTransform(S, 0, 0, S, -S * (x - r), -S * (y - r));
  const pat = makePattern(octx, img, PATH_TILE);
  if (!pat) return false;
  octx.fillStyle = pat;
  octx.fillRect(x - r, y - r, 2 * r, 2 * r);
  // Deckkraft bewusst niedrig: die Platz-Struktur kommt aus der
  // Shader-Detail-Map, hier bleibt nur die weiche Makro-Abdunklung.
  const g = octx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, 'rgba(0, 0, 0, 0.28)');
  g.addColorStop(0.7, 'rgba(0, 0, 0, 0.17)');
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  octx.globalCompositeOperation = 'destination-in';
  octx.fillStyle = g;
  octx.fillRect(x - r, y - r, 2 * r, 2 * r);
  ctx.drawImage(off, x - r, y - r, 2 * r, 2 * r);
  return true;
}

// Begehbares Rechteck um `e` Kartenpixel nach außen versetzt – als Pfad mit
// runden Ecken (Radius = Versatz entspricht der echten Abstandsaufweitung).
function fillExpandedWalkRect(ctx, e) {
  ctx.beginPath();
  const w = WALK_X1 - WALK_X0 + 2 * e;
  const h = WALK_Y1 - WALK_Y0 + 2 * e;
  if (ctx.roundRect) ctx.roundRect(WALK_X0 - e, WALK_Y0 - e, w, h, e);
  else ctx.rect(WALK_X0 - e, WALK_Y0 - e, w, h);
  ctx.fill();
}

// Bergkranz: Felsmuster über alles außerhalb des begehbaren Kerns, mit weich
// ausgefederter Innenkante. Offscreen wird vollflächig Fels gefüllt und der
// Kern per destination-out wieder ausgestanzt – in Bändern, deren Alphawerte
// so gewählt sind, dass das Produkt der Bänder j..K genau dem gewünschten
// smoothstep-Restalpha der jeweiligen Bandmitte entspricht (destination-out
// wirkt multiplikativ). Ergebnis: 0 Deckkraft im Kern, glatter Anstieg auf 1
// über ROCK_FEATHER Kartenpixel.
function overlayRockRing(ctx, canvas, rockImg) {
  const off = document.createElement('canvas');
  off.width = canvas.width;
  off.height = canvas.height;
  const octx = off.getContext('2d');
  octx.setTransform(canvas.width / GW, 0, 0, canvas.height / GH, (-GX0 * canvas.width) / GW, (-GY0 * canvas.height) / GH);
  const pat = makePattern(octx, rockImg, ROCK_TILE, 0.2);
  if (!pat) return;
  octx.fillStyle = pat;
  octx.fillRect(GX0, GY0, GW, GH);

  octx.globalCompositeOperation = 'destination-out';
  octx.fillStyle = '#000';
  for (const b of rockFeatherBands()) {
    octx.globalAlpha = b.a;
    fillExpandedWalkRect(octx, b.e);
  }
  octx.globalAlpha = 1;
  fillExpandedWalkRect(octx, 0);

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}

function bakeGroundCanvas(polys, nodeList, imgs = {}, canvas = null) {
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 2048;
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  // Zeichnen in Kartenkoordinaten; die (leicht anisotrope) Skalierung fällt
  // im handgemalten Look nicht auf.
  ctx.setTransform(1024 / GW, 0, 0, 2048 / GH, (-GX0 * 1024) / GW, (-GY0 * 2048) / GH);

  // Grundfläche: Schneemuster, sonst neutrales Weiß. Die Textur multipliziert
  // die Facettenfarben – damit das Tal gegenüber dem bisherigen Weiß nicht
  // absäuft, wird das Muster anschließend mit 30 % Weiß Richtung Neutral
  // angehoben: Struktur bleibt sichtbar, Gesamthelligkeit fast unverändert.
  const snowPat = imgs.snowImg ? makePattern(ctx, imgs.snowImg, SNOW_TILE, 0.1) : null;
  ctx.fillStyle = snowPat || '#ffffff';
  ctx.fillRect(GX0, GY0, GW, GH);
  if (snowPat) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
    ctx.fillRect(GX0, GY0, GW, GH);
  }

  const rand = seededRand(7351);
  for (let i = 0; i < 130; i++) {
    const x = GX0 + rand() * GW;
    const y = GY0 + rand() * GH;
    const r = 25 + rand() * 100;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.04 + rand() * 0.07;
    g.addColorStop(0, `rgba(176, 186, 212, ${a.toFixed(3)})`);
    g.addColorStop(1, 'rgba(176, 186, 212, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wegpunkte als festgetretene Plätze – deckt auch die Wegkreuzungen ab.
  // Mit Path-Muster als radial maskierte Scheibe, sonst als flacher Verlauf.
  for (const n of nodeList) {
    if (imgs.pathImg && stampPatternDisc(ctx, imgs.pathImg, n.x, n.y, NODE_R + 6)) continue;
    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, NODE_R + 6);
    g.addColorStop(0, 'rgba(150, 159, 183, 0.5)');
    g.addColorStop(0.7, 'rgba(150, 159, 183, 0.28)');
    g.addColorStop(1, 'rgba(150, 159, 183, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(n.x, n.y, NODE_R + 6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Wegzüge: mehrere Lagen (PASSES), außen breit und dünn deckend, innen
  // schmal und dicht – so laufen die Pfade weich in den Schnee aus. Mit
  // Path-Muster wird jede Lage mit demselben, je Lage anders rotierten
  // Pattern gestrichen (globalAlpha = zurückgenommene Lagen-Deckkraft);
  // die Rotation verhindert, dass sich die Kachelwiederholung über die
  // Lagen hinweg aufaddiert.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of PASSES) {
    const pat = imgs.pathImg ? makePattern(ctx, imgs.pathImg, PATH_TILE, pass.rot) : null;
    ctx.strokeStyle = pat || pass.c;
    ctx.globalAlpha = pat ? pass.pat : 1;
    ctx.lineWidth = pass.w;
    strokePolys(ctx, polys, rand);
  }
  ctx.globalAlpha = 1;

  // Bergkranz zuletzt: liegt über Flecken und Wegresten außerhalb des Kerns.
  if (imgs.rockImg) overlayRockRing(ctx, canvas, imgs.rockImg);
  return canvas;
}

// ------------------------------------------------------------- Masken-Textur
// Kleine, rein prozedurale Maske für die Detail-Mischung im Shader – einmalig
// SYNCHRON beim Aufbau gebacken, keine Bilder nötig. Kanäle:
//   R = Wegintensität (Wegzüge + Knotenplätze, gleiche Breiten/Alphas wie der
//       prozedurale Farb-Bake),
//   G = Felszone (gefederte WALK-Rechteck-Maske wie overlayRockRing).
// Die Canvas bleibt vollständig opak: Grün wird zuerst vollflächig gelegt und
// im Kern mit schwarzen source-over-Bändern multiplikativ ausgefedert (gleiche
// Bandmathematik wie destination-out auf Alpha), Rot danach additiv per
// normaler Alpha-Überlagerung auf dem schwarzen Kern aufgebaut.
function bakeMaskCanvas(polys, nodeList) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(512 / GW, 0, 0, 1024 / GH, (-GX0 * 512) / GW, (-GY0 * 1024) / GH);

  // G-Kanal: außen volle Felszone, über ROCK_FEATHER zum Kern hin auf 0.
  ctx.fillStyle = '#00ff00';
  ctx.fillRect(GX0, GY0, GW, GH);
  for (const b of rockFeatherBands()) {
    ctx.fillStyle = `rgba(0, 0, 0, ${b.a.toFixed(4)})`;
    fillExpandedWalkRect(ctx, b.e);
  }
  ctx.fillStyle = '#000000';
  fillExpandedWalkRect(ctx, 0);

  // R-Kanal: gleicher Seed wie der Farb-Bake; die dort vor den Wegzügen
  // verbrauchten Zufallswerte (130 Flecken × 4 Aufrufe) werden übersprungen,
  // damit der Weg-Jitter in Maske und Farbtextur deckungsgleich ist.
  const rand = seededRand(7351);
  for (let i = 0; i < 130 * 4; i++) rand();
  for (const n of nodeList) {
    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, NODE_R + 6);
    g.addColorStop(0, 'rgba(255, 0, 0, 0.55)');
    g.addColorStop(0.7, 'rgba(255, 0, 0, 0.34)');
    g.addColorStop(1, 'rgba(255, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(n.x, n.y, NODE_R + 6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const pass of PASSES) {
    ctx.strokeStyle = `rgba(255, 0, 0, ${pass.mask})`;
    ctx.lineWidth = pass.w;
    strokePolys(ctx, polys, rand);
  }
  return canvas;
}

// Detail-Textur direkt aus einem bereits geladenen HTMLImageElement: kein
// Lade-Fenster, in dem der Shader Schwarz sampeln würde (ein per URL
// nachladendes Texture-Objekt wäre bis zum Eintreffen (0,0,0)). sRGB bleibt
// gesetzt – WebGL2 lädt dafür ein sRGB-Internformat, die Hardware dekodiert
// beim Sampeln, der Shader rechnet also linear wie diffuseColor selbst.
function makeDetailTexture(img) {
  const t = new THREE.Texture(img);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------- Baumgeometrie
// Krone = drei gestapelte, gegeneinander verdrehte Sechseck-Kegel (unten
// dunkler) plus flacher Schneekegel als Haube. Eine Geometrie für ALLE Bäume
// (InstancedMesh); Varianz kommt aus Instanzfarbe und -transformation.
function makeCrownGeometry() {
  const rand = seededRand(707);
  const cPine = new THREE.Color(PALETTE.pine);
  const cPineDark = new THREE.Color(PALETTE.pineDark);
  const cSnow = new THREE.Color(PALETTE.snowHigh);
  const tmp = new THREE.Color();
  const parts = [];
  const layers = [
    { r: 3.8, h: 4.8, y: 4.1, dark: 0.5, twist: 0 },
    { r: 2.9, h: 4.0, y: 6.4, dark: 0.3, twist: 0.55 },
    { r: 2.0, h: 3.4, y: 8.5, dark: 0.15, twist: 1.05 },
  ];
  for (const l of layers) {
    const g = new THREE.ConeGeometry(l.r, l.h, 6, 1, true).toNonIndexed();
    g.rotateY(l.twist);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) + l.h / 2) / l.h; // 0 unten … 1 Spitze
      const m = Math.min(1, Math.max(0, 0.55 - l.dark + t * 0.55 + (rand() - 0.5) * 0.16));
      tmp.copy(cPineDark).lerp(cPine, m);
      col[i * 3] = tmp.r;
      col[i * 3 + 1] = tmp.g;
      col[i * 3 + 2] = tmp.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.translate(0, l.y, 0);
    parts.push(g);
  }
  const snow = new THREE.ConeGeometry(1.5, 1.6, 6, 1, true).toNonIndexed();
  snow.rotateY(0.9);
  const spos = snow.attributes.position;
  const scol = new Float32Array(spos.count * 3);
  for (let i = 0; i < spos.count; i++) {
    const m = 0.92 + rand() * 0.08;
    scol[i * 3] = cSnow.r * m;
    scol[i * 3 + 1] = cSnow.g * m;
    scol[i * 3 + 2] = cSnow.b * m;
  }
  snow.setAttribute('color', new THREE.BufferAttribute(scol, 3));
  snow.translate(0, 9.9, 0);
  parts.push(snow);

  const merged = mergeGeometries(parts);
  for (const g of parts) g.dispose();
  return merged;
}

// Verbeulter Ikosaeder als Felsbrocken. Die Beule ist eine deterministische
// Funktion der Eckposition – duplizierte Eckpunkte (toNonIndexed) bleiben
// dadurch verschweißt.
function makeRockGeometry() {
  const rand = seededRand(808);
  const g = new THREE.IcosahedronGeometry(1.7, 0); // Polyhedron ist bereits unindiziert
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const q = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    const f = 0.76 + (q - Math.floor(q)) * 0.52;
    pos.setXYZ(i, x * f, y * f, z * f);
  }
  const cRock = new THREE.Color(PALETTE.rock);
  const cRockDark = new THREE.Color(PALETTE.rockDark);
  const tmp = new THREE.Color();
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i += 3) {
    tmp.copy(cRock).lerp(cRockDark, rand());
    for (let k = 0; k < 3; k++) {
      col[(i + k) * 3] = tmp.r;
      col[(i + k) * 3 + 1] = tmp.g;
      col[(i + k) * 3 + 2] = tmp.b;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

export function createTerrain3D({ map }) {
  const group = new THREE.Group();

  // ---------------------------------------------- Wege als Polylinien
  // Jede Kante wird über edgePoint abgetastet – dieselbe Kurve, auf der die
  // Einheiten laufen. polys fürs Textur-Backen, segs für Abstandsanfragen.
  const polys = [];
  const segs = [];
  for (const e of map.edges) {
    const pts = [];
    for (let i = 0; i < EDGE_SAMPLES; i++) {
      const p = edgePoint(map, e.a, e.b, i / (EDGE_SAMPLES - 1));
      if (i > 0) segs.push(pts[pts.length - 2], pts[pts.length - 1], p.x, p.y);
      pts.push(p.x, p.y);
    }
    polys.push(pts);
  }
  const nodePts = [];
  for (const n of map.nodeList) nodePts.push(n.x, n.y);

  // ---------------------------------------------- Rausch-Oktaven
  const coarse = makeNoise(101, 7, 12); // Talboden, großräumig (auch unter Wegen)
  const mid = makeNoise(202, 18, 30); //   mittleres Gelände – auf Wegen ausgeblendet
  const fine = makeNoise(303, 40, 66); //  feine Wellen – ebenso
  const ridge = makeNoise(404, 9, 15); //  Grathöhe des Bergkranzes
  const warp = makeNoise(505, 12, 20); //  verzerrt die Gratlinie
  const crag = makeNoise(606, 46, 76); //  schroffe Details an den Flanken

  // ---------------------------------------------- gefrorener Bergsee
  // Kleiner See in der Nordostecke unterhalb des Eisigen Grats – nur, wenn er
  // nachweislich frei von Weg- und Knotenzonen liegt (Kartenänderungen sollen
  // ihn stillschweigend entfallen lassen statt Wege zu verbiegen).
  let pond = { x: 432, y: 116, r: 20, depth: 3 };
  {
    const clear = PATH_CORE + BLEND + pond.r + 6 + 4; // Wegkern+Blende+Wanne+Puffer
    if (polyDist(pond.x, pond.y, segs) < clear || pointDist(pond.x, pond.y, nodePts) < NODE_R + BLEND + 4) {
      pond = null;
    }
  }

  // ---------------------------------------------- Höhenfeld
  const heightF = new Float32Array(VX * VY);
  const pdF = new Float32Array(VX * VY); // Wegabstand (für Dekoration)
  const ndF = new Float32Array(VX * VY); // Knotenabstand
  const fadeF = new Float32Array(VX * VY); // 0 = Wegniveau … 1 = freies Gelände

  // Wegniveau: Talprofil (Norden als Hochlage, Süden leicht erhöht, Ränder
  // als flache Wanne) plus großräumige Wellen – alles niederfrequent, damit
  // Wege stufenfrei daraufliegen. Die Plätze um Wegpunkte werden zusätzlich
  // weich auf das Niveau ihres Knotenzentrums eingeebnet, damit Bauwerke
  // nicht auf schrägem Grund stehen.
  const baseLevel = (x, y) => {
    const nx = (x - MAP_W / 2) / (MAP_W / 2);
    return 7 * (1 - sstep(90, 470, y)) + 3 * sstep(560, 930, y) + 3.5 * nx * nx + 3 * coarse(x, y);
  };
  const nodeLevels = map.nodeList.map((n) => baseLevel(n.x, n.y));

  for (let j = 0; j < VY; j++) {
    const y = GY0 + j * CELL_Y;
    for (let i = 0; i < VX; i++) {
      const x = GX0 + i * CELL_X;
      const idx = j * VX + i;
      const pd = polyDist(x, y, segs);
      // Knotenabstand und Platz-Einebnung in einem Zug: jedes Knotenniveau
      // zieht mit weichem Gewicht – als Mischung ALLER Knoten (nicht nur des
      // nächsten), sonst entstünde an der Grenze zweier nah beieinander
      // liegender Wegpunkte (mid–gym) eine Knickstelle im Weg.
      let nd = Infinity;
      let wsum = 0;
      let lsum = 0;
      for (let k = 0; k < nodePts.length; k += 2) {
        const dx = nodePts[k] - x;
        const dy = nodePts[k + 1] - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < nd) nd = d;
        const w = 1 - sstep(NODE_R * 0.5, NODE_R + BLEND, d);
        if (w > 0) {
          wsum += w;
          lsum += w * nodeLevels[k >> 1];
        }
      }
      pdF[idx] = pd;
      ndF[idx] = nd;
      const prox = Math.min(Math.max(0, pd - PATH_CORE), Math.max(0, nd - NODE_R));
      const fade = sstep(0, BLEND, prox);
      fadeF[idx] = fade;

      let h = baseLevel(x, y);
      if (wsum > 0) h += (lsum / wsum - h) * Math.min(1, wsum);

      let pondFade = 1;
      if (pond) {
        const dp = Math.hypot(x - pond.x, y - pond.y);
        pondFade = sstep(pond.r * 0.4, pond.r + 16, dp);
        h -= pond.depth * (1 - sstep(0, pond.r + 6, dp));
      }
      // Feines Gelände nur abseits von Wegen, Knoten und Seewanne.
      h += (1.6 * mid(x, y) + 0.8 * fine(x, y)) * fade * pondFade;

      // Bergkranz: Abstand zum begehbaren Kern, per Rauschen verzerrt →
      // unregelmäßige Gratlinie; 150–260 hoch plus schroffe Details.
      const s = sstep(10, 178, rectDist(x, y) + 24 * warp(x, y));
      if (s > 0) h += s * (205 + 55 * ridge(x, y) + 24 * crag(x, y));
      heightF[idx] = h;
    }
  }

  function heightAt(x, y) {
    return sampleField(heightF, x, y);
  }

  // ---------------------------------------------- Terrainnetz
  // Unindiziert mit Facettenfarben: Steilheit → Fels, Kuppen/Mulden →
  // Schneetöne, Wegzonen → path-Ton; Schachbrett-Diagonalen und leichte
  // Helligkeitsvarianz je Facette halten die Fläche lebendig.
  const faceCount = SEG_X * SEG_Y * 2;
  const positions = new Float32Array(faceCount * 9);
  const normals = new Float32Array(faceCount * 9);
  const colors = new Float32Array(faceCount * 9);
  const uvs = new Float32Array(faceCount * 6);

  const cSnowHigh = new THREE.Color(PALETTE.snowHigh);
  const cSnowLow = new THREE.Color(PALETTE.snowLow);
  const cSnowShadow = new THREE.Color(PALETTE.snowShadow);
  const cRock = new THREE.Color(PALETTE.rock);
  const cRockDark = new THREE.Color(PALETTE.rockDark);
  const cPath = new THREE.Color(PALETTE.path);
  const cA = new THREE.Color();
  const jrand = seededRand(9091);

  const TRIS = [
    [0, 0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0], // Diagonale ↘
    [0, 0, 0, 1, 1, 0, 1, 0, 0, 1, 1, 1], // Diagonale ↙
  ];
  const px = [0, 0, 0];
  const py = [0, 0, 0];
  const ph = [0, 0, 0];
  let o3 = 0;
  let o2 = 0;
  for (let iy = 0; iy < SEG_Y; iy++) {
    for (let ix = 0; ix < SEG_X; ix++) {
      const tri = TRIS[(ix + iy) & 1];
      for (let f = 0; f < 2; f++) {
        let fadeSum = 0;
        let hSum = 0;
        for (let k = 0; k < 3; k++) {
          const gx = ix + tri[f * 6 + k * 2];
          const gy = iy + tri[f * 6 + k * 2 + 1];
          const idx = gy * VX + gx;
          px[k] = GX0 + gx * CELL_X;
          py[k] = GY0 + gy * CELL_Y;
          ph[k] = heightF[idx];
          fadeSum += fadeF[idx];
          hSum += ph[k];
        }
        // Facettennormale (Weltachsen: x→Osten, y→Höhe, z→Süden).
        const ux = px[1] - px[0];
        const uy = ph[1] - ph[0];
        const uz = py[1] - py[0];
        const vx = px[2] - px[0];
        const vy = ph[2] - ph[0];
        const vz = py[2] - py[0];
        let nxx = uy * vz - uz * vy;
        let nyy = uz * vx - ux * vz;
        let nzz = ux * vy - uy * vx;
        const nl = Math.hypot(nxx, nyy, nzz) || 1;
        nxx /= nl;
        nyy /= nl;
        nzz /= nl;

        const cx = (px[0] + px[1] + px[2]) / 3;
        const cy = (py[0] + py[1] + py[2]) / 3;
        const ch = hSum / 3;
        const fadeAvg = fadeSum / 3;
        const steep = 1 - nyy;
        if (steep > 0.5) {
          cA.copy(cRock).lerp(cRockDark, Math.min(1, (steep - 0.5) * 2.6));
        } else if (steep > 0.32) {
          cA.copy(cSnowShadow).lerp(cRock, (steep - 0.32) / 0.18);
        } else {
          const nval = 0.9 * fine(cx, cy) + 0.7 * mid(cx, cy);
          if (nval >= 0) cA.copy(cSnowLow).lerp(cSnowHigh, Math.min(1, nval * 1.3));
          else cA.copy(cSnowLow).lerp(cSnowShadow, Math.min(1, -nval * 1.2));
        }
        // Hohe, flache Lagen wieder einschneien (Kuppen des Bergkranzes).
        if (ch > 110 && steep < 0.45) {
          cA.lerp(cSnowHigh, sstep(110, 200, ch) * (1 - steep / 0.45) * 0.8);
        }
        // Wegzonen zusätzlich zur Textur leicht eintönen – so bleibt die
        // Spur auch aus der Ferne (Mipmap) lesbar.
        if (fadeAvg < 0.999) cA.lerp(cPath, (1 - fadeAvg) * 0.45);
        const m = 0.93 + jrand() * 0.07;

        for (let k = 0; k < 3; k++) {
          positions[o3] = toWorldX(px[k]);
          positions[o3 + 1] = ph[k];
          positions[o3 + 2] = toWorldZ(py[k]);
          normals[o3] = nxx;
          normals[o3 + 1] = nyy;
          normals[o3 + 2] = nzz;
          colors[o3] = cA.r * m;
          colors[o3 + 1] = cA.g * m;
          colors[o3 + 2] = cA.b * m;
          o3 += 3;
          uvs[o2] = (px[k] - GX0) / GW;
          uvs[o2 + 1] = (py[k] - GY0) / GH;
          o2 += 2;
        }
      }
    }
  }

  const groundGeo = new THREE.BufferGeometry();
  groundGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  groundGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  groundGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  groundGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

  // Erster Bake rein prozedural; die Canvas bleibt referenziert, damit der
  // Muster-Bake nach dem Bildladen in dasselbe Objekt zeichnen kann.
  const groundCanvas = bakeGroundCanvas(polys, map.nodeList);
  const bakedTex = new THREE.CanvasTexture(groundCanvas);
  bakedTex.flipY = false; // UV-v läuft wie Karten-y nach Süden
  bakedTex.colorSpace = THREE.SRGBColorSpace;
  bakedTex.anisotropy = 4;

  // Masken-Textur für die Shader-Detail-Mischung: roh lesen (kein sRGB),
  // LinearFilter ohne Mipmaps reicht – die Maske ist niederfrequent.
  const maskTex = new THREE.CanvasTexture(bakeMaskCanvas(polys, map.nodeList));
  maskTex.flipY = false; // wie bakedTex: UV-v läuft mit Karten-y nach Süden
  maskTex.colorSpace = THREE.NoColorSpace;
  maskTex.generateMipmaps = false;
  maskTex.minFilter = THREE.LinearFilter;
  maskTex.magFilter = THREE.LinearFilter;

  // Detail-Uniforms: die Objekte werden per Referenz in den kompilierten
  // Shader übernommen – spätere value-Änderungen (Texturen, uHasDetail)
  // greifen ohne Neukompilierung. Repeat je Achse getrennt, damit die
  // Kacheln in Kartenpixeln quadratisch bleiben (GW ≠ GH).
  //
  // uDetailLift hebt jede Detailtextur um ca. den Kehrwert ihres mittleren
  // Grauwerts an: die Bilder liegen im Mittel deutlich unter Weiß, reines
  // Multiplizieren würde das gesamte Terrain abdunkeln. Schnee ist fast weiß
  // (×1.15), Fels ist mitteltonig (×1.6). Der Pfad liegt mit ×2.05 bewusst
  // ÜBER seinem Kehrwert (~1.7): Unter ihm dunkelt zusätzlich die
  // Makro-Abschattung der gebackenen Canvas – erst der höhere Faktor lässt
  // die festgetretene Struktur lesbar, ohne dass der Weg heller als der
  // umgebende Schnee wird (per Sichtprüfung in Nah- und Fernsicht kalibriert).
  const detailUniforms = {
    uSnowTex: { value: null },
    uPathTex: { value: null },
    uRockTex: { value: null },
    uMask: { value: maskTex },
    uSnowRep: { value: new THREE.Vector2(GW / DETAIL_SNOW_TILE, GH / DETAIL_SNOW_TILE) },
    uPathRep: { value: new THREE.Vector2(GW / DETAIL_PATH_TILE, GH / DETAIL_PATH_TILE) },
    uRockRep: { value: new THREE.Vector2(GW / DETAIL_ROCK_TILE, GH / DETAIL_ROCK_TILE) },
    uDetailLift: { value: new THREE.Vector3(1.15, 2.05, 1.6) },
    uHasDetail: { value: 0 },
  };

  const groundMat = new THREE.MeshStandardMaterial({
    map: bakedTex,
    vertexColors: true,
    flatShading: true,
    roughness: 0.95,
    metalness: 0,
  });
  // Detail-Maps in nativer Kachelauflösung über die gebackene Makro-Canvas
  // legen: die Canvas (1024×2048 über 880×1360 Kartenpixel) kann in der
  // Nahansicht keine feine Struktur tragen, der Shader sampelt die Kacheln
  // deshalb direkt. Gemischt wird über die Maske (R = Weg, G = Fels), das
  // Ergebnis multipliziert diffuseColor – bei uHasDetail = 0 exakt neutral,
  // der prozedurale Fallback-Look bleibt dann unverändert. vMapUv existiert,
  // weil map (die gebackene Canvas) immer gesetzt ist.
  groundMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, detailUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <map_pars_fragment>',
        [
          '#include <map_pars_fragment>',
          'uniform sampler2D uSnowTex;',
          'uniform sampler2D uPathTex;',
          'uniform sampler2D uRockTex;',
          'uniform sampler2D uMask;',
          'uniform vec2 uSnowRep;',
          'uniform vec2 uPathRep;',
          'uniform vec2 uRockRep;',
          'uniform vec3 uDetailLift;',
          'uniform float uHasDetail;',
        ].join('\n')
      )
      .replace(
        '#include <map_fragment>',
        [
          '#include <map_fragment>',
          '#ifdef USE_MAP',
          '{',
          '  vec4 dMask = texture2D( uMask, vMapUv );',
          // Zweitabtastung mit ~×0.37-Maßstab bricht die Kachelwiederholung
          // von Schnee und Fels; der Pfad ist schmal, dort reicht eine Probe.
          '  vec3 dSnow = mix(',
          '    texture2D( uSnowTex, vMapUv * uSnowRep ).rgb,',
          '    texture2D( uSnowTex, vMapUv * uSnowRep * 0.37 + vec2( 0.13, 0.41 ) ).rgb,',
          '    0.5 ) * uDetailLift.x;',
          '  vec3 dPath = texture2D( uPathTex, vMapUv * uPathRep ).rgb * uDetailLift.y;',
          '  vec3 dRock = mix(',
          '    texture2D( uRockTex, vMapUv * uRockRep ).rgb,',
          '    texture2D( uRockTex, vMapUv * uRockRep * 0.37 + vec2( 0.71, 0.23 ) ).rgb,',
          '    0.5 ) * uDetailLift.z;',
          '  vec3 detail = mix( dSnow, dPath, dMask.r );',
          '  detail = mix( detail, dRock, dMask.g );',
          '  diffuseColor.rgb *= mix( vec3( 1.0 ), detail, uHasDetail );',
          '}',
          '#endif',
        ].join('\n')
      );
  };
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.receiveShadow = true;
  group.add(ground);

  // ---------------------------------------------- Dekoration
  // Deterministische Streuung per Rückweisung: nie auf Wegen (> minPath zur
  // Polylinie), nie an Wegpunkten (> minNode), nicht im See, nicht auf zu
  // steilen oder zu hohen Lagen. valleyChance dünnt den Talboden aus, sodass
  // die Bestände an den Flanken dicht stehen.
  function scatterSpots({ seed, target, maxTries, minPath, minNode, maxH, maxSlope, valleyChance }) {
    const rand = seededRand(seed);
    const spots = [];
    let tries = 0;
    while (spots.length < target && tries++ < maxTries) {
      const x = GX0 + 60 + rand() * (GW - 120);
      const y = GY0 + 60 + rand() * (GH - 120);
      if (sampleField(pdF, x, y) < minPath || sampleField(ndF, x, y) < minNode) continue;
      if (pond && Math.hypot(x - pond.x, y - pond.y) < pond.r + 14) continue;
      const h = heightAt(x, y);
      if (h > maxH) continue;
      const gx = (heightAt(x + 4, y) - heightAt(x - 4, y)) / 8;
      const gy = (heightAt(x, y + 4) - heightAt(x, y - 4)) / 8;
      if (Math.hypot(gx, gy) > maxSlope) continue;
      if (rectDist(x, y) < 6 && rand() > valleyChance) continue;
      spots.push({ x, y, h, r1: rand(), r2: rand(), r3: rand(), r4: rand(), r5: rand() });
    }
    return spots;
  }

  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();

  // Kiefern: dichte Bestände an den Flanken, verstreute Bäume im Tal.
  const treeSpots = scatterSpots({
    seed: 4242,
    target: 380,
    maxTries: 60000,
    minPath: 34,
    minNode: 46,
    maxH: 135,
    maxSlope: 1.05,
    valleyChance: 0.28,
  });
  const crownGeo = makeCrownGeometry();
  const trunkGeo = new THREE.CylinderGeometry(0.4, 0.66, 3.6, 5, 1, true);
  trunkGeo.translate(0, 1.8, 0);
  const crownMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: PALETTE.trunk, flatShading: true, roughness: 0.95 });
  const crowns = new THREE.InstancedMesh(crownGeo, crownMat, treeSpots.length);
  const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeSpots.length);
  treeSpots.forEach((p, i) => {
    const s = 0.8 + p.r1 * 0.8;
    dummy.position.set(toWorldX(p.x), p.h - 0.3, toWorldZ(p.y));
    dummy.rotation.set((p.r2 - 0.5) * 0.1, p.r3 * Math.PI * 2, (p.r4 - 0.5) * 0.1);
    dummy.scale.set(s, s * (0.85 + p.r5 * 0.5), s);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
    trunks.setMatrixAt(i, dummy.matrix);
    const b = 0.8 + p.r2 * 0.35;
    tint.setRGB(b * (0.95 + p.r4 * 0.1), b, b * (0.95 + p.r5 * 0.1));
    crowns.setColorAt(i, tint);
  });
  crowns.castShadow = true;
  trunks.castShadow = true;
  // Bäume stehen im ganzen Tal verteilt – Einzelkulling lohnt nicht.
  crowns.frustumCulled = false;
  trunks.frustumCulled = false;
  group.add(crowns, trunks);

  // Felsbrocken: auch an den steileren Flanken und zwischen den Graten.
  const rockSpots = scatterSpots({
    seed: 5151,
    target: 88,
    maxTries: 20000,
    minPath: 32,
    minNode: 44,
    maxH: 175,
    maxSlope: 1.5,
    valleyChance: 0.4,
  });
  const rockGeo = makeRockGeometry();
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
  const rocks = new THREE.InstancedMesh(rockGeo, rockMat, rockSpots.length);
  rockSpots.forEach((p, i) => {
    dummy.position.set(toWorldX(p.x), p.h - 0.6, toWorldZ(p.y));
    dummy.rotation.set(p.r2 * Math.PI, p.r3 * Math.PI * 2, p.r4 * Math.PI);
    dummy.scale.set(0.8 + p.r1 * 2.0, 0.6 + p.r5 * 1.4, 0.8 + p.r4 * 2.0);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    tint.setScalar(0.75 + p.r5 * 0.4);
    rocks.setColorAt(i, tint);
  });
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.frustumCulled = false;
  group.add(rocks);

  // Eisfläche des Bergsees: flach, leicht spiegelnd, knapp unter dem Wannenrand.
  let iceGeo = null;
  let iceMat = null;
  if (pond) {
    iceGeo = new THREE.CircleGeometry(pond.r, 16);
    iceGeo.rotateX(-Math.PI / 2);
    iceMat = new THREE.MeshStandardMaterial({ color: PALETTE.ice, roughness: 0.18, metalness: 0.3 });
    const ice = new THREE.Mesh(iceGeo, iceMat);
    ice.position.set(toWorldX(pond.x), heightAt(pond.x, pond.y) + pond.depth - 1.4, toWorldZ(pond.y));
    ice.receiveShadow = true;
    group.add(ice);
  }

  // ---------------------------------------------- optionale Detailtexturen
  // textures.js nutzt import.meta.glob und existiert nur unter Vite – deshalb
  // dynamisch importiert und jeder Fehlschlag bewusst geschluckt: die Bilder
  // sind rein kosmetisch, der prozedurale Look steht für sich.
  let disposed = false;
  import('./textures.js')
    .then(({ getTexture, loadImage }) => {
      if (disposed) return;
      // Felsbrocken: die Kacheltextur liegt über den sphärisch projizierten
      // Ikosaeder-UVs. Die Projektion verzerrt zwar an Polen und Naht, aber
      // die Brocken sind klein, verbeult und flat-shaded – übrig bleibt eine
      // dezente Oberflächenvarianz über den Vertex-Farben, keine ablesbare
      // Verzerrung. Deshalb bleibt die Zuweisung.
      const rockTex = getTexture('rock');
      if (rockTex) {
        rockMat.map = rockTex;
        rockMat.needsUpdate = true;
      }
      // Boden: sobald die gemalten Kacheln geladen sind, wird die Boden-Canvas
      // EINMAL neu gebacken – dieselbe Canvas, Textur und Material bleiben,
      // nur der Inhalt wechselt von prozedural zu bemustert.
      return Promise.all([loadImage('snow'), loadImage('path'), loadImage('rock')]).then(([snowImg, pathImg, rockImg]) => {
        if (disposed || (!snowImg && !pathImg && !rockImg)) return;
        bakeGroundCanvas(polys, map.nodeList, { snowImg, pathImg, rockImg }, groundCanvas);
        bakedTex.needsUpdate = true;
        // Detail-Maps erst jetzt aktivieren: alle drei Bilder sind fertig
        // geladen, die Texturen entstehen direkt daraus – der Shader sampelt
        // also nie ungeladenes Schwarz. Fehlt eines der Bilder, bleibt
        // uHasDetail = 0 und nur der Makro-Bake wirkt.
        if (snowImg && pathImg && rockImg) {
          detailUniforms.uSnowTex.value = makeDetailTexture(snowImg);
          detailUniforms.uPathTex.value = makeDetailTexture(pathImg);
          detailUniforms.uRockTex.value = makeDetailTexture(rockImg);
          detailUniforms.uHasDetail.value = 1;
        }
      });
    })
    .catch(() => {});

  function dispose() {
    disposed = true;
    groundGeo.dispose();
    groundMat.dispose();
    bakedTex.dispose();
    maskTex.dispose();
    // Die Detail-Texturen gehören diesem Modul (aus HTMLImageElements
    // erzeugt, nicht aus dem geteilten textures.js-Cache).
    for (const key of ['uSnowTex', 'uPathTex', 'uRockTex']) {
      if (detailUniforms[key].value) detailUniforms[key].value.dispose();
    }
    crownGeo.dispose();
    crownMat.dispose();
    trunkGeo.dispose();
    trunkMat.dispose();
    crowns.dispose();
    trunks.dispose();
    rockGeo.dispose();
    rockMat.dispose();
    rocks.dispose();
    if (iceGeo) {
      iceGeo.dispose();
      iceMat.dispose();
    }
    // Texturen aus textures.js gehören dem dortigen geteilten Cache und
    // bleiben unangetastet.
  }

  return { group, heightAt, dispose };
}
