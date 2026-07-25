# Einheiten-Grafiken für Alterac – Auftrag an ChatGPT

Alterac zeichnet Einheiten bisher als farbigen Kreis mit römischer Ziffer
(`drawToken` in `render.js`). Dieses Dokument enthält den fertigen Auftrag an
ChatGPT (Bildgenerierung + Python), der daraus **acht runde Porträt-Medaillons**
macht – leicht, mittel, schwer und der beschworene Verbündete, je einmal für
Sturmlanze und Frostwolf.

## Warum Medaillons und nicht ganze Figuren

Ein Token ist im Spiel **20 bis 38 Pixel** groß (`radius` 10 / 12,5 / 15 / 19 in
`config.js`, Kartenraum 480×960). Eine Ganzkörperfigur ist in einem 30-px-Kreis
Matsch. Ein Bruststück – Kopf, Schultern, Waffe – bleibt lesbar. Deshalb:

- **Das Spiel behält den Kreis.** Fraktionsfarbe, Ring, Schlagschatten, HP-Balken,
  Kampfring und Verbündeten-Aura zeichnet weiterhin der Renderer. Die Grafik ist
  nur die Füllung *im* Kreis.
- **Die Grafik hat einen Alphakanal und keinen eigenen Hintergrund.** Der
  Fraktions-Farbverlauf scheint hinter der Figur durch – so bleibt Blau gegen Rot
  auf einen Blick unterscheidbar, auch wenn die Figuren einander ähneln.
- **Alle Zellen sind gleich groß (128×128).** Der Größenunterschied zwischen
  leicht und schwer kommt weiter aus `def.radius`, nicht aus der Grafik. 128 px
  reicht mit Reserve: Der größte Token (Verbündeter, 38 px) belegt bei maximaler
  Kartenbreite (540 css px) und dpr 2,5 rund 107 Gerätepixel.

Zwei Bildgenerierungen genügen: ein Blatt je Fraktion mit vier Figuren
nebeneinander. Das ist nicht nur billiger, es erzwingt auch einheitlichen Stil,
gleiches Licht und gleiche Kopfhöhe innerhalb einer Fraktion – bei acht
Einzelbildern wäre genau das der Schwachpunkt.

## Ablauf

1. Neue ChatGPT-Unterhaltung mit Bildgenerierung **und** Python-Werkzeug.
2. Den Block unten vollständig kopieren und abschicken.
3. Das gelieferte ZIP im Repo-Wurzelverzeichnis entpacken – die Pfade darin
   passen bereits auf `games/alterac/assets/units/`.
