# Technische Modellvorgaben

> Die GLB-/Knotenvorgaben unten sind die externe Modellierungs-Zielspezifikation.
> Der aktuelle prozedurale Spielstand ist in `README.md` dokumentiert. Sichtbare
> Räder: Radius 0,47, Breite 0,34, Mittelpunkte bei X = +1,33 / −1,35,
> Y = 0,47 und Z = ±0,855. Sie werden instanziert und derzeit nicht animiert.

## Koordinatensystem und Maße

Die bestehende Spiellogik erwartet dieselbe Ausrichtung wie das aktuelle prozedurale Modell:

- `+X` = vorwärts
- `+Y` = oben
- `+Z` = linke Fahrzeugseite
- Ursprung = Mitte der Fahrzeuggrundfläche auf Fahrbahnhöhe
- Räder berühren bei `Y = 0` den Boden
- Ziel-Bounding-Box: maximal `4,60 × 1,45 × 2,20` Einheiten für Länge × Höhe × Breite
- Zielradstand: `2,68` Einheiten
- Radmittelpunkte: ungefähr `X = +1,33` und `X = -1,35`, `Y = 0,47`, `Z = ±1,00`
- Radradius: `0,47`; Reifenbreite: `0,42`

Der hohe Flügel von „Magenta Flügel“ darf bis `Y = 1,48` reichen. Kein Bauteil darf die maximale Breite von `2,20` überschreiten. Kleine optische Abweichungen sind erlaubt, solange Physik und Kamera nicht angepasst werden müssen.

## Proportionen

- Karosserieunterkante: `Y = 0,14–0,22`
- Schulterlinie: `Y = 0,62–0,78`
- Dachhöhe: `Y = 1,28–1,38`
- Kabinenbreite: etwa 58–64 % der Fahrzeugbreite
- größte Breite über den hinteren Radhäusern
- vorderer Überhang länger und flacher als der hintere
- Räder teilweise in die Radhäuser eingebettet; keine frei stehenden Zylinder

## Geometrie

- Ziel: 4.000–8.000 Dreiecke pro Fahrzeug inklusive vier Rädern
- optionales LOD1: 1.500–3.000 Dreiecke
- harte Kanten und große, bewusst geplante Facetten; nicht wahllos triangulieren
- Silhouette hat Vorrang vor Türfugen oder winzigen Lüftungen
- Unterboden als einfache geschlossene Fläche
- keine unsichtbaren Innenraumdetails außer zwei groben Sitzformen und einem dunklen Armaturenbrett
- Spiegel dürfen Teil der Karosserie sein, wenn dies Draw Calls spart

## Knoten und Pivot

Empfohlene Knotennamen:

```text
car_root
├── body
├── glass
├── aero
├── lights_front
├── lights_rear
├── wheel_fl
├── wheel_fr
├── wheel_rl
└── wheel_rr
```

Alle Rad-Pivots müssen exakt im jeweiligen Radmittelpunkt liegen. `car_root` darf keine zusätzliche Rotation oder Skalierung tragen. Transformen vor Export anwenden.

## Materialien

Höchstens sechs Materialslots:

1. `paint` – Lackfarbe wird zur Laufzeit getönt
2. `glass` – dunkelblaues Glas, leichte Transparenz oder deckende mobile Variante
3. `carbon` – Splitter, Schweller, Diffusor, Flügel/Lamellen
4. `tire` – fast schwarzer Gummi
5. `rim` – dunkles Metall
6. `lights` – Front- und Hecklicht über Vertexfarbe oder getrennte Meshgruppen

Bevorzugt werden PBR-Basiswerte ohne große Texturen. Falls Texturen nötig sind: maximal 512², gemeinsam nutzbar, keine eingebrannten Marken oder Texte. Facetten dürfen über Flat Shading oder sorgsam getrennte Normalen entstehen.

## Farbpalette

| Zweck | Hex |
| --- | --- |
| Spielerrot | `#ff4b3a` |
| Spielerakzent | `#ffc43d` |
| Magenta | `#ff5ca8` |
| Violett | `#b45cff` |
| Blau | `#3d7bff` |
| Cyan | `#2ad4c8` |
| Grün | `#35d07f` |
| Orange | `#ff8a2a` |
| Weiß | `#e8e8ee` |
| Carbon | `#151a21` |
| Glas | `#174d70` |

## Typspezifische Muss-Merkmale

### Roter Keil

- kein freistehender Heckflügel
- fünf breite, schwarze Motorlamellen
- zwei quadratisch-trapezförmige Rückleuchten
- schwarzes Heckband und tiefer trapezförmiger Diffusor
- breite, fast horizontale Schulter über dem Hinterrad

### Magenta Flügel

- freistehender, fast fahrzeugbreiter Flügel mit zwei massiven Trägern
- schlanke Rückleuchten in einem dunklen Band
- zwei zentrale sechseckige Auspufföffnungen
- ausgeprägte Diffusorfinnen
- kürzere, aggressivere Front als beim Spielerfahrzeug

### Cyan Puls

- kein freistehender Flügel; kurzer integrierter Ducktail
- dunkle Flying Buttresses zwischen Seitenfenster und Motordeck
- rechteckige cyanweiße Frontlichtsignatur
- breites dunkles Heckband
- klarere, ruhigere Flächen als bei den beiden anderen Typen

## Browser- und Exportvorgaben

- Exportformat: binäres glTF (`.glb`)
- Mesh-Kompression nur verwenden, wenn der bestehende Loader sie unterstützt; sonst unkomprimiert liefern
- keine externen Laufzeitdateien und keine externen URLs
- ein Modell pro Datei
- Zielgröße: unter 1 MB pro GLB, ideal unter 600 KB
- keine Animationen außer optionaler Radrotation über die getrennten Radknoten
- Alpha-Blending am Glas sparsam einsetzen; auf mobilen Geräten bevorzugt Alpha-Test oder deckend getönt

## Visuelle Abnahme im Spiel

Prüfen bei der vorhandenen schrägen Verfolgerkamera:

- Heck, Rückleuchten und Dachlinie sind bei 100–160 Pixel Fahrzeugbreite lesbar.
- Räder verschwinden teilweise in den Radhäusern, schneiden aber nicht durch die Karosserie.
- Fahrzeug wirkt breit und tief, nicht hoch und quaderförmig.
- Facetten bleiben im warmen Sonnenlicht sichtbar, ohne jede Dreieckskante gleich stark zu betonen.
- Die drei Typen sind in Silhouette ohne Farbe unterscheidbar.

