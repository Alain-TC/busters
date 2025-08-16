/** @param {import('@busters/shared').AgentContext} ctx @param {import('@busters/shared').Observation} obs */
export function act(ctx, obs) {
  // Carrying? head home
  if (obs.self.carrying !== undefined) {
    return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }
  const g = obs.ghostsVisible[0];
  if (g) {
    if (g.range >= 900 && g.range <= 1760) return { type: 'BUST', ghostId: g.id };
    return { type: 'MOVE', x: g.x, y: g.y };
  }
  // Occasionally pop RADAR if available and random says so
  if (!obs.self.radarUsed && Math.random() < 0.05) return { type: 'RADAR' };
  // Wander
  const rx = Math.floor(Math.random() * ctx.mapW);
  const ry = Math.floor(Math.random() * ctx.mapH);
  return { type: 'MOVE', x: rx, y: ry };
}
export const meta = { name: 'RandomBot', version: '0.1.0' };
