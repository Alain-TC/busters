export const meta = { name: "base-camper", version: "1.0" };

/**
 * Passive base camper: heads to enemy base and busts nearby ghosts.
 * Rarely stuns; mainly serves as a stationary disruptor.
 */
export function act(ctx, obs) {
  const enemyBase = (ctx.myTeamId === 0) ? { x:16000, y:9000 } : { x:0, y:0 };
  const me = obs.self;

  // If carrying, beeline home and release near base
  if (me.carrying !== undefined) {
    const d = Math.hypot(me.x-ctx.myBase.x, me.y-ctx.myBase.y);
    if (d <= 1450) return { type:"RELEASE" };
    return { type:"MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
  }

  // Bust any ghost encountered
  const g = (obs.ghostsVisible||[]).map(g => ({g, d: Math.hypot(me.x-g.x, me.y-g.y)}))
    .sort((a,b)=>a.d-b.d)[0];
  if (g) {
    if (g.d >= 900 && g.d <= 1760) return { type:"BUST", ghostId:g.g.id };
    return { type:"MOVE", x:g.g.x, y:g.g.y };
  }

  // Default: camp enemy base
  return { type:"MOVE", x: enemyBase.x, y: enemyBase.y };
}
