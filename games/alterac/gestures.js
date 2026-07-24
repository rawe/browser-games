// Gestensperre für Mobilgeräte: unterbindet Pinch-Zoom auf der gesamten Seite,
// ohne normales vertikales Scrollen oder schnelles Antippen zu behindern.
//
// Hintergrund: iOS Safari ignoriert `user-scalable=no` im Viewport-Meta seit
// iOS 10, und `touch-action` allein reicht dort für den seiten­weiten Pinch nicht.
// Zuverlässig sind nur die (nicht standardisierten) `gesture*`-Events von WebKit
// plus das Abfangen von Mehrfinger-`touchmove`. Beides greift in Planung wie
// Simulation – die Karte, die Einheitenliste und die Setup-Seite scrollen
// weiterhin normal (Einfinger-Wisch bleibt unberührt).
//
// Der Doppeltipp-Zoom wird bewusst allein über `touch-action: pan-y` (CSS)
// gesperrt und NICHT über ein `touchend`-preventDefault: Letzteres würde den
// folgenden `click` verschlucken und damit schnelles Antippen von Wegpunkten
// beim Pfadbau blockieren.

export function lockZoomGestures(target = document) {
  // WebKit-Pinch (iOS Safari): Pinch löst gesturestart/-change/-end aus.
  for (const type of ['gesturestart', 'gesturechange', 'gestureend']) {
    target.addEventListener(type, (ev) => ev.preventDefault(), { passive: false });
  }

  // Pinch auf allen Touch-Browsern: sobald ein zweiter Finger aufsetzt, das
  // Wischen abbrechen. Einfinger-Gesten (Scrollen, Tippen) bleiben erlaubt.
  target.addEventListener(
    'touchmove',
    (ev) => {
      if (ev.touches.length > 1) ev.preventDefault();
    },
    { passive: false }
  );
}
