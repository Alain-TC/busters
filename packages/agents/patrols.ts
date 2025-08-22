export type Point = { x: number; y: number };
export type PatrolPath = Point[];
export type PatrolPaths = PatrolPath[];

export const PATROLS_A: PatrolPaths = [
  [
    { x: 2500, y: 2500 },
    { x: 12000, y: 2000 },
    { x: 15000, y: 8000 },
    { x: 2000, y: 8000 },
    { x: 8000, y: 4500 },
  ],
  [
    { x: 13500, y: 6500 },
    { x: 8000, y: 1200 },
    { x: 1200, y: 1200 },
    { x: 8000, y: 7800 },
    { x: 8000, y: 4500 },
  ],
  [
    { x: 8000, y: 4500 },
    { x: 14000, y: 4500 },
    { x: 8000, y: 8000 },
    { x: 1000, y: 4500 },
    { x: 8000, y: 1000 },
  ],
  [
    { x: 2000, y: 7000 },
    { x: 14000, y: 7000 },
    { x: 14000, y: 2000 },
    { x: 2000, y: 2000 },
    { x: 8000, y: 4500 },
  ],
];

export const PATROLS_B: PatrolPaths = [
  [
    { x: 3000, y: 3000 },
    { x: 10000, y: 1000 },
    { x: 15000, y: 7000 },
    { x: 1000, y: 7000 },
    { x: 8000, y: 4500 },
  ],
  [
    { x: 13000, y: 7000 },
    { x: 8000, y: 1500 },
    { x: 1500, y: 1500 },
    { x: 8000, y: 7500 },
    { x: 8000, y: 4500 },
  ],
  [
    { x: 8000, y: 4500 },
    { x: 14000, y: 4500 },
    { x: 8000, y: 8200 },
    { x: 1000, y: 4500 },
    { x: 8000, y: 800 },
  ],
  [
    { x: 2000, y: 7000 },
    { x: 14000, y: 7000 },
    { x: 14000, y: 2000 },
    { x: 2000, y: 2000 },
    { x: 8000, y: 4500 },
  ],
];

export const PATROL_PATHS: Record<string, PatrolPaths> = {
  a: PATROLS_A,
  b: PATROLS_B,
};

export type PatrolStyle = keyof typeof PATROL_PATHS;

