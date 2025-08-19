/** EVOL2 — minimal shared state for the hybrid bot.
 *  - Coarse visit grid for frontier-style exploration under fog
 *  - Enemy last-seen tracking (pos, tick, carrying, stunCd)
 *  Keep it tiny and robust; we’ll extend later (ghost probs, priors, etc.).
 */

import { MAP_W as MAP_W_CONST, MAP_H as MAP_H_CONST } from "@busters/shared";

export type Pt = { x: number; y: number };

const MAP_W = MAP_W_CONST - 1, MAP_H = MAP_H_CONST - 1; // safe defaults
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function centerOfCell(cx: number, cy: number, cellW: number, cellH: number): Pt {
  return { x: cx * cellW + cellW / 2, y: cy * cellH + cellH / 2 };
}

type EnemySeen = {
  id: number;
  last: Pt;
  lastTick: number;
  carrying: boolean;
  stunCd: number | undefined;
};

export class HybridState {
  // Coarse grid (defaults 8x5) for coverage; counts visits
  readonly cols: number;
  readonly rows: number;
  readonly visits: number[];
  readonly cellW: number;
  readonly cellH: number;

  // Enemy last-seen
  enemies = new Map<number, EnemySeen>();

  constructor(bounds?: { w?: number; h?: number }, cols = 8, rows = 5) {
    const W = bounds?.w ?? MAP_W;
    const H = bounds?.h ?? MAP_H;
    this.cols = cols;
    this.rows = rows;
    this.cellW = W / cols;
    this.cellH = H / rows;
    this.visits = Array(cols * rows).fill(0);
  }

  private idxFromPoint(p: Pt): number {
    const cx = clamp(Math.floor(p.x / this.cellW), 0, this.cols - 1);
    const cy = clamp(Math.floor(p.y / this.cellH), 0, this.rows - 1);
    return cy * this.cols + cx;
  }

  touchVisit(p: Pt) {
    this.visits[this.idxFromPoint(p)]++;
  }

  /** Return center of least-visited cell (simple frontier heuristic) */
  bestFrontier(): Pt {
    let bestI = 0, bestV = this.visits[0];
    for (let i = 1; i < this.visits.length; i++) {
      if (this.visits[i] < bestV) { bestV = this.visits[i]; bestI = i; }
    }
    const cy = Math.floor(bestI / this.cols);
    const cx = bestI % this.cols;
    return centerOfCell(cx, cy, this.cellW, this.cellH);
  }

  trackEnemies(enemies?: any[], tick?: number) {
    if (!enemies) return;
    for (const e of enemies) {
      if (e?.x === undefined || e?.y === undefined) continue;
      this.enemies.set(e.id, {
        id: e.id,
        last: { x: e.x, y: e.y },
        lastTick: tick ?? 0,
        carrying: e.carrying !== undefined,
        stunCd: e.stunCd
      });
    }
  }
}

// ---- singleton per process (fine while only our team uses this bot) ----
type AnyObj = Record<string, any>;
const G: AnyObj = (globalThis as AnyObj).__HYBRID_STATE__ ||= {};
export function getState(ctx: any, obs: any): HybridState {
  // Reset on new match or at tick 0/1 to be safe
  const key = "team"; // one state is fine for our side in this runner
  if (!G[key] || obs?.tick <= 1) {
    G[key] = new HybridState(ctx?.bounds);
  }
  return G[key] as HybridState;
}
