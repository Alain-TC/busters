import type { AgentContext, Observation, Action } from '@busters/shared';

export function act(ctx: AgentContext, obs: Observation): Action {
  const me = obs.self;

  // If carrying a ghost, head home and release near base
  if (me.carrying !== undefined) {
    const d = Math.hypot(me.x - ctx.myBase.x, me.y - ctx.myBase.y);
    if (d <= 1600) return { type: 'RELEASE' };
    return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }

  // Prioritize stunning enemies approaching our base
  const enemies = (obs.enemies || [])
    .map(e => ({ e, dMe: Math.hypot(me.x - e.x, me.y - e.y), dBase: Math.hypot(ctx.myBase.x - e.x, ctx.myBase.y - e.y) }))
    .filter(e => e.dBase <= 4000)
    .sort((a, b) => a.dMe - b.dMe)[0];
  if (enemies && enemies.dMe <= 1760 && me.stunCd <= 0) {
    return { type: 'STUN', busterId: enemies.e.id };
  }

  // Bust nearest ghost
  const ghost = (obs.ghostsVisible || [])
    .map(g => ({ g, d: Math.hypot(me.x - g.x, me.y - g.y) }))
    .sort((a, b) => a.d - b.d)[0];
  if (ghost) {
    if (ghost.d >= 900 && ghost.d <= 1760) return { type: 'BUST', ghostId: ghost.g.id };
    return { type: 'MOVE', x: ghost.g.x, y: ghost.g.y };
  }

  // Default: patrol near base
  return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
}

export const meta = { name: 'DefenderBot', version: '0.1.0' };
