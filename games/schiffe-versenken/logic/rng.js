// Ein kleiner Zufallsgenerator mit Startwert (mulberry32). Im Spiel reicht
// `Math.random`; die Prüfläufe brauchen dagegen reproduzierbare Partien.

export function createRng(seed = Date.now()) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.pick = (list) => list[Math.floor(next() * list.length)];
  return next;
}

export const defaultRng = Object.assign(() => Math.random(), {
  int: (n) => Math.floor(Math.random() * n),
  pick: (list) => list[Math.floor(Math.random() * list.length)],
});
