# Promptvorlage für das 3D-Generierungsmodell

Die folgenden Blöcke werden gemeinsam verwendet. Zuerst den Basisblock, danach genau einen Fahrzeugblock und das zugehörige Modellblatt mitsenden.

## Basisblock

```text
Erzeuge ein originales, markenfreies Low-Poly-Supercar als produktionsfähiges GLB für ein browserbasiertes Three.js-Rennspiel. Nutze das beigefügte Modellblatt als verbindliche visuelle Identität. Alle Ansichten zeigen dasselbe Fahrzeug; übernimm Silhouette, Scheibenform, Lichtsignatur, Radhäuser und Heckbauteile konsistent.

Koordinaten: +X vorwärts, +Y oben, +Z linke Fahrzeugseite. Ursprung in der Mitte der Fahrzeuggrundfläche bei Y=0. Räder berühren Y=0. Maximale Bounding-Box 4,60 Länge × 1,45 Höhe × 2,20 Breite. Zielradstand 2,68, Radradius 0,47, Reifenbreite 0,42.

Modellierstil: große bewusst gesetzte Polygonflächen, harte Kanten und klare Facetten; keine zufällige Dreiecksstruktur, keine glatte Blob-Form, keine realen Markenmerkmale. Räder sitzen sichtbar in den Radhäusern. Innenraum nur als zwei grobe Sitze und dunkles Armaturenbrett.

Erzeuge getrennte Knoten: car_root, body, glass, aero, lights_front, lights_rear, wheel_fl, wheel_fr, wheel_rl, wheel_rr. Rad-Pivots liegen in den Radmittelpunkten. Transformen anwenden; car_root ohne Rotation und ohne Skalierung.

Maximal sechs Materialien: paint, glass, carbon, tire, rim, lights. Lack muss zur Laufzeit umfärbbar sein. Keine Logos, Beschriftungen, Aufkleber oder externen URLs. Ziel 4.000–8.000 Dreiecke inklusive Rädern, Dateigröße unter 1 MB. Exportiere ein einzelnes binäres GLB.
```

## Roter Keil

Referenz: `../concepts/01-roter-keil-modellblatt.png`

```text
Fahrzeugtyp „Roter Keil“: flacher, breiter Mittelmotor-Keil und Spielerfahrzeug. Lange niedrige Front, trapezförmige Kabine, besonders breite hintere Schultern. Kein Heckflügel. Fünf schwarze horizontale Motorlamellen, zwei quadratisch-trapezförmige rote Rückleuchten, breites schwarzes Heckband und tiefer trapezförmiger Diffusor. Lack #ff4b3a, Glas dunkelblau, Carbon fast schwarz. Die Silhouette des roten Fahrzeugs im Familienbild und alle sechs Ansichten des Modellblatts müssen erkennbar bleiben.
```

## Magenta Flügel

Referenz: `../concepts/02-magenta-fluegel-modellblatt.png`

```text
Fahrzeugtyp „Magenta Flügel“: kurzer aggressiver Mittelmotor-Keil mit schmaler Kabine und kräftigen polygonalen hinteren Radhäusern. Fast fahrzeugbreiter freistehender Heckflügel auf zwei massiven Winkelstützen. Dünne horizontale Rückleuchten im dunklen Heckband, zentraler Doppelauspuff mit sechseckigen Öffnungen und deutliche Diffusorfinnen. Lack #ff5ca8, Glas dunkelblau, Carbon fast schwarz. Flügel, Auspuff und Hecksignatur müssen aus allen Ansichten konsistent sein.
```

## Cyan Puls

Referenz: `../concepts/03-cyan-puls-modellblatt.png`

```text
Fahrzeugtyp „Cyan Puls“: sauberer, etwas schmaler gezeichneter Mittelmotor-Keil mit breiten hinteren Radhäusern. Dunkle Flying Buttresses rahmen die Kabine. Kein freistehender Flügel; stattdessen kurzer integrierter Ducktail. Rechteckige cyanweiße Lichtsignatur, breites dunkles Heckband und einfacher tiefer Diffusor. Lack #2ad4c8, Glas dunkelblau, Carbon fast schwarz. Weniger Nebendetails und ruhigere Großflächen als bei den beiden anderen Typen.
```

## Negativvorgaben

```text
Nicht erzeugen: reale Automarken oder kopierte Serienmodelle, Markenembleme, Text, Nummern, Sponsoren, Waffen, übergroße Lufteinlässe, zufällige Greebles, frei stehende Räder, hohe SUV-Proportionen, glatte Subdivision-Oberflächen, unnötigen Innenraum, Chromschmuck, sichtbare Studiofläche im Export.
```

