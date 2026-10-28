# ⚓ Schiffe versenken

Die Seeschlacht im Browser – **zu zweit an einem Handy oder Tablet** oder
gegen den Computer in drei Spielstärken. Alles läuft clientseitig; Schiffe,
Wasser, Explosionen und Klang sind gezeichnet bzw. synthetisiert, es gibt
außer dem Kartenbild keine einzige Bild- oder Tondatei.

## Spielen

`games/schiffe-versenken/index.html` – oder über die Übersicht.

| | |
| --- | --- |
| Schiff aufstellen | aus dem Dock aufs Meer ziehen – oder im Dock antippen, dann ein Feld |
| Schiff drehen | auf dem Meer antippen (dreht um das angetippte Feld) oder `⟳ Drehen` |
| Schiff entfernen | vom Meer herunterziehen |
| Zielen | Feld im Feindmeer antippen, Finger darf übers Raster gleiten |
| Feuern | dasselbe Feld nochmal antippen oder `🔥 Feuer!` – mit der Maus reicht ein Klick |
| Tastatur | Pfeiltasten zielen, <kbd>Enter</kbd> feuert, <kbd>Esc</kbd> öffnet das Menü |

### Zu zweit an einem Gerät

Nach jedem Zug kommt ein **undurchsichtiger Übergabebildschirm** („Gib das
Gerät an …“), der beide Meere verdeckt, bis der Nächste „Ich bin bereit“
tippt. Danach sieht er zuerst auf der eigenen Flotte, **wohin der andere
geschossen hat** – die Schüsse werden kurz nachgespielt (Tippen überspringt)
– und bekommt dann das Feindmeer groß zum Zielen. Bei einer Revanche beginnt
der andere.

### Gegen den Computer

| Stufe | Verhalten | Ø Schüsse* |
| --- | --- | --- |
| Leicht | schießt meist zufällig, bleibt nur manchmal an Treffern dran | ≈ 61 |
| Mittel | verfolgt Treffer konsequent, sucht im Schachbrettmuster | ≈ 44 |
| Schwer | Wahrscheinlichkeitsdichte über alle noch möglichen Schiffslagen | ≈ 39 |

\* klassische Flotte mit Abstandsregel, aus `npm run check:schiffe`.

Der Computer sieht nur, was ein Mensch auch sähe: das eigene Schussbild und
welche Schiffe versenkt sind (`publicView`).

### Regeln zur Wahl

- **Flotte:** Klassisch (5 Schiffe: 5, 4, 3, 3, 2) oder Große Flotte
  (10 Schiffe wie auf dem Karopapier: 5, 4, 4, 3, 3, 3, 2, 2, 2, 2).
- **Abstand:** Schiffe dürfen sich nicht berühren, auch nicht über Eck. Rund
  um versenkte Schiffe wird das Wasser dann automatisch markiert.
- **Treffer = nochmal:** Wer trifft, schießt gleich weiter.

### Auf Handy und Tablet

Im Hochformat liegt das große Meer oben, darunter das kleine Meer neben der
Flottenübersicht und dem Feuerknopf; ab einem Seitenverhältnis von 5:4 (Tablet
oder Handy quer) wandert die Bedienung rechts neben das Meer. Die Meere sind
über Container-Einheiten immer quadratisch und so groß, wie der Platz
hergibt. `env(safe-area-inset-*)` hält alles aus Notch und Home-Leiste
heraus; Scrollen und Zoomen sind auf den Meeren abgeschaltet. Treffer lassen
Android-Geräte kurz vibrieren.

Eine laufende Partie überlebt das Neuladen (`localStorage`) – im Zweierspiel
geht es dann mit dem Übergabebildschirm weiter, damit niemand spickt.

## Aufbau

```
logic/        Regeln, DOM-frei
  rules.js      Raster, Feldnamen, Schiffstypen, Flotten, Regelvarianten
  fleet.js      Schiffe setzen, prüfen, drehen, zufällig verteilen
  board.js      Schüsse, Treffer, Versenken, was der Gegner sehen darf
  match.js      Die Partie: Aufstellung, wer dran ist, Sieg, Statistik
  ai.js         Computergegner in drei Stärken
gfx/          Darstellung
  boardview.js  Ein Meer: Raster, Schiffe, Marken, Zielkreuz, Effekte
  ships.js      Vektorschiffe von oben, je Typ eigene Silhouette, gecacht
  effects.js    Granaten, Fontänen, Explosionen, Feuer, Rauch
  water.js      Kaustik-Textur, zwei gegeneinander treibende Lagen
ui/           Bildschirme, Titelszene, Feuerwerk
placement.js  Aufstellen per Ziehen und Tippen
input.js      Zielen und Feuern
audio.js      Synthetisierter Klang (Web Audio)
main.js       Verdrahtung und Spielablauf
sim/          Prüfläufe ohne Browser
```

## Prüfen

```bash
npm run check:schiffe
```

Nimmt Feldnamen, Platzierung, Abstandsregel, Drehen, Zufallsaufstellung
(je 200 Flotten pro Variante), Schüsse, Versenken, Partieablauf, Bonusschuss
und Speichern ab. Danach spielt jede Computerstufe 100 Partien pro
Regelvariante – die Stufen müssen messbar unterschiedlich stark sein, sonst
schlägt der Lauf fehl.

`index.html?debug` legt den Spielstand als `__schiffe` in die Konsole.
