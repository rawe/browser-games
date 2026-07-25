# Entwurf: Auftragsketten & globale Events

Arbeitsentwurf für die nächste Planungs-Iteration von Alterac. Ziel: die
Planungsphase interessanter machen, ohne den Grundsatz „geheim vorausplanen,
dann deterministisch ablaufen" aufzugeben. **Noch nicht implementiert** – dies
ist die Diskussionsgrundlage; Empfehlungen sind als solche markiert.

## 1. Problem & Ziele

Heute plant man je Einheit genau **einen** Pfad plus **eine** Haltung
(`{ type, path, stance }`). Daraus baut `sim.js` eine Befehlsliste und hängt
einen festen Fallback an (Turm am Pfadende angreifen → sonst zum Boss). Das ist
robust, aber flach:

- **Nur eine Aktion pro Einheit.** Man kann mit einer Einheit **nicht zwei Türme
  nacheinander** angreifen (`towerTarget` ist genau das eine Pfadende).
- **Kein Bezug zur Schlachtlage.** Man kann nicht sagen „*erst wenn* der Schild
  des gegnerischen Bosses weg ist, renn den Boss an". Reihenfolge und Timing
  ergeben sich nur aus Laufwegen, nicht aus dem, was auf der Karte passiert.

Ziele des Entwurfs:

1. **Mehrere Aktionen pro Einheit** (Auftragskette).
2. Aktionen können an **globale Events** gekoppelt sein („Schild weg", „Turm
   gefallen", „Friedhof unser").
3. **Einfach einstellbar** – Gelegenheitsspieler dürfen von all dem nichts
   merken; die Tiefe ist optional.
4. **Determinismus bleibt** – alles fügt sich in das ereignisbasierte Zeitmodell
   (`nextEventTime` / `processBatch`).

## 2. Kernidee: die Auftragskette

Statt *ein* `{ path, stance }` bekommt jede Einheit eine **geordnete Liste von
Aufträgen**. Ein Auftrag ist im Grunde das heutige Modell (ein Pfad + eine
Haltung) plus ein optionaler **Auslöser**.

```js
unit = {
  type: 'medium',
  actions: [
    // Auftrag 1: läuft sofort ab Sekunde 0 (kein Auslöser)
    { path: ['nordtor', 'turmA'], stance: 'attack' },
    // Auftrag 2: startet, wenn Auftrag 1 fertig ist (sequenziell)
    { path: ['turmB'], stance: 'attack', trigger: { kind: 'then' } },
    // Auftrag 3: unterbricht ALLES, sobald der Boss-Schild fällt
    { path: [], stance: 'attack',
      trigger: { kind: 'when', cond: { type: 'enemyShieldDown' } } },
  ],
}
```

Damit ist die **Zwei-Türme-Frage sofort gelöst**: Auftrag 1 endet auf Turm A,
Auftrag 2 (sequenziell) endet auf Turm B. Der Pfad von Auftrag 2 baut ab dem
Ende von Auftrag 1 weiter auf – die Kette bleibt zusammenhängend.

**Empfehlung:** genau **zwei** Auslöser-Arten – mehr braucht es für die
Ausdruckskraft nicht, und mehr würde die UI überladen.

## 3. Die zwei Auslöser-Arten

### „Dann" – sequenziell (Standard)

Der Auftrag startet, **sobald der vorige Auftrag fertig** ist. „Fertig"
bedeutet: Pfad abgelaufen **und** das Ziel abgearbeitet (Turm zerstört /
Friedhof genommen / am Zielknoten angekommen). Das ist der Normalfall und
braucht **kein Event**.

Optional lässt sich ein „Dann"-Auftrag zusätzlich **gaten**: „erst wenn
[Bedingung]". Dann wartet die Einheit am Ende des vorigen Auftrags, bis die
Bedingung wahr ist, und zieht erst dann los. (Warten heißt: an Ort und Stelle
stehen bleiben – bei Haltung „Halten" eingegraben, bei „Angriff" ungeschützt.)

> Konsequenz: „Dann" **unterbricht nie**. Es ist reine Reihenfolge. Das deckt
> „nicht immer werden Events benötigt" ab – die meisten Ketten sind einfach
> sequenziell.

### „Sobald" – Reaktion / Unterbrechung (opt-in)

Der Auftrag ist an eine **Bedingung** gebunden. **In dem Moment, in dem sie
wahr wird, wirft die Einheit ihren aktuellen Auftrag weg und wechselt zu
diesem** – egal, wo sie in der Kette gerade steht. Genau das ist das vom Nutzer
gewünschte „event-getriggerte Aktionen überschreiben, was eine Einheit gerade
macht".

