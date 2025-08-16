export const MAP_W = 16001;
export const MAP_H = 9001;
export const MAX_TICKS = 250;

export const RULES = {
  VISION: 2200,
  RADAR_VISION: 4400,
  MOVE_SPEED: 800,
  BUST_MIN: 900,
  BUST_MAX: 1760,
  STUN_RANGE: 1760,
  STUN_DURATION: 10,
  STUN_COOLDOWN: 20,
  GHOST_FLEE: 400,
  BASE_RADIUS: 1600,
  EJECT_MAX: 1760
} as const;

export const TEAM0_BASE = { x: 0, y: 0 } as const;
export const TEAM1_BASE = { x: 16000, y: 9000 } as const;
