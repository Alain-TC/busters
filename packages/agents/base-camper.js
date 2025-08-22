export const meta = { name: "base-camper", version: "1.0" };

/**
 * Simple base camper: rushes enemy base and waits to stun carriers.
 * Ignores ghosts unless carrying a ghost home.
 */
export function act(ctx, obs) {
  const me = obs.self;
  const enemyBase = ctx.myTeamId === 0 ? { x:16000, y:9000 } : { x:0, y:0 };

  // If carrying, return home and release near base
  if (me.carrying !== undefined) {
    const d = Math.hypot(me.x - ctx.myBase.x, me.y - ctx.myBase.y);
    if (d <= 1500) return { type: "RELEASE" };
    return { type: "MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
  }

  // Stun enemies that get too close
  const enemy = (obs.enemies || [])
    .map(e => ({ e, d: Math.hypot(me.x - e.x, me.y - e.y) }))
    .sort((a, b) => a.d - b.d)[0];
  if (enemy && enemy.d <= 1760 && me.stunCd <= 0) {
    return { type: "STUN", busterId: enemy.e.id };
  }

  // Default: camp the enemy base
  return { type: "MOVE", x: enemyBase.x, y: enemyBase.y };
}
