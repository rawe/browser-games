// Karrierestand & Shop-Regeln: Preisgeld, Ausbaustufen, Raketenkauf. DOM-frei.

export const MAX_LEVEL = 4;
export const MAX_ARMOR = 3;
export const MAX_AMMO = 9;

export const PRICES = {
  motor: [450, 800, 1300, 1900],
  handling: [400, 700, 1150, 1700],
  panzerung: [350, 650, 1100],
  rocketFront: 90,
  rocketRear: 55,
  repairPerPoint: 4,
};

export const PRIZE_MONEY = [900, 620, 450, 300, 200, 140, 90, 50];

export function createCareer() {
  return {
    money: 500,
    stage: 0, // Index in tracks[]
    upgrades: { motor: 0, handling: 0, panzerung: 0 },
    health: 100,
    ammoF: 2,
    ammoR: 0,
    wins: 0,
  };
}

export function prizeFor(position) {
  return PRIZE_MONEY[position - 1] ?? 0;
}

export function repairCost(career) {
  return Math.ceil((100 - career.health) * PRICES.repairPerPoint);
}

export function canBuyUpgrade(career, key) {
  const level = career.upgrades[key];
  const prices = PRICES[key];
  return level < prices.length && career.money >= prices[level];
}

export function buyUpgrade(career, key) {
  if (!canBuyUpgrade(career, key)) return false;
  career.money -= PRICES[key][career.upgrades[key]];
  career.upgrades[key]++;
  return true;
}

export function buyRepair(career) {
  const cost = repairCost(career);
  if (cost <= 0 || career.money < cost) return false;
  career.money -= cost;
  career.health = 100;
  return true;
}

export function buyRocket(career, dir) {
  const price = dir === 'front' ? PRICES.rocketFront : PRICES.rocketRear;
  const key = dir === 'front' ? 'ammoF' : 'ammoR';
  if (career[key] >= MAX_AMMO || career.money < price) return false;
  career.money -= price;
  career[key]++;
  return true;
}
