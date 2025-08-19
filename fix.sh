cat > packages/agents/hybrid-bot.ts <<'TS'
/** EVOL2 — Hybrid with tiny POMDP scaffolding
 *  - Uses a coarse visit grid for frontier exploration under fog
 *  - Tracks enemy last-seen (pos, carrying, stunCd)
 *  - Safe RADAR schedule (staggered), ring busting, carry→release
 */

export const meta = { name: "HybridBaseline", version: "1" };

import { HybridState, getState, Pt } from "./lib/state";

const MAP_W = 16000, MAP_H = 9000;
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function dist(a: Pt, b: Pt) { return Math.hypot(a.x - b.x, a.y - b.y); }
function clampPt(p: Pt): Pt { return { x: clamp(p.x, 0, MAP_W), y: clamp(p.y, 0, MAP_H) }; }

function ringPoint(me: Pt, to: Pt, r: number): Pt {
  const dx = me.x - to.x, dy = me.y - to.y;
  const L = Math.hypot(dx, dy) || 1;
  return clampPt({ x: to.x + (dx / L) * r, y: to.y + (dy / L) * r });
}

function pickGhost(ghosts?: any[]) {
  if (!ghosts || ghosts.length === 0) return undefined;
  return ghosts.slice().sort((a, b) => a.range - b.range)[0];
}

function pickStunTarget(enemies?: any[], maxRange = 1760) {
  if (!enemies || enemies.length === 0) return undefined;
  const inRange = enemies.filter(e => e.range !== undefined && e.range <= maxRange);
  const carriers = inRange.filter(e => e.carrying !== undefined);
  return (carriers[0] ?? inRange[0]);
}

export function act(ctx: any, obs: any) {
  const self = obs.self as Pt & { id: number; stunCd: number; radarUsed: boolean; carrying?: any };
  const myBase: Pt = ctx?.myBase ?? { x: 0, y: 0 };

  // State (visits + enemy last-seen)
  const S: HybridState = getState(ctx, obs);
  S.touchVisit(self);
  S.trackEnemies(obs.enemies, obs.tick);

  // 1) If carrying, return and release
  if (self.carrying !== undefined) {
    const d = dist(self, myBase);
    if (d <= 1520) return { type: "RELEASE" }; // 1600 safety minus a small margin
    return { type: "MOVE", x: myBase.x, y: myBase.y };
  }

  // 2) STUN: enemy carrier (or any in range) when ready
  const stunTarget = pickStunTarget(obs.enemies, 1760);
  if (stunTarget && (self as any).stunCd <= 0) {
    return { type: "STUN", busterId: stunTarget.id };
  }

  // 3) Ghost: bust inside ring; else move to ~1200 ring
  const g = pickGhost(obs.ghostsVisible);
  if (g) {
    if (g.range >= 900 && g.range <= 1760) {
      return { type: "BUST", ghostId: g.id };
    } else {
      const p = ringPoint(self, g, 1200);
      return { type: "MOVE", x: p.x, y: p.y };
    }
  }

  // 4) RADAR: stagger usage (avoid everyone same turn)
  if (!(self as any).radarUsed) {
    // two waves: early (t=2/3) and mid (t=30/31), split by id parity
    if ((obs.tick === 2 || obs.tick === 3) && (self as any).id % 2 === 0) {
      return { type: "RADAR" };
    }
    if ((obs.tick === 30 || obs.tick === 31) && (self as any).id % 2 === 1) {
      return { type: "RADAR" };
    }
  }

  // 5) Frontier exploration under fog (least-visited cell center)
  const tgt = S.bestFrontier();
  return { type: "MOVE", x: tgt.x, y: tgt.y };
}
TS
