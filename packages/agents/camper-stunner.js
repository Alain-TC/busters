export const meta = { name: "camper-stunner", version: "1.0" };

/**
 * Base camper: rushes enemy base, tries to stun carriers near it,
 * then escorts stolen ghosts by blocking the path.
 */
export function act(ctx, obs) {
  const enemyBase = (ctx.myTeamId === 0) ? { x:16000, y:9000 } : { x:0, y:0 };
  const me = obs.self;

  // If carrying, go home & release near base
  if (me.carrying !== undefined) {
    const d = Math.hypot(me.x-ctx.myBase.x, me.y-ctx.myBase.y);
    if (d <= 1450) return { type:"RELEASE" };
    return { type:"MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
  }

  // Opportunistic stun near enemy base
  const nearEnemy = (obs.enemies||[]).map(e => ({e, d: Math.hypot(me.x-e.x, me.y-e.y)}))
    .sort((a,b)=>a.d-b.d)[0];
  if (nearEnemy && nearEnemy.d <= 1760 && me.stunCd <= 0 && (nearEnemy.e.stunnedFor ?? 0) <= 0) {
    return { type:"STUN", busterId: nearEnemy.e.id };
  }

  // Bust if any ghost around base vicinity
  const g = (obs.ghostsVisible||[]).map(g => ({g, d: Math.hypot(me.x-g.x, me.y-g.y)}))
    .sort((a,b)=>a.d-b.d)[0];
  if (g) {
    if (g.d >= 900 && g.d <= 1760) return { type:"BUST", ghostId:g.g.id };
    return { type:"MOVE", x:g.g.x, y:g.g.y };
  }

  // Default: camp enemy base
  return { type:"MOVE", x: enemyBase.x, y: enemyBase.y };
}
