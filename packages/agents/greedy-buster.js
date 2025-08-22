/** A very simple heuristic bot. */
export function act(ctx, obs) {
  if (obs.self.carrying !== undefined) {
    const dHome = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);
    if (dHome < 1400) return { type: 'RELEASE' };
    return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }
  // Stun nearest enemy if in range and off cooldown
  const enemy = obs.enemies[0];
  if (enemy && enemy.range <= 1700 && obs.self.stunCd <= 0 && (enemy.stunnedFor ?? 0) <= 0) return { type: 'STUN', busterId: enemy.id };
  const g = obs.ghostsVisible[0];
  if (g) {
    if (g.range >= 900 && g.range <= 1760) return { type: 'BUST', ghostId: g.id };
    return { type: 'MOVE', x: g.x, y: g.y };
  }
  if (!obs.self.radarUsed) return { type: 'RADAR' };
  return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
}
export const meta = { name: 'GreedyBuster', version: '0.1.0' };
