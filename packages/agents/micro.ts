/** Tiny, fast "micro-rollout" heuristics used inside assignment scores. */
/** No external deps; keep everything numerically cheap. */

// Use shared constants via relative import to avoid package lookup
import { RULES } from "../shared/src/constants.ts";

const { performance } = globalThis;

export const microPerf = {
  twoTurnMs: 0,
  twoTurnCalls: 0,
  interceptMs: 0,
  interceptCalls: 0,
  ejectMs: 0,
  ejectCalls: 0,
};
export const MICRO_BUDGET_MS = 0.5;
export function resetMicroPerf() {
  microPerf.twoTurnMs = 0;
  microPerf.twoTurnCalls = 0;
  microPerf.interceptMs = 0;
  microPerf.interceptCalls = 0;
  microPerf.ejectMs = 0;
  microPerf.ejectCalls = 0;
  twoTurnContestCache.clear();
  twoTurnInterceptCache.clear();
  twoTurnEjectCache.clear();
}
export function microOverBudget() {
  return microPerf.twoTurnMs + microPerf.interceptMs + microPerf.ejectMs >= MICRO_BUDGET_MS;
}

const twoTurnContestCache = new Map<string, number>();
const twoTurnInterceptCache = new Map<string, number>();
const twoTurnEjectCache = new Map<string, number>();

const SPEED = RULES.MOVE_SPEED; // buster speed per turn
const ENEMY_NEAR_RADIUS = RULES.VISION;

type Pt = { x: number; y: number };
type Ent = { id: number; x: number; y: number; state?: number; range?: number };

function dist(ax: number, ay: number, bx: number, by: number) {
  return Math.hypot(ax - bx, ay - by);
}

/** Advance point p one turn toward q at normal speed. */
function step(p: Pt, q: Pt): Pt {
  const dx = q.x - p.x, dy = q.y - p.y;
  const d = Math.hypot(dx, dy);
  if (d <= SPEED) return { x: q.x, y: q.y };
  return { x: p.x + (dx / d) * SPEED, y: p.y + (dy / d) * SPEED };
}

/** Return a point on the enemy->myBase line where I can plausibly meet/beat the enemy. */
export function estimateInterceptPoint(me: Pt, enemy: Pt, myBase: Pt): Pt {
  const ex = enemy.x, ey = enemy.y;
  const bx = myBase.x, by = myBase.y;
  const dx = bx - ex, dy = by - ey;
  const L = Math.hypot(dx, dy) || 1;
  // Sample a few waypoints along the carrier path (cheap 1D search)
  const ts = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9];
  let best: Pt = { x: ex + dx * 0.6, y: ey + dy * 0.6 }; // fallback ~60% to base
  for (const t of ts) {
    const px = ex + dx * t, py = ey + dy * t;
    const tMe = dist(me.x, me.y, px, py) / SPEED;
    const tEn = (L * t) / SPEED; // time for enemy to reach p
    if (tMe <= tEn) {
      best = { x: Math.round(px), y: Math.round(py) };
      break;
    }
  }
  return best;
}

/** Advantage of a stun duel if both are close. Positive favors me. */
export function duelStunDelta(opts: {
  me: Ent; enemy: Ent; canStunMe: boolean; canStunEnemy: boolean; stunRange: number;
}) {
  if (microOverBudget()) return 0;
  const { me, enemy, canStunMe, canStunEnemy, stunRange } = opts;
  const me1 = step(me, enemy);
  const enemy1 = step(enemy, me);
  const r = dist(me1.x, me1.y, enemy1.x, enemy1.y);
  if (r > stunRange) return 0;
  if (canStunMe && !canStunEnemy) return +1.0;     // I win the duel now
  if (!canStunMe && canStunEnemy) return -1.0;     // I lose the duel now
  if (canStunMe && canStunEnemy) return +0.15;     // slight edge for acting proactively
  return 0;
}