4. Renderer anbinden (siehe „Danach" am Ende).

---

## Der Prompt (alles im folgenden Block kopieren)

````text
Du bist Game-Artist und Tool-Programmierer für ein 2D-Browser-Strategiespiel.
Ich brauche acht Einheiten-Porträts als fertiges, eingepacktes Asset-Paket.
Arbeite die Aufgabe vollständig ab und liefere am Ende genau ein ZIP.

## Was das Spiel damit macht (bestimmt jede Designentscheidung)

Jede Einheit ist auf einer Karte ein Kreis-Token von 20 bis 38 Bildschirmpixeln.
Das Spiel zeichnet den Kreis selbst: Fraktionsfarbverlauf, dunkler Außenring,
Schlagschatten, Lebensbalken. Deine Grafik wird in diesen Kreis hineinmaskiert.
Lesbarkeit bei 30 Pixeln ist das oberste Kriterium – wichtiger als jedes Detail.

Die Fraktionsfarben, auf denen deine Figuren liegen werden:
- Sturmlanze (blau): Verlauf #5b9cff nach #2c5aa8
- Frostwolf (rot):   Verlauf #ff6b5e nach #a63a31

## Harte technische Vorgaben

- Echter Alphakanal. Kein Hintergrund, keine Farbfläche, keine Kachel, kein
  Rahmen, kein gezeichneter Kreis, kein Schlagschatten, kein Bodenschatten,
  kein Glühen hinter der Figur. Das Spiel liefert all das selbst; gebackene
  Varianten davon zerstören den Kreis.
- Kein Text, keine Zahlen, keine Buchstaben, keine Schriftzeichen, keine Logos,
  keine Wasserzeichen, keine Signatur.
- Bruststück: Kopf, Schultern, Oberkörperansatz, Waffe angeschnitten. Keine
  ganzen Figuren, keine Beine, keine Bodenlinie.
- Leichte Aufsicht, Kamera etwa 20 Grad über Augenhöhe (die Karte ist von oben
  gesehen). Gesicht frontal bis leicht zur Seite gedreht.
- Kreisbeschnitt einplanen: Alles Wesentliche – Kopf, Waffenblatt, Wappenakzent –
  liegt innerhalb eines gedachten Kreises, der 92 % der Zellbreite füllt. Die
  vier Ecken dürfen leer bleiben und werden ohnehin weggeschnitten.
- Silhouette vor Detail: kräftige dunkle Außenkontur, große klare Formen,
  höchstens drei Materialflächen je Figur. Keine feinen Linien, keine kleinteiligen
  Muster, keine Nieten-Parade, keine Ziselierung – all das wird bei 30 px zu Rauschen.
- Muss auf blauem UND rotem Untergrund stehen: dunkle Kontur nach außen, dazu ein
  helles, kaltes Streiflicht (Rimlight) von oben links auf Helm- und Schulterkante.
- Farbigkeit: gedämpfte Winterpalette – Stahl, Eisen, Leder, Fell, Knochen, Schnee.
  Die Fraktionsfarbe erscheint NUR als kleiner Akzent (Wappenband, Umhangzipfel,
  Federbusch), niemals großflächig. Färbe die Figuren NICHT durchgehend blau bzw.
  rot ein – die Farbe kommt aus dem Kreis darunter, und eine blaue Figur auf
  blauem Grund verschwindet.
- Stil: handgemaltes Fantasy-Einheitenporträt, wie die Kartenillustration eines
  Strategiespiels. Kein Fotorealismus, kein Anime, kein 3D-Render-Look, keine
  Pixel-Art, kein Comic-Cel-Shading, keine Chibi-Proportionen.

## Schritt 1 – Blatt A: Sturmlanze

Erzeuge EIN Bild, 1536×1024, transparenter Hintergrund, mit VIER Bruststücken
nebeneinander in einer Reihe. Zwischen den Figuren mindestens 80 Pixel völlig
leerer, transparenter Abstand; keine Überschneidung, keine Berührung, nichts
ragt in den Nachbarn. Alle vier gleich hoch gezeichnet, gleiche Kopf- und
Schulterlinie – der Größenunterschied der Einheiten wird im Spiel geregelt, hier
zählt nur die Bauweise.

Fraktion: Sturmlanze, ein Gebirgsheer aus Zwergen und Menschen. Stahl, Silber,
gestepptes Leder, ein Hauch Blau als Akzent.

1. Leicht – Späher: schlank, leichte Lederrüstung, Kapuze über kurzem Helm,
   Kurzschwert schräg vor der Brust. Wendig, schmale Schultern.
2. Mittel – Gardist: Kettenhemd mit Brustplatte, offener Helm mit Nasensteg,
   Langschwert geschultert. Ausgewogene, breite Statur.
3. Schwer – Sturmritter: massive Plattenrüstung, geschlossener Helm mit schmalem
   Sehschlitz, sehr breite Schulterplatten, angeschnittener Turmschild.
   Die Silhouette muss auch ohne Farbe sofort als „schwer" lesbar sein.
4. Verbündeter – Ivus der Waldlord: uralter Baumriese, Rindenhaut, Moos und
   Flechten, ein Geweih aus Ästen, schwach grün glimmende Augen. Kopf und
   Schultern füllen den Rahmen massiger als bei den drei anderen – er ist keine
   Person, sondern eine Erscheinung.

## Schritt 2 – Blatt B: Frostwolf

Erzeuge ein zweites Bild mit denselben technischen Vorgaben. Nimm Blatt A als
Stilreferenz: identische Machart, identisches Licht, identische Kopfhöhe,
identische Konturstärke. Die beiden Blätter müssen wie von derselben Hand am
selben Tag aussehen.

Fraktion: Frostwolf, ein Orc-Klan aus dem Winterhochland. Fell, Knochen, grobes
gehämmertes Eisen, Wolfsmotive, ein Hauch Rot als Akzent.

5. Leicht – Wolfsläufer: schlanker Orc-Späher, Fellkapuze mit Wolfsschädel als
   Kopfschmuck, zwei kurze Handäxte.
6. Mittel – Klanaxt: Orc-Krieger, genietete Lederrüstung mit aufgesetzten
   Eisenplatten, grobe Streitaxt geschultert, Kriegsbemalung im Gesicht.
7. Schwer – Frostwolf-Berserker: sehr massiger Orc, Fellmantel über Eisenpanzer,
   Hörnerhelm, zweihändiger Kriegshammer angeschnitten.
8. Verbündeter – Lokholar der Eislord: ein Eiselementar-Riese, Körper aus
   geborstenem, kantigem Eis, Frostnebel um die Schultern, blauweiß leuchtende
   Augen, Eiskrone. Das kalte Blauweiß ist ausdrücklich gewollt und hebt ihn
   vom roten Medaillon ab – halte hier die Kontur besonders dunkel.

## Schritt 3 – Zuschnitt und Atlas (Python)

Verarbeite die beiden erzeugten Bilder mit deinem Python-Werkzeug. Findest du
die Bilddateien nicht im Dateisystem, sag es mir sofort – dann lade ich sie hoch.
Rate nicht und male nichts nach.

1. Beide Blätter als RGBA laden.
2. Je Blatt in vier Figuren zerlegen: Alpha > 8 als Maske nehmen, spaltenweise
   aufsummieren, die zusammenhängenden Nullbereiche als Trenner benutzen. Es
   müssen genau vier nichtleere Bänder herauskommen; kommt eine andere Zahl
   heraus, melde es und erzeuge das Blatt neu, statt zu improvisieren.
3. Je Figur die Alpha-Bounding-Box bestimmen, um deren Mittelpunkt auf ein
   Quadrat aufziehen, 6 % Rand zugeben und mit LANCZOS auf exakt 128×128
   skalieren. Alphawerte unter 12 auf 0 setzen (Ausfransung vom Freistellen).
4. Atlas 512×256 bauen, vier Spalten mal zwei Reihen, Zellgröße 128:
   Reihe 0 = Sturmlanze, Reihe 1 = Frostwolf;
   Spalte 0 = leicht, 1 = mittel, 2 = schwer, 3 = Verbündeter.
5. Speichern als `units.webp` (verlustfrei, mit Alpha) und zusätzlich
   `units.png` als Rückfalllösung.
6. `units.json` schreiben, exakt in dieser Form:

```json
{
  "image": "units.webp",
  "cell": 128,
  "frames": {
    "blue.light":  { "x": 0,   "y": 0,   "w": 128, "h": 128 },
    "blue.medium": { "x": 128, "y": 0,   "w": 128, "h": 128 },
    "blue.heavy":  { "x": 256, "y": 0,   "w": 128, "h": 128 },
    "blue.ally":   { "x": 384, "y": 0,   "w": 128, "h": 128 },
    "red.light":   { "x": 0,   "y": 128, "w": 128, "h": 128 },
    "red.medium":  { "x": 128, "y": 128, "w": 128, "h": 128 },
    "red.heavy":   { "x": 256, "y": 128, "w": 128, "h": 128 },
    "red.ally":    { "x": 384, "y": 128, "w": 128, "h": 128 }
  }
}
```

## Schritt 4 – Prüfbild

Baue mit Python ein Kontrollbild `vorschau.png`: Zeichne jede der acht Zellen
zweimal – einmal 30 Pixel groß, einmal 96 Pixel groß – jeweils kreisrund
maskiert auf dem Fraktions-Farbverlauf (blau #5b9cff→#2c5aa8, rot
#ff6b5e→#a63a31) mit dunklem Außenring, auf dunkelblauem Hintergrund (#1a2231).
Zeig mir dieses Bild in der Antwort. Es ist die eigentliche Abnahme: Wenn eine
Figur in der 30-px-Reihe zu Brei wird, ist sie durchgefallen.

## Schritt 5 – Selbstprüfung

Prüfe vor dem Einpacken und berichte jeden Punkt mit Ja/Nein:

- Jede der acht Zellen enthält eine Figur (Alphadeckung zwischen 35 % und 90 %).
- Kein Bildrand ist flächig undurchsichtig – die Ecken sind transparent.
- Kein Text, keine Zahl, kein Rahmen, kein gebackener Kreis oder Schatten.
- Die drei Sturmlanze-Kämpfer sind in der 30-px-Reihe voneinander unterscheidbar,
  ebenso die drei Frostwolf-Kämpfer.
- Blatt A und Blatt B sehen nach einem Stil aus.

Fällt ein Punkt durch, erzeuge NUR die betroffene Figur neu (einzeln, 1024×1024,
mit dem jeweiligen Blatt als Stilreferenz), setze sie in den Atlas und prüfe
erneut. Die übrigen Zellen bleiben unangetastet.

## Schritt 6 – Lieferung

Ein ZIP `alterac-einheiten.zip` mit genau dieser Struktur:

```
games/alterac/assets/units/units.webp
games/alterac/assets/units/units.png
games/alterac/assets/units/units.json
_quellen/blatt-sturmlanze.png
_quellen/blatt-frostwolf.png
_quellen/vorschau.png
```

Die Pfade sind verbindlich – das ZIP wird direkt über ein Repository entpackt.
`_quellen/` sind die Rohdaten für spätere Nachbesserungen.

Gib mir den ZIP-Download, das Prüfbild und die Ergebnisse der Selbstprüfung.
Keine Zwischenfragen, keine Stilvorschläge zur Auswahl – arbeite durch.
````

---

## Abnahme, wenn das Paket da ist

- `vorschau.png` in der 30-px-Reihe ansehen: Sind leicht / mittel / schwer je
  Fraktion auseinanderzuhalten? Alles andere ist zweitrangig.
- `units.webp` in einem Betrachter mit Schachbrettmuster prüfen: Ecken müssen
  transparent sein, kein Kreis, kein Schatten mitgebacken.
- Dateigröße: Ein 512×256-Atlas mit Alpha sollte deutlich unter 200 kB liegen.

## Danach: Anbindung im Spiel

Noch offen – das ist der Schritt, den ich übernehme, sobald die Grafiken da sind:

- Atlas laden über `new URL('./assets/units/units.webp', import.meta.url)`, damit
  der Pfad den Vite-Build mit `base: './'` überlebt (siehe `CLAUDE.md`).
- `drawToken` (`render.js`) erweitert: Kreis wie bisher füllen, dann die Zelle
  kreisförmig maskiert darüber zeichnen. Ring, Schatten, HP-Balken, Kampfring
  und Verbündeten-Aura bleiben unverändert.
- Die römische Ziffer wandert aus der Kreismitte in ein kleines Abzeichen an den
  unteren Rand des Tokens – sonst liegt sie im Gesicht.
- Rückfall: Fehlt der Atlas oder lädt er nicht, zeichnet der Renderer den
  bisherigen Kreis mit Ziffer. Das Spiel darf nie an einer Grafik hängen.
- Die Zellen taugen zusätzlich als Bildchen in der Rekrutierungsliste des
  Planungspanels, wo heute die Emoji `🗡 ⚔ 🛡` stehen (`planner.js`, `main.js`).
