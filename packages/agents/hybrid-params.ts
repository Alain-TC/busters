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

// Default export (some loaders import default)
const HYBRID_PARAMS = { TUNE, WEIGHTS };
export default HYBRID_PARAMS;

