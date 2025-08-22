import type { AgentContext, Observation, Action } from '@busters/shared';

const WAYPOINTS = [
  { x: 0, y: 0 },
  { x: 16000, y: 0 },
  { x: 16000, y: 9000 },
  { x: 0, y: 9000 },
];

export function act(ctx: AgentContext, obs: Observation): Action {
  const me = obs.self;

  // Return home if carrying a ghost
  if (me.carrying !== undefined) {
    const d = Math.hypot(me.x - ctx.myBase.x, me.y - ctx.myBase.y);
    if (d <= 1500) return { type: 'RELEASE' };
    return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }

  // Stun closest enemy in range
  const enemy = (obs.enemies || [])
    .map(e => ({ e, d: Math.hypot(me.x - e.x, me.y - e.y) }))
    .sort((a, b) => a.d - b.d)[0];
  if (enemy && enemy.d <= 1760 && me.stunCd <= 0) {
    return { type: 'STUN', busterId: enemy.e.id };
  }

  // Chase or bust nearest ghost
  const ghost = (obs.ghostsVisible || [])
    .map(g => ({ g, d: Math.hypot(me.x - g.x, me.y - g.y) }))
    .sort((a, b) => a.d - b.d)[0];
  if (ghost) {
    if (ghost.d >= 900 && ghost.d <= 1760) return { type: 'BUST', ghostId: ghost.g.id };
    return { type: 'MOVE', x: ghost.g.x, y: ghost.g.y };
  }

  // Pop RADAR first chance, otherwise patrol waypoints
  if (!me.radarUsed) return { type: 'RADAR' };
  const wp = WAYPOINTS[Math.floor(obs.tick / 40) % WAYPOINTS.length];
  return { type: 'MOVE', x: wp.x, y: wp.y };
}

export const meta = { name: 'ScoutBot', version: '0.1.0' };
