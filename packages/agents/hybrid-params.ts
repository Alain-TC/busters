// packages/agents/hybrid-params.ts
// -----------------------------------------------------------------------------
// Hybrid parameters (tuned by CMA-ES).
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
  SUPPORT_BASE: number;         // base utility for support tasks
  DIST_PEN: number;             // generic distance penalty
  CARRY_BASE: number;           // base utility for carry tasks
  CARRY_ENEMY_NEAR_PEN: number; // penalty per enemy near carrier path
};

// -----------------------------------------------------------------------------
// DEFAULTS (safe, reasonable). The trainer will usually overwrite these.
// -----------------------------------------------------------------------------
export const TUNE: Tune = {
  RELEASE_DIST: 1632,
  STUN_RANGE: 1834,
  RADAR1_TURN: 2,
  RADAR2_TURN: 55,
  SPACING: 954,
  SPACING_PUSH: 289,
  BLOCK_RING: 1670,
  DEFEND_RADIUS: 3341,
  EXPLORE_STEP_REWARD: 0.9676032069672904,
};

export const WEIGHTS: Weights = {
  BUST_BASE: 12,
  BUST_RING_BONUS: 7,
  BUST_ENEMY_NEAR_PEN: 6,
  INTERCEPT_BASE: 16,
  INTERCEPT_DIST_PEN: 0.006268810020792386,
  DEFEND_BASE: 10,
  DEFEND_NEAR_BONUS: 4,
  BLOCK_BASE: 5,
  EXPLORE_BASE: 3,
  SUPPORT_BASE: 8,
  DIST_PEN: 0.0024519620026867764,
  CARRY_BASE: 14,
  CARRY_ENEMY_NEAR_PEN: 5,
};

// Default export (some loaders import default)
const HYBRID_PARAMS = { TUNE, WEIGHTS };
export default HYBRID_PARAMS;