/** Value adjustment for busting when enemies are around a ghost. */
export function contestedBustDelta(opts: {
  me: Ent; ghost: Pt & { id?: number }; enemies: Ent[]; bustMin: number; bustMax: number; stunRange: number; canStunMe: boolean;
}) {
  if (microOverBudget()) return 0;
  const { me, ghost, enemies, bustMin, bustMax, stunRange, canStunMe } = opts;
  const me1 = step(me, ghost);
  const enemies1 = enemies.map(e => step(e, ghost));
  const r = dist(me1.x, me1.y, ghost.x, ghost.y);
  const near = enemies1.filter(e => dist(e.x, e.y, ghost.x, ghost.y) <= ENEMY_NEAR_RADIUS);
  if (near.length === 0) return (r >= bustMin && r <= bustMax) ? +0.25 : 0;

  let delta = 0;
  // Being on the ring is good, but danger increases with nearby enemies.
  if (r >= bustMin && r <= bustMax) delta += +0.25;
  delta += -0.35 * near.length; // risk penalty per nearby enemy

  // If at least one enemy is in stun range and I *can’t* stun now, penalize a bit more
  const enemyInStun = near.some(e => dist(me1.x, me1.y, e.x, e.y) <= stunRange);
  if (enemyInStun && !canStunMe) delta -= 0.3;

  return delta;
}

/** Extra lookahead: simulate two alternating moves and re-evaluate bust/duel deltas. */
export function twoTurnContestDelta(opts: {
  me: Ent;
  enemy: Ent;
  ghost?: Pt & { id?: number };
  bustMin: number;
  bustMax: number;
  stunRange: number;
  canStunMe: boolean;
  canStunEnemy: boolean;
}) {
  microPerf.twoTurnCalls++;
  if (microOverBudget()) return 0;
  const { me, enemy, ghost, bustMin, bustMax, stunRange, canStunMe, canStunEnemy } = opts;
  // Manual key concatenation to avoid JSON.stringify allocations
  const key =
    me.id + '|' + me.x + '|' + me.y + '|' +
    enemy.id + '|' + enemy.x + '|' + enemy.y + '|' +
    (ghost ? (ghost.id ?? 0) + '|' + ghost.x + '|' + ghost.y : '0|0|0') + '|' +
    bustMin + '|' + bustMax + '|' + stunRange + '|' +
    (canStunMe ? 1 : 0) + '|' + (canStunEnemy ? 1 : 0);
  const cached = twoTurnContestCache.get(key);
  if (cached !== undefined) return cached;
  const t0 = performance.now();
  const me1 = step(me, ghost ?? enemy);
  const enemy1 = step(enemy, ghost ?? me);
  let delta = duelStunDelta({
    me: me1,
    enemy: enemy1,
    canStunMe,
    canStunEnemy,
    stunRange,
  });
  if (ghost) {
    delta += contestedBustDelta({
      me: me1,
      ghost,
      enemies: [enemy1],
      bustMin,
      bustMax,
      stunRange,
      canStunMe,
    });
  }
  microPerf.twoTurnMs += performance.now() - t0;
  twoTurnContestCache.set(key, delta);
  return delta;
}

/** Advantage of beating an enemy to an intercept point along its path to my base. */
export function interceptDelta(opts: { me: Ent; enemy: Ent; myBase: Pt }) {
  if (microOverBudget()) return 0;
  const { me, enemy, myBase } = opts;
  const P = estimateInterceptPoint(me, enemy, myBase);
  const tMe = dist(me.x, me.y, P.x, P.y) / SPEED;
  const tEn = dist(enemy.x, enemy.y, P.x, P.y) / SPEED;
  return (tEn - tMe) * 0.2;
}

/** Two-turn lookahead variant for intercepting an enemy carrier. */
export function twoTurnInterceptDelta(opts: {
  me: Ent;
  enemy: Ent;
  myBase: Pt;
  stunRange: number;
  canStunMe: boolean;
  canStunEnemy: boolean;
}) {
  microPerf.interceptCalls++;
  if (microOverBudget()) return 0;
  const { me, enemy, myBase, stunRange, canStunMe, canStunEnemy } = opts;
  const key =
    me.id + '|' + me.x + '|' + me.y + '|' +
    enemy.id + '|' + enemy.x + '|' + enemy.y + '|' +
    myBase.x + '|' + myBase.y + '|' + stunRange + '|' +
    (canStunMe ? 1 : 0) + '|' + (canStunEnemy ? 1 : 0);
  const cached = twoTurnInterceptCache.get(key);
  if (cached !== undefined) return cached;
  const t0 = performance.now();
  const P = estimateInterceptPoint(me, enemy, myBase);
  const me1 = step(me, P);
  const enemy1 = step(enemy, myBase);
  let delta = interceptDelta({ me: me1, enemy: enemy1, myBase });
  delta += duelStunDelta({ me: me1, enemy: enemy1, canStunMe, canStunEnemy, stunRange });
  microPerf.interceptMs += performance.now() - t0;
  twoTurnInterceptCache.set(key, delta);
  return delta;
}

