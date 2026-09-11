# Super Cars – 3D-Neuausrichtung

Dieser Ordner ist die eigenständige Übergabegrundlage für neue Fahrzeugmodelle. Er übersetzt den Detailgrad und die Formensprache des Titelscreenshots in drei klar unterscheidbare, browser-taugliche 3D-Fahrzeugtypen.

## Aktueller Spielstand

Die drei Autos werden direkt in JavaScript modelliert (`carModels/coachwork.js`),
über `carModel.js` zusammengesetzt und in `scene.js` eingesetzt. Es werden keine
GLBs oder Konzeptbilder als Fahrzeugtexturen geladen. Die lokalen Kandidaten in
`dev/candidates/` sind ausschließlich Vergleichsmaterial und bleiben unversioniert.

Der Aufbau folgt dem Teaser: lackiertes Dach und Fensterrahmen, schmale dunkle
Scheiben, breite hintere Schultern, offene Radläufe, eingelassene Lichtflächen und
ein geneigter Motorraum. Der rote Keil hat fünf Lamellen, der Flügeltyp drei
Motorraumstreben, große Seiteneinlässe und einen freistehenden Flügel; Cyan Puls
hat einen längeren Dachabschluss und einen integrierten Ducktail.

Alle Modelle teilen Reifen und sichtbare Fünfspeichenfelgen. Reifen sind echte
Ringkörper; die Felgen sind auf beiden Fahrzeugseiten nach außen ausgerichtet.
Lack, Glas und Felgen verwenden Phong-Materialien, Carbon und Reifen Lambert,
Lichter unbeleuchtete Materialien. Sechs Fahrzeugmaterialien plus Bodenschatten,
keine Fahrzeugtexturen und sieben Draw Calls je Auto. Die Räder sind instanziert;
eine Radanimation ist derzeit nicht implementiert.

Geprüfte Größen inklusive Rädern, ohne Bodenschatten:

| Modell | Dreiecke | Länge × Höhe × Breite |
| --- | ---: | --- |
| Roter Keil | 4.114 | 4,595 × 1,360 × 2,197 |
| Magenta Flügel | 4.202 | 4,531 × 1,400 × 2,197 |
| Cyan Puls | 4.194 | 4,590 × 1,340 × 2,197 |

## Verbindliche Bildreihenfolge

1. `references/titelscreenshot.webp` – oberste Quelle für Stil, Stimmung und den roten Heldenwagen
2. `concepts/00-fahrzeugfamilie.png` – verbindliche Aufteilung der drei Fahrzeugtypen
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

## Modellieren und prüfen

1. `carModels/coachwork.js` anhand der Referenzansichten bearbeiten. Gemeinsame
   Bauteile sind parametrisiert, die Typen besitzen eigene Proportionen und Aero.
2. `npm run dev` starten und `/games/super-cars/dev/model-viewer.html` öffnen.
   Fahrzeug und Perspektive sind im Viewer auswählbar; die Teaser-Referenz ist verlinkt.
3. `npm run check:super-cars` prüft Maße, Bodenkontakt, Material-/Dreieckbudget,
   Felgenausrichtung und Typzuordnung ohne WebGL.
4. `npm run build` sowie eine Sichtprüfung im echten Rennen ausführen.
5. Mobilgeräte separat prüfen; die Geometrieprüfung ist kein GPU-Benchmark.

Die GLB-Prompts und Exportvorgaben bleiben als optionale Übergabe für spätere
externe Modellierung erhalten. Sie beschreiben keinen aktuell verwendeten Loader.
