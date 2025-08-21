// packages/agents/hybrid-params.ts
// -----------------------------------------------------------------------------
// Hybrid parameters (tuned by CEM).
// - The trainer can overwrite this file with new values.
// - Keep the shape (keys) stable so imports in hybrid-bot.ts never break.
// -----------------------------------------------------------------------------

export type Tune = {
  RELEASE_DIST: number;       // distance to base to RELEASE
  STUN_RANGE: number;         // max range to STUN
  RADAR1_TURN: number;        // first scheduled RADAR (buster localIdx 0)
  RADAR2_TURN: number;        // second scheduled RADAR (buster localIdx 1)
  SPACING: number;            // min friend separation before nudging
  SPACING_PUSH: number;       // push amount when too close to a friend
  BLOCK_RING: number;         // distance from enemy base center for blocker
  DEFEND_RADIUS: number;      // radius around our base that triggers DEFEND
  EXPLORE_STEP_REWARD: number;// tiny bias to avoid idling while exploring
};

export type Weights = {
  BUST_BASE: number;            // base utility for bust tasks
  BUST_RING_BONUS: number;      // bonus if on the 900–1760 ring
  BUST_ENEMY_NEAR_PEN: number;  // penalty per enemy near a ghost
  INTERCEPT_BASE: number;       // base utility for intercept tasks
  INTERCEPT_DIST_PEN: number;   // extra distance penalty for intercept
  DEFEND_BASE: number;          // base utility for defend tasks
  DEFEND_NEAR_BONUS: number;    // extra bonus if threat near base
  BLOCK_BASE: number;           // base utility for blocker tasks
  EXPLORE_BASE: number;         // base utility for explore tasks
  DIST_PEN: number;             // generic distance penalty
  SUPPORT_BASE: number;         // base utility for support-stun tasks
  SUPPORT_CONTEST_BONUS: number;// bonus if supporting a contested ghost
};

// -----------------------------------------------------------------------------
// DEFAULTS (safe, reasonable). The trainer will usually overwrite these.
// -----------------------------------------------------------------------------
export const TUNE: Tune = {
  RELEASE_DIST: 1600,
  STUN_RANGE: 1760,
  RADAR1_TURN: 2,
  RADAR2_TURN: 55,
  SPACING: 900,
  SPACING_PUSH: 280,
  BLOCK_RING: 1750,
  DEFEND_RADIUS: 3200,
  EXPLORE_STEP_REWARD: 1.0,
};

export const WEIGHTS: Weights = {
  BUST_BASE: 12,
  BUST_RING_BONUS: 5,
  BUST_ENEMY_NEAR_PEN: 3,
  INTERCEPT_BASE: 14,
  INTERCEPT_DIST_PEN: 0.004,
  DEFEND_BASE: 10,
  DEFEND_NEAR_BONUS: 6,
  BLOCK_BASE: 6,
  EXPLORE_BASE: 4,
  DIST_PEN: 0.003,
  SUPPORT_BASE: 11,
  SUPPORT_CONTEST_BONUS: 3,
};

// Default export (some loaders import default)
const HYBRID_PARAMS = { TUNE, WEIGHTS };
export default HYBRID_PARAMS;

