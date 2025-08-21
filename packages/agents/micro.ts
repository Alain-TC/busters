/** Tiny, fast "micro-rollout" heuristics used inside assignment scores. */
/** No external deps; keep everything numerically cheap. */

type Pt = { x: number; y: number };
type Ent = { id: number; x: number; y: number; state?: number; range?: number };

const SPEED = 800; // buster speed per turn

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
  const { me, ghost, enemies, bustMin, bustMax, stunRange, canStunMe } = opts;
  const me1 = step(me, ghost);
  const enemies1 = enemies.map(e => step(e, ghost));
  const r = dist(me1.x, me1.y, ghost.x, ghost.y);
  const near = enemies1.filter(e => dist(e.x, e.y, ghost.x, ghost.y) <= 2200);
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

/** Value for blocking an enemy carrier before they can RELEASE near my base. */
export function releaseBlockDelta(opts: {
  blocker: Ent; carrier: Ent; myBase: Pt; stunRange: number;
}) {
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

