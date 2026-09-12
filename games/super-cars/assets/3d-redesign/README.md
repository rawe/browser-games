# Super Cars – 3D-Neuausrichtung

Dieser Ordner ist die eigenständige Übergabegrundlage für neue Fahrzeugmodelle. Er übersetzt den Detailgrad und die Formensprache des Titelscreenshots in drei klar unterscheidbare, browser-taugliche 3D-Fahrzeugtypen.

## Aktueller Spielstand

Der rote Titelwagen wird unabhängig von den Rivalen in `carModels/redRacer.js`
gebaut. Das neue Modell besitzt einen offenen, vertieften Motorraum mit blauem
Heckfenster und drei breiten Abdeckungen, tatsächlich geformte Türflächen,
eingelassene Rücklichter, einen trapezoidalen Diffusor und eine moderne Front mit
schrägen LED-Lichtflächen. Haube und Schultern werden unabhängig von den
Radöffnungen aus großen Flächen aufgebaut. Die Rivalen bleiben auf dem vorherigen
`carModels/coachwork.js`-Stand.

`carModels/redFinish.js` liefert eigene physikalische Lack-, Glas-, Carbon- und
Felgenmaterialien für den roten Wagen, inklusive lokal erzeugter HDR-Reflexionen
und weichem Kontaktschatten. Die Scheiben zeigen einen einfachen dunklen Innenraum.
`carPresentation.js` ergänzt dezentes HDR-Lichtbloom im Spiel und in Einzelansichten
des Viewers. Der Studio-Viewer nutzt zusätzlich warme/kühle Beleuchtung und echte
Schlagschatten; die Rennumgebung wurde nicht neu gestaltet.

Keine GLBs oder Konzeptbilder werden als Fahrzeugmodell oder Fahrzeugtextur
verwendet. Das neue Bild `concepts/04-red-title-turnaround.webp` interpretiert die
nicht sichtbare Front; die ursprüngliche Titelgrafik hat Vorrang. Der zugehörige
Prompt steht unter `prompts/red-title-turnaround.md`.

Gemeinsame instanzierte Radgeometrien: der rote Wagen verwendet 83 % Skalierung
(Radius 0,3901, Breite 0,2822, seitlicher Radmittelpunkt ±0,915) und dunklere Felgen; die Rivalen bleiben unverändert.
Die Räder werden derzeit nicht animiert.

| Modell | Dreiecke | Länge × Höhe × Breite |
| --- | ---: | --- |
| Roter Keil | 5.797 | 4,600 × 1,330 × 2,190 |
| Magenta Flügel | 4.202 | 4,531 × 1,400 × 2,197 |
| Cyan Puls | 4.194 | 4,590 × 1,340 × 2,197 |

Sechs Fahrzeugmaterialien plus Bodenschatten, sieben Draw Calls je Auto, zuzüglich
der gemeinsamen Postprocessing-Pässe. Automatische Prüfungen decken Maße,
Bodenkontakt, Dreieckbudget, Typzuordnung und den kontinuierlichen Haubenverlauf ab.
Sie ersetzen keine Geräte-Benchmarks.

## Verbindliche Bildreihenfolge

1. `references/titelscreenshot.webp` – oberste Quelle für Stil, Stimmung und den roten Heldenwagen
2. `concepts/00-fahrzeugfamilie.webp` – verbindliche Aufteilung der drei Fahrzeugtypen
3. passendes Modellblatt unter `concepts/01…03` – verbindliche Bauteile und Ansichten
4. `references/ist-zustand-3d.jpg` – nur als Vergleich für Maßstab, Kamera und die zu verbessernden Punkte

Wenn sich Darstellungen widersprechen, gilt die weiter oben stehende Quelle. Die Modellblätter sind Konzeptbilder, keine maßhaltigen CAD-Zeichnungen; numerische Maße aus `MODELLVORGABEN.md` haben Vorrang.

## Fahrzeugfamilie

