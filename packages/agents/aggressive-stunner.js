export const meta = { name: "aggressive-stunner", version: "1.0" };

/**
 * Aggressive stunner: hunts enemies first, stunning when possible,
 * otherwise chases nearest enemy or ghost.
 */
export function act(ctx, obs) {
  const me = obs.self;

  // If carrying, return to base
  if (me.carrying !== undefined) {
    const d = Math.hypot(me.x-ctx.myBase.x, me.y-ctx.myBase.y);
    if (d <= 1450) return { type:"RELEASE" };
    return { type:"MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
  }

  // Prioritize enemy busters
  const enemy = (obs.enemies||[]).map(e => ({e, d: Math.hypot(me.x-e.x, me.y-e.y)}))
    .sort((a,b)=>a.d-b.d)[0];
  if (enemy) {
    if (enemy.d <= 1760 && me.stunCd <= 0) {
      return { type:"STUN", busterId: enemy.e.id };
    }
    return { type:"MOVE", x: enemy.e.x, y: enemy.e.y };
  }

  // Otherwise hunt ghosts
  const g = (obs.ghostsVisible||[]).map(g => ({g, d: Math.hypot(me.x-g.x, me.y-g.y)}))
    .sort((a,b)=>a.d-b.d)[0];
  if (g) {
    if (g.d >= 900 && g.d <= 1760) return { type:"BUST", ghostId:g.g.id };
    return { type:"MOVE", x:g.g.x, y:g.g.y };
  }

  // Mild scouting toward center
  return { type:"MOVE", x: 8000, y: 4500 };
}
