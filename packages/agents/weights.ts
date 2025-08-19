export type Weights = {
  // task weights
  wHunt: number;
  wReturn: number;
  wExplore: number;
  wIntercept: number;
  wBlock: number;
  // risk / margins
  wRiskStun: number;
  wLocalSupremacy: number;
  // distances / radii
  releaseDist: number;   // base release distance
  bustMin: number;       // >= 900
  bustMax: number;       // <= 1760
  stunRange: number;     // ~1760–1850
  // radar timings
  radarEarlyTurn: number;
  radarMidTurn: number;
};

export const DEFAULT_WEIGHTS: Weights = {
  wHunt: 1.0,
  wReturn: 1.0,
  wExplore: 0.7,
  wIntercept: 0.8,
  wBlock: 0.6,
  wRiskStun: 0.6,
  wLocalSupremacy: 0.8,
  releaseDist: 1500,
  bustMin: 900,
  bustMax: 1760,
  stunRange: 1780,
  radarEarlyTurn: 2,
  radarMidTurn: 60,
};

export const BOUNDS: Record<keyof Weights, {min:number,max:number}> = {
  wHunt: {min:0,max:3},
  wReturn: {min:0,max:3},
  wExplore: {min:0,max:3},
  wIntercept:{min:0,max:3},
  wBlock:{min:0,max:3},
  wRiskStun:{min:0,max:3},
  wLocalSupremacy:{min:0,max:3},
  releaseDist:{min:1300,max:1800},
  bustMin:{min:900,max:1000},
  bustMax:{min:1700,max:1760},
  stunRange:{min:1700,max:1850},
  radarEarlyTurn:{min:1,max:6},
  radarMidTurn:{min:30,max:90},
};
