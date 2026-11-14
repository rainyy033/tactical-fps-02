// Game constants and data: the two factions, the four weapons with their prices and handling,
// the round/economy numbers, and every proper noun in the game (original names, not
// Counter-Strike's). Pure data plus two tiny math helpers, so it has no dependency on three.js.

export const NAMES = {
  title: 'BREAKPOINT',
  subtitle: 'Aegis vs Wraith — a five-a-side skirmish',
  friendly: 'AEGIS',
  enemy: 'WRAITH',
  siteA: 'HELIOS',
  siteB: 'NOVA',
  player: 'You',
  friendlyBots: ['Kestrel', 'Onyx', 'Drift', 'Mara'],
  enemyBots: ['Hex', 'Fang', 'Rook', 'Sable', 'Vex'],
};

export const TEAMS = {
  friendly: { key: 'friendly', name: NAMES.friendly, botCount: 4 },
  enemy: { key: 'enemy', name: NAMES.enemy, botCount: 5 },
};

// Handling notes: spread is the half-angle of the shot cone in radians. `spreadStill` applies when
// the shooter is stationary, `spreadMoving` when moving at or above `moveRef`; the live spread
// lerps between them by speed. Damage is body/hit vs head/hit, so landing a head shot matters far
// more than spraying — accuracy is rewarded over raw speed.
export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Sidearm', label: 'Pistol', cost: 0,
    damage: { body: 26, head: 57 }, fireGap: 0.16, mag: 12, reserve: 48,
    spreadStill: 0.0025, spreadMoving: 0.014, moveRef: 5.2, reload: 1.5,
    auto: false, range: 60, recoil: 0.007,
  },
  smg: {
    id: 'smg', name: 'Viper', label: 'SMG', cost: 1200,
    damage: { body: 23, head: 50 }, fireGap: 0.078, mag: 30, reserve: 90,
    spreadStill: 0.0075, spreadMoving: 0.03, moveRef: 5.2, reload: 1.8,
    auto: true, range: 60, recoil: 0.005,
  },
  rifle: {
    id: 'rifle', name: 'Longshot', label: 'Rifle', cost: 2700,
    damage: { body: 34, head: 75 }, fireGap: 0.115, mag: 30, reserve: 90,
    spreadStill: 0.0035, spreadMoving: 0.02, moveRef: 5.2, reload: 1.9,
    auto: true, range: 80, recoil: 0.009,
  },
  sniper: {
    id: 'sniper', name: 'Avalanche', label: 'Sniper', cost: 4750,
    damage: { body: 90, head: 198 }, fireGap: 1.35, mag: 5, reserve: 15,
    spreadStill: 0.0006, spreadMoving: 0.06, moveRef: 5.2, reload: 2.4,
    auto: false, range: 120, recoil: 0.02,
  },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'rifle', 'sniper'];

export const ROUND = {
  maxHealth: 100,
  buyTime: 12,
  combatTime: 90,
  endDelay: 4,
  eyeHeight: 1.6,
  bodyRadius: 0.34,
  bodyHeight: 1.72,
};

export const ECONOMY = {
  start: 1600,
  kill: 300,
  win: 3250,
  loss: 1400,
  tie: 1000,
  max: 16000,
};

export function clamp(value, min, max) {
  return value < min ? min : value > max ? max : value;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}
