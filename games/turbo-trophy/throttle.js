// Gaszustand der Touch-Steuerung als reine Zustandsmaschine – DOM-frei und
// damit headless prüfbar (siehe `sim/checks.js`).
//
// Modell: „kurz tippen = Dauergas an/aus, gedrückt halten = Gas solange
// gedrückt". Damit lässt sich auf dem Handy dauerhaft beschleunigen und
// gleichzeitig eine Rakete auslösen, ohne dass der Finger auf dem Gas bleibt.
// Bremsen beendet das Dauergas – das ist die eindeutige Gegenaktion.

/** Bis zu dieser Druckdauer (ms) gilt ein Druck als Tippen. */
export const TAP_MS = 260;

export function createThrottle({ tapMs = TAP_MS } = {}) {
  let held = false;      // Finger/Maus liegt auf dem Gas-Button
  let latched = false;   // Dauergas aktiv
  let pressedAt = 0;

  return {
    /** Gas wird gegeben, solange gehalten wird oder Dauergas läuft. */
    get active() {
      return held || latched;
    },
    get latched() {
      return latched;
    },
    get held() {
      return held;
    },

    press(now) {
      if (held) return;
      held = true;
      pressedAt = now;
    },

    /**
     * Loslassen entscheidet: kurzer Druck schaltet das Dauergas um, ein
     * längeres Halten war klassisches Gasgeben und endet hier. Bewusst gegen
     * den *aktuellen* Zustand geschaltet – wurde während des Drucks gebremst,
     * schaltet das Tippen wieder ein statt ins Leere zu laufen.
     */
    release(now) {
      if (!held) return;
      held = false;
      latched = now - pressedAt <= tapMs ? !latched : false;
    },

    /** Abbruch von außen (z. B. `touchcancel`): Dauergas bleibt, wie es war. */
    cancel() {
      held = false;
    },

    /** Bremsen ist die eindeutige Aktion, die das Dauergas beendet. */
    brake() {
      latched = false;
    },

    reset() {
      held = false;
      latched = false;
      pressedAt = 0;
    },
  };
}