| Typ | Rolle | Erkennungsmerkmale | Vorgesehene Farben |
| --- | --- | --- | --- |
| Roter Keil | Spieler/Held | flügellos, Lamellen über dem Motor, trapezförmige Rückleuchten, sehr breites Heck | Spielerrot |
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

1. `carModels/redRacer.js` (Titelwagen) beziehungsweise `carModels/coachwork.js`
   (Rivalen) anhand der Referenzansichten bearbeiten. Gemeinsame
   Bauteile sind parametrisiert, die Typen besitzen eigene Proportionen und Aero.
2. Nach Änderungen am roten Mesh `node games/super-cars/dev/bake-red-occlusion.mjs`
   ausführen, damit die lokale Vertex-Schattierung zur neuen Geometrie passt.
3. `npm run dev` starten und `/games/super-cars/dev/model-viewer.html` öffnen.
   Fahrzeug und Perspektive sind im Viewer auswählbar; die Teaser-Referenz ist verlinkt.
4. `npm run check:super-cars` prüft Maße, Bodenkontakt, Material-/Dreieckbudget,
   Felgenausrichtung und Typzuordnung ohne WebGL.
5. `npm run build` sowie eine Sichtprüfung im echten Rennen ausführen.
6. Mobilgeräte separat prüfen; die Geometrieprüfung ist kein GPU-Benchmark.

Die GLB-Prompts und Exportvorgaben bleiben als optionale Übergabe für spätere
externe Modellierung erhalten. Sie beschreiben keinen aktuell verwendeten Loader.

## Geometrie und Darstellung des Titelwagens

Die überarbeitete Heckschürze besitzt eine überhängende Deckkante, vertiefte trapezförmige Leuchten und separate vorspringende Stoßfängerpodeste. Die hinteren Kotflügel verwenden gezielt triangulierte Schulterflächen; der rote Wagen besitzt eigene Zehnspeichenfelgen.

Die Kamera der Teaser-Ansicht wird aus manuell ausgewählten Bildpunkten angenähert
(`dev/fit-title-camera.mjs`). `dev/red-review.html` kann Original und Modell mit
regelbarer Deckkraft übereinanderlegen. Die Motoröffnung ist nahezu parallel,
die hinteren Seitenflächen verwenden aus dem Titelbild übertragene Kantenpunkte.
Der Kamerafit und die technischen Tests sind keine automatische Bestätigung einer
vollständigen visuellen Übereinstimmung; dazu dient weiterhin der Bildvergleich.

Die untere Hecköffnung teilt ihre Randpunkte mit der Stoßfänger-Unterkante und besitzt einen abgestuften Rahmen mit tieferem Innenraum. Die beiden Diffusorfinnen liegen innerhalb dieser Öffnung. Die Glasscheiben verwenden dreieckige Farbfelder für den facettierten Reflexionsstil der Vorlage.

Der rote Wagen besitzt eine eigene Niederquerschnitt-Reifengeometrie mit größerer Felgenöffnung, 24 Umfangssegmenten und zehn abgeschrägten Speichen. Die äußeren Reifenmaße bleiben gleich. Die Fensterbänke werden zusätzlich auf ihre Ausrichtung nach oben geprüft.

Die Front besitzt zusammenlaufende Haubenfalze, breitere LED-Gehäuse und vertiefte seitliche Lufteinlässe. Die Türmitte ist stärker eingezogen; die Spiegel besitzen einen eigenen dunklen Glasrahmen.

Lokale Umgebungsverdeckung wird offline mit 32 Strahlen je Lackvertex berechnet
(`node games/super-cars/dev/bake-red-occlusion.mjs`). Die gespeicherten Faktoren
in `carModels/redOcclusionData.js` werden einmal beim Geometrieaufbau in die
Vertexfarben eingerechnet. Eine Positionssignatur verhindert, dass nach einer
Geometrieänderung versehentlich ein alter Bake benutzt wird. Es entsteht kein
zusätzlicher Renderpass. Nach Änderungen am roten Mesh zuerst den Bake erneuern,
danach `npm run check:super-cars` ausführen.