**Wichtig – explizites Zuhören:** Eine Einheit reagiert **nur** auf Events, für
die sie einen „Sobald"-Auftrag besitzt. Ohne „Sobald"-Auftrag ignoriert sie
jedes Event komplett. Es gibt keine globale Automatik. Damit ist die
Nutzer-Anforderung „eine Einheit muss explizit auf das Event hören" strukturell
erfüllt: **der „Sobald"-Auftrag *ist* das Zuhören.**

Ein „Sobald"-Auftrag feuert **einmal** (an der ersten steigenden Flanke der
Bedingung). Danach läuft die Kette normal weiter.

### Wann genau greift eine Unterbrechung? (Determinismus-Regel)

Kritischer Punkt für die deterministische Sim. **Empfehlung:**

- Bedingungen werden in `processBatch(t)` geprüft, **nachdem** der Weltzustand
  des Zeitpunkts aufgelöst ist (Einnahmen, Angriffe, Turm-/Boss-Fall). So sieht
  die Prüfung einen konsistenten Zustand.
- Eine erfüllte „Sobald"-Bedingung wird **gelatcht** (gemerkt), aber erst
  **angewendet, sobald die Einheit frei an einem Knoten steht** (Ankunft oder
  Kampfende, `state === 'atNode' && !fighting`) – genau der Punkt, an dem heute
  schon `continueOrders` neu plant.

