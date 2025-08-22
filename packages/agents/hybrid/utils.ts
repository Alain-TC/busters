import { clamp, dist, norm } from "../../shared/src/vec.ts";
import { PATROLS_A } from "../patrols.ts";

export const W = 16000;
export const H = 9000;
export const BUST_MIN = 900;
export const BUST_MAX = 1760;
export const STUN_CD = 20;

export const PATROLS = PATROLS_A;
export type Pt = { x: number; y: number };

export function resolveBases(ctx: { myBase?: Pt; enemyBase?: Pt }): { my: Pt; enemy: Pt } {
  const my = ctx.myBase ?? { x: 0, y: 0 };
  const enemy = ctx.enemyBase ?? { x: W - my.x, y: H - my.y };
  return { my, enemy };
}

export function spacedTarget<T extends { id: number; x: number; y: number }>(
  tune: { SPACING: number; SPACING_PUSH: number },
  me: T,
  raw: Pt,
  friends?: T[]
): Pt {
  if (!friends || friends.length <= 1) {
    const phase = ((me.id * 9301) ^ 0x9e37) & 1 ? 1 : -1;
    const [dx, dy] = norm(raw.x - me.x, raw.y - me.y);
    const px = -dy, py = dx;
    return { x: clamp(raw.x + phase * 220 * px, 0, W), y: clamp(raw.y + phase * 220 * py, 0, H) };
  }
  let nearest: T | undefined, best = Infinity;
  for (const f of friends) {
    if (f.id === me.id) continue;
    const d = dist(me.x, me.y, f.x, f.y);
    if (d < best) { best = d; nearest = f; }
  }
  if (!nearest || best >= tune.SPACING) return raw;
  const [ax, ay] = norm(me.x - nearest.x, me.y - nearest.y);
  return { x: clamp(raw.x + ax * tune.SPACING_PUSH, 0, W), y: clamp(raw.y + ay * tune.SPACING_PUSH, 0, H) };
}

export function blockerRing(
  tune: { BLOCK_RING: number },
  myBase: Pt,
  enemyBase: Pt
): Pt {
  const [vx, vy] = norm(enemyBase.x - myBase.x, enemyBase.y - myBase.y);
  return {
    x: clamp(enemyBase.x - vx * tune.BLOCK_RING, 0, W),
    y: clamp(enemyBase.y - vy * tune.BLOCK_RING, 0, H),
  };
}

export function uniqTeam<T extends { id: number }>(self: T, friends?: T[]): T[] {
  const map = new Map<number, T>();
  map.set(self.id, self);
  (friends ?? []).forEach(f => map.set(f.id, f));
  return Array.from(map.values());
}

export { clamp, dist, norm };
