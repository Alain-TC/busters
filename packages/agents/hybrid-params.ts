// packages/agents/hybrid-params.ts
// -----------------------------------------------------------------------------
// Hybrid parameters (tuned by CMA-ES).
// - The trainer can overwrite this file with new values.
// - Keep the shape (keys) stable so imports in hybrid-bot.ts never break.
// -----------------------------------------------------------------------------

export type Tune = {
  RELEASE_DIST: number;       // release when dHome < min(RELEASE_DIST, BASE_SCORE_RADIUS); 1500–2000 units
  STUN_RANGE: number;         // max range to STUN in game units; typically 1750–2000
  RADAR1_TURN: number;        // first scheduled RADAR (buster localIdx 0); usually turn 1–10
  RADAR2_TURN: number;        // second scheduled RADAR (buster localIdx 1); usually turn 30–80
  SPACING: number;            // min friend separation before nudging; 700–1000 units
  SPACING_PUSH: number;       // push amount when too close to a friend; 200–400 units
  BLOCK_RING: number;         // distance from enemy base center for blocker; ~1500–2000 units
  DEFEND_RADIUS: number;      // radius around our base that triggers DEFEND; 3000–4000 units
  EXPLORE_STEP_REWARD: number;// tiny bias to avoid idling while exploring; 0.9–1.0 scalar
};

export type Weights = {
  BUST_BASE: number;            // base utility for bust tasks; ~5–20 points
  BUST_RING_BONUS: number;      // bonus if on the 900–1760 ring; ~5–10 points
  BUST_ENEMY_NEAR_PEN: number;  // penalty per enemy near a ghost; ~2–8 points
  INTERCEPT_BASE: number;       // base utility for intercept tasks; ~10–20 points
  INTERCEPT_DIST_PEN: number;   // extra distance penalty for intercept; ~0.005–0.01 per unit
  DEFEND_BASE: number;          // base utility for defend tasks; ~8–15 points
  DEFEND_NEAR_BONUS: number;    // extra bonus if threat near base; ~4–8 points
  BLOCK_BASE: number;           // base utility for blocker tasks; ~5–8 points
  EXPLORE_BASE: number;         // base utility for explore tasks; ~3–6 points
  SUPPORT_BASE: number;         // base utility for support tasks; ~5–10 points
  DIST_PEN: number;             // generic distance penalty; ~0.001–0.003 per unit
  CARRY_BASE: number;           // base utility for carry tasks; ~10–20 points
  CARRY_ENEMY_NEAR_PEN: number; // penalty per enemy near carrier path; ~3–6 points
};

// -----------------------------------------------------------------------------
// DEFAULTS (safe, reasonable). The trainer will usually overwrite these.
// -----------------------------------------------------------------------------
export const TUNE: Tune = {
  RELEASE_DIST: 1628,
  STUN_RANGE: 1810,
  RADAR1_TURN: 1,
  RADAR2_TURN: 58,
  SPACING: 900,
  SPACING_PUSH: 300,
  BLOCK_RING: 1680,
  DEFEND_RADIUS: 3350,
  EXPLORE_STEP_REWARD: 0.98,
};

export const WEIGHTS: Weights = {
  BUST_BASE: 13,
  BUST_RING_BONUS: 8,
  BUST_ENEMY_NEAR_PEN: 5,
  INTERCEPT_BASE: 15,
  INTERCEPT_DIST_PEN: 0.006,
  DEFEND_BASE: 11,
  DEFEND_NEAR_BONUS: 5,
  BLOCK_BASE: 6,
  EXPLORE_BASE: 4,
  SUPPORT_BASE: 7,
  DIST_PEN: 0.0024,
  CARRY_BASE: 15,
  CARRY_ENEMY_NEAR_PEN: 4,
};

// Order in which params are mapped to/from vectors
export const TUNE_KEYS = [
  "RELEASE_DIST",
  "STUN_RANGE",
  "RADAR1_TURN",
  "RADAR2_TURN",
  "SPACING",
  "SPACING_PUSH",
  "BLOCK_RING",
  "DEFEND_RADIUS",
  "EXPLORE_STEP_REWARD",
] as const;

