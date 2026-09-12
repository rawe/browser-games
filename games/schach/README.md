# ♛ Schach

Schach im Browser – **zu zweit am selben Gerät** oder gegen einen
Computergegner mit drei Spielstärken. Alles läuft clientseitig: Regeln,
Notation und Suche stecken im Spiel selbst, es gibt keinen Server und keine
Bilddateien für die Figuren.

## Spielen

`games/schach/index.html` – oder über die Übersicht.

| | |
| --- | --- |
| Figur wählen | antippen – oder gleich mit dem Finger ziehen |
| Zug ausführen | Zielfeld antippen bzw. Figur dort loslassen |
| Zug zurück | `↩ Zurück` oder <kbd>U</kbd> |
| Brett drehen | `⇅ Drehen` oder <kbd>F</kbd> |
| Menü | `☰` oder <kbd>Esc</kbd> |
| Zugliste | `≡ Züge` (im Querformat steht sie dauerhaft neben dem Brett) |
| Ohne Zeigegerät | Pfeiltasten bewegen den Fokus, <kbd>Enter</kbd> wählt |

### Zwei Spieler am selben Gerät

Der Zweispielermodus ist kein Nebenschauplatz, sondern der Normalfall: Wer am
Zug ist, dessen Leiste trägt einen pulsierenden Punkt, und auf Wunsch **dreht
sich das Brett nach jedem Zug** zur Seite, die dran ist – sonst spielt einer
der beiden die ganze Partie über Kopf. Die Drehung läuft als Kippbewegung, erst
nachdem die gezogene Figur steht.

Dazu wahlweise eine Schachuhr (5 Minuten, 3 + 2 oder 10 + 5) und im Menü
„Remis vereinbaren“ und „Aufgeben“.

### Gegen den Computer

| Stufe | Verhalten |
| --- | --- |
| Anfänger | Tiefe 2, deutliches Rauschen in der Bewertung – lässt sichtbar etwas liegen |
| Klubspieler | Tiefe 4 bei knapp einer Sekunde, straft grobe Fehler ab |
| Meister | Bis zu zwei Sekunden iterative Vertiefung, verzeiht wenig |

Die Suche läuft in einem **Web Worker**, damit das Brett währenddessen flüssig
bleibt. Gibt es keinen Worker, rechnet dieselbe Suche im Hauptfaden weiter –
dann ruckelt es kurz, gespielt wird trotzdem.

### Auf Handy und Tablet

Das Brett ist quadratisch und nimmt sich, was Breite **und** Resthöhe hergeben;
`env(safe-area-inset-*)` hält Leisten und Knöpfe aus Notch und Home-Leiste
heraus. Scrollen, Zoomen und Doppeltipp-Zoom sind auf dem Brett abgeschaltet,
sonst rutscht bei jedem zweiten Zug die Seite weg. Ab Tabletbreite im
Querformat wandert die Zugliste dauerhaft neben das Brett, das dann die volle
Höhe nutzt.

Tippen und Ziehen funktionieren nebeneinander: Unterschieden wird an der
Wegstrecke, nicht an der Eingabeart – wer mit der Maus tippen will, darf das.

## Aufbau

```
engine/     Regeln, DOM-frei und ohne Kenntnis vom Rest
  board.js      0x88-Brett, Figurencodes, FEN
  moves.js      Zuggenerierung, Angriffserkennung, Zug ausführen/zurücknehmen
  rules.js      Matt, Patt und die vier Remisgründe
  notation.js   Standard-Algebraische Notation (SAN)
game.js     Die Partie: Zugliste, Stand, Materialbilanz, Speicherformat
ai/         Bewertung, Suche und der Worker, in dem sie läuft
gfx/        Geometrie, Vektorfiguren, Brett-Renderer
ui/         Bildschirme, Anzeige, Umwandlungsdialog, Titelbild
sim/        Prüfläufe ohne Browser
```

Die Figuren sind **Vektorpfade**, keine Bilder und keine Schriftzeichen: Sie
bleiben auf jeder Pixeldichte scharf, skalieren stufenlos mit der Feldgröße und
sehen im Umwandlungsdialog, in der Schlagliste und auf dem Titelbild genauso
aus wie auf dem Brett.

Das Brett liegt in einer eigenen, zwischengespeicherten Ebene, die sich nur bei
Größenänderung neu aufbaut – Holzmaserung und Koordinaten in jedem Bild neu zu
rechnen wäre auf dem Handy verschwendete Zeit.

## Regeln im Detail

Vollständig umgesetzt sind Rochade (beidseitig, samt aller Bedingungen),
En passant, Umwandlung in alle vier Figuren, Schachmatt, Patt, die
50-Züge-Regel, die dreifache Stellungswiederholung und materialarmes Remis
nach Artikel 5.2.2 (König gegen König, gegen einen Läufer, gegen einen
Springer und Läufer gegen Läufer auf gleicher Feldfarbe).

## Prüfen

```bash
npm run check:schach
```

Der Prüflauf rechnet die Zuggenerierung gegen die veröffentlichten
**Perft-Zahlen** von fünf Standardstellungen – der Test, an dem sich jeder
Zuggenerator messen lassen muss – und nimmt Notation, Partieende,
Materialbilanz, Bewertung und Suche ab. Zum Schluss spielt die Engine eine
Partie gegen sich selbst: der schärfste Fall, weil jede Stellung darin von ihr
selbst erzeugt wurde und in keiner Testliste steht.

## Stellungen teilen und nachstellen

`index.html?stellung=<FEN>` beginnt eine Partie zu zweit aus einer gesetzten
Stellung – zum Nachspielen einer Partie und beim Bauen der schnellste Weg,
Umwandlung, Matt oder ein Endspiel zu prüfen:

```
games/schach/index.html?stellung=4k3/P7/8/8/8/8/8/4K3 w - - 0 1
```