/** Value for blocking an enemy carrier before they can RELEASE near my base. */
export function releaseBlockDelta(opts: {
  blocker: Ent; carrier: Ent; myBase: Pt; stunRange: number;
}) {
  if (microOverBudget()) return 0;
  const { blocker, carrier, myBase, stunRange } = opts;
  // project both one step forward
  const carrier1 = step(carrier, myBase);
  const dCarrierToBase = dist(carrier1.x, carrier1.y, myBase.x, myBase.y);
  // pick a meet point ~ one ring outside release distance
  const RELEASE_DIST = 1600;
  const need = Math.max(0, dCarrierToBase - (RELEASE_DIST + 150));
  const ux = (myBase.x - carrier1.x), uy = (myBase.y - carrier1.y);
  const L = Math.hypot(ux, uy) || 1;
  const px = carrier1.x + (ux / L) * need, py = carrier1.y + (uy / L) * need;

  const blocker1 = step(blocker, { x: px, y: py });
  const tMe = dist(blocker1.x, blocker1.y, px, py) / SPEED;
  const tEn = need / SPEED;

  // If I arrive significantly earlier, good block; if later by a lot, bad
  const lead = tEn - tMe;
  let delta = 0;
  if (lead < -1.0) delta -= 0.6;
  else if (lead > +0.5) delta += 0.6;

  // extra bonus if that intercept point is within stun range of carrier path
  const dr = dist(blocker1.x, blocker1.y, px, py);
  if (dr <= stunRange + 200) delta += 0.25;

  return delta;
}

/**
 * Heuristic value for ejecting a carried ghost toward some point.
 * Rewards progress toward base and slight bonus if an ally is nearer
 * to the landing spot than the ejecting buster (handoff).
 */
export function ejectDelta(opts: { me: Ent; target: Pt; myBase: Pt; ally?: Ent }) {
  if (microOverBudget()) return 0;
  const { me, target, myBase, ally } = opts;
  const before = dist(me.x, me.y, myBase.x, myBase.y);
  const after = dist(target.x, target.y, myBase.x, myBase.y);
  // progress toward base scaled to small heuristic range
  let delta = (before - after) * 0.001;
  if (ally) {
    const meTo = dist(me.x, me.y, target.x, target.y);
    const allyTo = dist(ally.x, ally.y, target.x, target.y);
    if (allyTo < meTo) delta += 0.25;
  }
  return delta;
}

/** Two-turn lookahead for ejecting a ghost and checking enemy interception risk. */
export function twoTurnEjectDelta(opts: {
  me: Ent;
  enemy: Ent;
  target: Pt;
  myBase: Pt;
  stunRange: number;
  canStunEnemy: boolean;
}) {
  microPerf.ejectCalls++;
  if (microOverBudget()) return 0;
  const { me, enemy, target, myBase, stunRange, canStunEnemy } = opts;
  const key =
    me.id + '|' + me.x + '|' + me.y + '|' +
    enemy.id + '|' + enemy.x + '|' + enemy.y + '|' +
    target.x + '|' + target.y + '|' +
    myBase.x + '|' + myBase.y + '|' + stunRange + '|' +
    (canStunEnemy ? 1 : 0);
  const cached = twoTurnEjectCache.get(key);
  if (cached !== undefined) return cached;
  const t0 = performance.now();
  const me1 = step(me, target);
  const enemy1 = step(enemy, target);
  let delta = ejectDelta({ me: me1, target, myBase });
  const r = dist(enemy1.x, enemy1.y, target.x, target.y);
  if (r <= stunRange && canStunEnemy) delta -= 0.5;
  microPerf.ejectMs += performance.now() - t0;
  twoTurnEjectCache.set(key, delta);
  return delta;
}

/** Simple additive scoring helper for candidate actions. */
export type CandidateScore = { base: number; deltas?: number[] };
export function scoreCandidate(c: CandidateScore): number {
  const micro = c.deltas ? c.deltas.reduce((s, v) => s + v, 0) : 0;
  return c.base + micro;
}