export const WEIGHT_KEYS = [
  "BUST_BASE",
  "BUST_RING_BONUS",
  "BUST_ENEMY_NEAR_PEN",
  "INTERCEPT_BASE",
  "INTERCEPT_DIST_PEN",
  "DEFEND_BASE",
  "DEFEND_NEAR_BONUS",
  "BLOCK_BASE",
  "EXPLORE_BASE",
  "SUPPORT_BASE",
  "DIST_PEN",
  "CARRY_BASE",
  "CARRY_ENEMY_NEAR_PEN",
] as const;

export const HYBRID_ORDER = [...TUNE_KEYS, ...WEIGHT_KEYS];
export type HybridKey = (typeof HYBRID_ORDER)[number];

// Bounds for each parameter when clamping vectors
export const HYBRID_BOUNDS: Record<HybridKey, { lo: number; hi: number; round?: boolean }> = {
  RELEASE_DIST: { lo: 1500, hi: 2000, round: true },
  STUN_RANGE: { lo: 1750, hi: 2000, round: true },
  RADAR1_TURN: { lo: 1, hi: 10, round: true },
  RADAR2_TURN: { lo: 30, hi: 80, round: true },
  SPACING: { lo: 700, hi: 1000, round: true },
  SPACING_PUSH: { lo: 200, hi: 400, round: true },
  BLOCK_RING: { lo: 1500, hi: 2000, round: true },
  DEFEND_RADIUS: { lo: 3000, hi: 4000, round: true },
  EXPLORE_STEP_REWARD: { lo: 0.9, hi: 1.0 },
  BUST_BASE: { lo: 5, hi: 20 },
  BUST_RING_BONUS: { lo: 5, hi: 10 },
  BUST_ENEMY_NEAR_PEN: { lo: 2, hi: 8 },
  INTERCEPT_BASE: { lo: 10, hi: 20 },
  INTERCEPT_DIST_PEN: { lo: 0.005, hi: 0.01 },
  DEFEND_BASE: { lo: 8, hi: 15 },
  DEFEND_NEAR_BONUS: { lo: 4, hi: 8 },
  BLOCK_BASE: { lo: 5, hi: 8 },
  EXPLORE_BASE: { lo: 3, hi: 6 },
  SUPPORT_BASE: { lo: 5, hi: 10 },
  DIST_PEN: { lo: 0.001, hi: 0.003 },
  CARRY_BASE: { lo: 10, hi: 20 },
  CARRY_ENEMY_NEAR_PEN: { lo: 3, hi: 6 },
};

export const DEFAULT_HYBRID_PARAMS: Record<HybridKey, number> = {
  ...TUNE,
  ...WEIGHTS,
};

function intsForTurns(tune: Tune) {
  tune.RADAR1_TURN = Math.max(1, Math.round(tune.RADAR1_TURN ?? TUNE.RADAR1_TURN));
  tune.RADAR2_TURN = Math.max(tune.RADAR1_TURN + 1, Math.round(tune.RADAR2_TURN ?? TUNE.RADAR2_TURN));
  const roundKeys: Array<keyof Tune> = [
    "RELEASE_DIST",
    "STUN_RANGE",
    "SPACING",
    "SPACING_PUSH",
    "BLOCK_RING",
    "DEFEND_RADIUS",
  ];
  for (const k of roundKeys) tune[k] = Math.round(tune[k]);
}

export function fromVector(vec: number[]): { TUNE: Tune; WEIGHTS: Weights } {
  const need = HYBRID_ORDER.length;
  if (vec.length < need) throw new Error(`Vector length ${vec.length} < ${need}`);
  const t: Tune = { ...TUNE };
  const w: Weights = { ...WEIGHTS };
  let i = 0;
  for (const k of TUNE_KEYS) t[k] = vec[i++];
  for (const k of WEIGHT_KEYS) w[k] = vec[i++];
  intsForTurns(t);
  return { TUNE: t, WEIGHTS: w };
}

// Default export (some loaders import default)
const HYBRID_PARAMS = { TUNE, WEIGHTS };
export default HYBRID_PARAMS;

