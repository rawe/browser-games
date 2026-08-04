# Super Cars – 3D-Neuausrichtung

Dieser Ordner ist die eigenständige Übergabegrundlage für neue Fahrzeugmodelle. Er übersetzt den Detailgrad und die Formensprache des Titelscreenshots in drei klar unterscheidbare, browser-taugliche 3D-Fahrzeugtypen.

## Warum die Umstellung nötig ist

Der Titelscreenshot zeigt eine starke, wiedererkennbare Formensprache:

- breite Mittelmotor-Keilform statt rechteckiger Grundkörper
- große, bewusst gesetzte Polygonflächen
- kräftige hintere Radhäuser und eine schmale Kabine
- dunkle Motorabdeckung, tiefer Diffusor und klare Lichtsignaturen
- eigenständige Hecklösungen für die einzelnen Fahrzeuge

Der aktuelle 3D-Stand trifft Farbe, Low-Poly-Idee und Verfolgerkamera bereits, wirkt aber deutlich gröber: Die Karosserie besteht aus wenigen Quadern/Querschnitten, die Räder stehen sehr frei, und alle acht Autos teilen praktisch dieselbe Silhouette. Das Ziel ist nicht mehr geometrische Kleinteiligkeit, sondern bessere Proportionen, größere zusammenhängende Flächen und drei erkennbare Karosseriecharaktere.

## Verbindliche Bildreihenfolge

1. `references/titelscreenshot.webp` – oberste Quelle für Stil, Stimmung und den roten Heldenwagen
2. `concepts/00-fahrzeugfamilie.webp` – verbindliche Aufteilung der drei Fahrzeugtypen
3. passendes Modellblatt unter `concepts/01…03` – verbindliche Bauteile und Ansichten
4. `references/ist-zustand-3d.jpg` – nur als Vergleich für Maßstab, Kamera und die zu verbessernden Punkte

Wenn sich Darstellungen widersprechen, gilt die weiter oben stehende Quelle. Die Modellblätter sind Konzeptbilder, keine maßhaltigen CAD-Zeichnungen; numerische Maße aus `MODELLVORGABEN.md` haben Vorrang.

## Fahrzeugfamilie

| Typ | Rolle | Erkennungsmerkmale | Vorgesehene Farben |
| --- | --- | --- | --- |
| Roter Keil | Spieler/Held | flügellos, Lamellen über dem Motor, quadratische Rückleuchten, sehr breites Heck | Spielerrot |
| Magenta Flügel | aggressiver Rivale | hoher Doppelsteg-Flügel, schmale Rückleuchten, zentraler Doppelauspuff | Magenta, Violett, Blau |
| Cyan Puls | leichter Rivale | integrierter Ducktail, dunkle Flying Buttresses, klare rechteckige Lichtsignatur | Cyan, Grün, Weiß, Orange |

Die Farbzuordnung ist eine Empfehlung. Wichtiger ist, dass Silhouette und Hecksignatur auch in 100–160 Pixel Fahrzeugbreite sofort unterscheidbar bleiben.

## Ordnerinhalt

- `concepts/` – freigegebene visuelle Entwürfe
- `references/` – Titelscreenshot und dokumentierter Ist-Zustand
- `prompts/3d-generator.md` – direkt nutzbare Eingabe für ein 3D-Generierungsmodell
- `prompts/bildgenerierung.md` – Promptprotokoll der hier erzeugten Konzeptbilder
- `manifest.json` – maschinenlesbare Maße, Farben und Dateizuordnung
- `models/` – Zielordner für spätere `.glb`-Exporte

## Empfohlener Ablauf

1. Erst den gemeinsamen Block in `prompts/3d-generator.md` verwenden.
2. Danach genau einen Fahrzeugtyp mit seinem Modellblatt erzeugen.
3. Das Ergebnis anhand `MODELLVORGABEN.md` skalieren und ausrichten.
4. Alle geforderten Materialslots und benannten Knoten prüfen.
5. Als `.glb` in `models/` exportieren.
6. In der bestehenden Verfolgerkamera testen, nicht nur im Studio-Viewer.

## Definition of Done

Ein Modell ist erst fertig, wenn:

- die sechs Ansichten seines Modellblatts erkennbar getroffen werden,
- es im festgelegten Fahrzeug-Bounding-Box-Raum liegt,
- Ursprung und Achsen stimmen,
- Räder getrennt drehbar sind,
- Lichtflächen und Glas getrennte Materialien besitzen,
- bei acht sichtbaren Autos auf einem Mobilgerät keine unnötige Material- oder Polygonlast entsteht,
- keine reale Automarke oder ein erkennbar kopiertes Serienmodell enthalten ist.

