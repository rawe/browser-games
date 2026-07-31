// Farbbasis der Spielgrafik.
//
// Alle Werte sind am Titelbild (`assets/title-banner.webp`) gemessen, nicht
// geschätzt: Ausschnitte wurden pixelweise ausgezählt und die häufigsten Töne
// je Bildbereich übernommen. Wer die Optik verschiebt, sollte hier ansetzen –
// Terrain, Fahrbahn und Fahrzeuge lesen ausschließlich aus dieser Datei.
//
// Zwei Abweichungen des alten Standes waren die auffälligsten: Das Gras war
// bläulich-grün (#3f7d2e, Farbton ~110°), im Bild ist es olivgrün (~75°). Und
// der Asphalt war mit #43474d deutlich zu hell und zu blau – gemessen sind es
// fast neutrale #2b2d2d.

/**
 * Grasnarbe: dichtes Schachbrett aus diesen Tönen, 4-px-Zellen.
 * Die Helligkeit ist gegen den Teaser abgeglichen – dessen reine Grasflächen
 * mitteln sich zu #3e5716. Ein erster Entwurf lag bei #47641b und wirkte
 * dadurch grell; die Töne sind entsprechend abgedunkelt.
 */
export const GRASS = ['#244609', '#2d520d', '#365b0c', '#3f690f', '#497712'];

/** Seltene Lichtpunkte und trockene Halme zwischen der Narbe. */
export const GRASS_ACCENT = ['#5d8816', '#6c9519'];
export const GRASS_DRY = ['#9e9018', '#ad9d16'];

/** Erdflecken: organische Nester mit dunklerem Kern. */
export const DIRT = ['#6b4a1e', '#7a5828', '#54381a'];
export const DIRT_CORE = '#3d2810';

/** Asphalt: fast neutrales Dunkelgrau, in unruhigen Flecken gemischt. */
export const ASPHALT = ['#2b2d2d', '#323232', '#252727'];

/** Randstein: rot/weiß im Wechsel, jeder Block oben hell, unten abgedunkelt. */
export const KERB_RED = '#d8281a';
export const KERB_RED_DARK = '#a81c12';
export const KERB_WHITE = '#ded6c8';
export const KERB_WHITE_DARK = '#b0a89a';

/** Schmaler brauner Saum zwischen Randstein und Fahrbahn (Gummiabrieb/Erde). */
export const KERB_EDGE = '#6b4a2a';

/** Mittellinie: kein sauberes Weiß, sondern vergrautes, fleckiges Beige. */
export const LANE_LINE = ['#8a8578', '#a8a294', '#6a6660'];

/** Start- und Zielfeld. */
export const CHECKER_LIGHT = '#e8e4dc';
export const CHECKER_DARK = '#16181a';

/* ---------------- Fahrzeuge ---------------- */

/** Umriss rund um die Karosserie – im Bild ein sehr dunkles Blauschwarz. */
export const CAR_OUTLINE = '#05070d';

/** Reifen samt aufgehelltem Profilstrich. */
export const TYRE = '#131417';
export const TYRE_TREAD = '#4c4d52';

/** Kanzel: helles Blauweiß, silberner Rahmenfuß, weißer Glanzpunkt. */
export const CANOPY = '#b9dae8';
export const CANOPY_LIGHT = '#dcf0f7';
export const CANOPY_GLINT = '#f4fcfe';
export const CANOPY_FRAME = '#9aa8ac';

/**
 * Öllache: fast schwarzer Körper mit schmalem Ölfilm-Saum. Der Saum läuft im
 * Titelbild nur über Blau, Cyan und Magenta – kein Grün, kein Gelb.
 */
export const OIL_BODY = '#060912';
export const OIL_BODY_EDGE = '#111726';
export const OIL_FILM = ['#1f5a9e', '#2f9ec8', '#8a4a8c', '#b05a7a'];
export const OIL_GLINT = '#dfeaf2';

/** Auspuffflamme: außen orange, innen gelb, Kern fast weiß. */
export const FLAME_OUTER = '#f2571c';
export const FLAME_MID = '#ffb01e';
export const FLAME_CORE = '#fff0c0';

/**
 * Lackfarben der vier Wagen, direkt aus dem Titelbild. Deutlich gesättigter
 * als die vorherigen Pastelltöne, sonst fällt das Feld gegen die Umgebung ab.
 */
export const CAR_PINK = '#f52d62';
export const CAR_CYAN = '#01bce9';
export const CAR_YELLOW = '#fbb501';
export const CAR_PURPLE = '#8c46f4';
