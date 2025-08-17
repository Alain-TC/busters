/** Auto-generated single-file bot from genome */
export const meta = { name: "EvolvedBot", version: "ga" };
export function act(ctx, obs) {
  if (obs.self.carrying !== undefined) {
    const d = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);
    if (d <= 1600) return { type: "RELEASE" };
    return { type: "MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
  }
  const enemy = obs.enemies?.[0];
  if (enemy && enemy.range <= 1777 && obs.self.stunCd <= 0) return { type: "STUN", busterId: enemy.id };
  const ghost = obs.ghostsVisible?.[0];
  if (ghost) {
    if (ghost.range >= 900 && ghost.range <= 1760) return { type: "BUST", ghostId: ghost.id };
    return { type: "MOVE", x: ghost.x, y: ghost.y };
  }
  if (!obs.self.radarUsed && obs.tick >= 18) return { type: "RADAR" };
  return { type: "MOVE", x: ctx.myBase.x, y: ctx.myBase.y };
}