> Konsequenz: Eine Unterbrechung wirkt **nicht mitten auf einer Kante oder
> mitten im Nahkampf**, sondern am nächsten Wegpunkt, an dem die Einheit ohnehin
> neu entscheidet. Das ist eine bewusste Vereinfachung: Sie hält die
> Bewegungs- und Kampfbuchhaltung sauber (kein Zurückrechnen von Bruchteil-
> Positionen, kein Herausreißen aus einem laufenden Kantenkampf) und bleibt
> deterministisch. Preis: minimale Verzögerung (max. ein Wegstück bzw. bis
> Kampfende). Für die Spielaussage („nach dem Turmfall zum Boss") ist das
> unerheblich.

## 4. Katalog globaler Events – und die Payload-Frage

Die Sim erzeugt **schon heute** typisierte Events (`sim.js`: `towerDown`,
`graveyardCaptured`, `bossDown`, …). Der Entwurf braucht keine neue
Event-Infrastruktur, sondern eine **Bedingungssprache**, die den Weltzustand
abfragt.

### Empfohlener Kern-Katalog (klein halten!)

| Bedingung (Spielersicht) | Subjekt / Payload | Quelle im Sim | Monoton? |
| --- | --- | --- | --- |
| **Gegnerischer Turm gefallen** | ein konkreter Turm (Knoten) | `towers[x].alive` / `towerDown` | ja |
| **Boss-Schild des Gegners gefallen** | – (keins) | alle gegn. Türme zerstört | ja |
| **Friedhof gehört uns** | ein konkreter Friedhof | `gyOwner[y]` | nein (kann kippen) |
| **Gegner-Boss unter X %** | Prozentwert | `boss[gegner].hp` | ja (Boss regeneriert nie) |
| **Ab Sekunde N** | Zahl (Sekunden) | `time` | ja |

Die ersten beiden sind der Kern (der Nutzer nennt „Schild weg" als
Leitbeispiel). Die übrigen drei sind sinnvolle Ergänzungen; **Empfehlung:** für
den ersten Wurf nur **Turm gefallen** + **Boss-Schild gefallen** ausliefern
(siehe MVP-Abschnitt) und die anderen später nachziehen.

### Brauchen Events eine Payload? — Ja, aber der Spieler sieht sie nie roh

Die eigentliche Frage. Antwort: **es hängt von der Kardinalität des Events ab.**

- **Meilenstein-Events (Singleton) → keine Payload.** „Boss-Schild gefallen"
  gibt es je Fraktion genau einmal. Eine Einheit kennt ihre Fraktion, „der
  Schild des *Gegners*" ist damit eindeutig. Es genügt ein Boolean „ist es
  passiert?".

- **Instanz-Events (mehrfach) → Payload nötig.** „Ein Turm ist gefallen" –
  *welcher*? „Ein Friedhof wurde genommen" – *welcher, von wem*? Ohne die
  Identität kann man „greife Turm B an, sobald Turm A fällt" nicht ausdrücken.

**Zentrale Empfehlung – Payload als „eingefrorenes Subjekt":** Der Spieler
hantiert **nie** mit roher Payload und **abonniert keinen Event-Stream**.
Stattdessen wählt er eine **benannte Bedingung** und tippt – falls nötig – das
**Subjekt direkt auf der Karte** an (den Turm, den Friedhof) bzw. gibt eine Zahl
ein (%, Sekunden). Dieses Subjekt wird beim Planen in die Bedingung
**eingefroren**:

```js
cond: { type: 'towerDown', node: 'turmA' }   // Instanz-Event: Subjekt gebunden
cond: { type: 'enemyShieldDown' }            // Meilenstein: kein Subjekt
cond: { type: 'bossHpBelow', pct: 50 }       // Schwellenwert als Payload
```

> Konsequenz: **Intern** bleiben Events voll payloadbehaftet (wie heute schon).
> **Nach außen** ist die Payload unsichtbar – sie steckt in der beim Antippen
> gewählten Bedingung. Der Spieler denkt in „Bedingungen", nicht in „Events mit
> Feldern". Das ist der Schlüssel zu „einfach einstellbar".

## 5. Datenmodell (rückwärtskompatibel)

`sim.js` normalisiert beim Aufbau der Gruppen **beide** Formen. Legacy-Pläne
(`{ path, stance }`) werden zu einer Ein-Auftrag-Kette gemappt – Renderer,
Effekte und KI müssen nicht sofort umgestellt werden, weil sie den
Sim-Zustand (`groups`) lesen, nicht die Pläne.

```js
// Normalisierung (Skizze) in createSim:
const actions = u.actions ?? [{ path: u.path, stance: u.stance }];
```

Der heutige `orders`/`orderIndex`-Mechanismus wird pro Auftrag
wiederverwendet; neu ist nur ein **Auftrags-Index** obendrauf plus die
Auslöser-Prüfung.

## 6. Sim-Integration & Determinismus

- **Zustandsbasierte Bedingungen** (Turm, Schild, Friedhof, Boss-%) ändern sich
  nur bei einem Ereignis (Angriff, Zerstörung, Einnahme) – also **immer an einem
  bestehenden `nextEventTime`-Punkt**. Es entstehen keine neuen „Zwischenzeiten".
  Boss-HP springt nur bei Boss-Angriffen → die Schwelle wird an einem
  Angriffs-Event überschritten, nicht dazwischen.
- **Nur** die Zeit-Bedingung („ab Sekunde N") ist ein *neuer* Zeitpunkt und muss
  in `nextEventTime()` eingespeist werden (analog zu `respawnAt`). Ein Grund
  mehr, sie erst in der zweiten Ausbaustufe zu bringen.
- Bedingungsprüfung ist ein reiner Lesevorgang über den Sim-Zustand → keine
  Reihenfolge-Abhängigkeit, kein Zufall, voll reproduzierbar.

## 7. Neue Fallback-Regel

Heute: nach abgearbeitetem Pfad → Turm am Ende → sonst Boss. Neu, sauber
verallgemeinert:

> Hat eine Einheit **keinen aktiven Auftrag mehr** (die sequenzielle Kette ist
> abgearbeitet), gilt:
> - letzter Auftrag Haltung **Angriff** → **Fallback: Marsch auf den
>   gegnerischen Boss** (wie heute).
> - letzter Auftrag Haltung **Halten** → an Ort und Stelle **halten** (wie
>   heute).
>
> Ein noch **nicht gefeuerter „Sobald"-Auftrag blockiert den Fallback nicht** –
> die Einheit tut derweil das Fallback-Verhalten und wird vom „Sobald"
> unterbrochen, falls die Bedingung noch eintritt.

Damit ist „der Fallback zum Boss gilt nur, wenn es keine zweite Aktion gibt"
exakt abgebildet: Der Fallback ist der **implizite letzte Auftrag**; alle
explizit geplanten Aufträge laufen zuerst. Wer *nicht* zum Boss rennen will,
setzt als letzten sequenziellen Auftrag „Halten" – ein „Sobald" kann die
Einheit später trotzdem herausziehen.

## 8. UI – „gut und einfach einstellbar"

Leitprinzip: **Progressive Disclosure.** Der Standard bleibt exakt das heutige
Bedienen; Tiefe erscheint nur, wenn man sie anfasst.

1. **Default = heute.** Eine frisch angeworbene Einheit hat genau **einen**
   Auftrag. Pfad antippen, Angriff/Halten wählen, fertig. Wer nie „+ Auftrag"
   drückt, merkt vom ganzen System nichts.
2. **Auftragskette im Chip.** Der Einheiten-Chip zeigt die Aufträge
   untereinander, z. B.:
   - `① ⚔ Nordtor → Turm A · greift an`
   - `② Dann ⚔ → Turm B · greift an`
   - `③ Sobald „Schild weg": ⚔ direkt zum Boss`
3. **„+ Auftrag"-Knopf.** Fügt einen Auftrag hinzu. Sein Pfad wird wie gewohnt
   per Karten-Tap gebaut – **ab dem Ende des vorigen Auftrags**.
4. **Auslöser-Wähler pro Auftrag:** zwei Knöpfe **„Dann"** (Standard) und
   **„Sobald …"**. „Sobald" öffnet eine **kurze Dropdown-Liste** der Bedingungen
   (max. ~5). Braucht die Bedingung ein Subjekt, erscheint der Hinweis „Turm /
   Friedhof auf der Karte antippen"; braucht sie eine Zahl, ein kleines
   Zahlenfeld. Nur **zwei Begriffe** muss der Spieler lernen: „Dann" (danach)
   und „Sobald" (Unterbrechung).
5. **Ziel-Marker.** Die bestehende „Ziele der übrigen Trupps"-Anzeige kann pro
   Einheit das **aktive** Auftragsziel zeigen; Auslöser-Aufträge lassen sich
   dezent markieren (z. B. gestrichelt „wartet auf Event").

> Konsequenz: Die Lernkurve bleibt flach. Neue Spieler sehen eine unveränderte
> Oberfläche; fortgeschrittene bekommen Sequenzierung und Reaktionen mit
> minimalem neuen Vokabular.

## 9. Konsequenzen im Überblick

**Positiv**

- Zwei-Türme-Angriff (und beliebige Ketten) sofort möglich.
- Timing an der echten Schlachtlage statt nur an Laufwegen → tiefere Taktik
  („Turmknacker vorschicken, Boss-Sturm erst nach Schildfall").
- Reagiert auf die **Payload-Frage** mit einer klaren Linie: intern payload­behaftet,
  nach außen als benannte Bedingung mit eingefrorenem Subjekt.
- Rückwärtskompatibel; Renderer/Effekte/KI müssen nicht sofort mit.

**Kosten / Risiken**

- Planungsphase wird mächtiger → mehr Balancing-Fläche (z. B. „Sobald Schild
  weg → alle auf den Boss" könnte zu stark sein; ggf. über Boss-Flächenschlag
  gegenbalancieren, der genau solche Massenstürme bestraft).
- **Unterbrechung wirkt erst am nächsten freien Knoten** – bewusste
  Vereinfachung, muss in der Hilfe klar erklärt werden, sonst wirkt „Sobald"
  träge.
- **KI muss nachziehen** (`ai.js`), um die neue Ausdruckskraft zu nutzen –
  anfangs reicht ein simples Muster („ein Angreifer: Sobald Schild weg → Boss").
- Friedhofs-Bedingung ist **nicht monoton** (Besitz kann zurückfallen); für
  einen einmal feuernden „Sobald" ist die steigende Flanke trotzdem
  wohldefiniert.

## 10. Empfohlener MVP-Zuschnitt (fokussiert)

Nicht alles auf einmal. Empfohlene erste Stufe – maximaler Nutzen, minimale
Fläche:

1. **Auftragskette** (mehrere Aufträge, `path` + `stance` je Auftrag) inkl.
   rückwärtskompatibler Normalisierung. → löst „zwei Türme" und „mehrere
   Aktionen" allein schon.
2. **Auslöser „Dann"** (sequenziell, ohne Gate) als Default zwischen Aufträgen.
3. **Auslöser „Sobald"** mit **genau zwei** Bedingungen: **„Gegnerischer Turm
   gefallen" (Subjekt per Tap)** und **„Boss-Schild des Gegners gefallen" (ohne
   Subjekt)**. Beide sind zustandsbasiert → keine Änderung an `nextEventTime`.
4. Neue **Fallback-Regel** (Abschnitt 7).

Später: „Dann … erst wenn"-Gate, Friedhofs-, Boss-%- und Zeit-Bedingung,
KI-Nutzung der Auslöser.

Diese Stufe bringt den Kern der gewünschten Tiefe (Ketten + Reaktion auf den
Schildfall) bei überschaubarem Risiko und ist voll deterministisch.
