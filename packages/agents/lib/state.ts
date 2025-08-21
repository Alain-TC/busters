/** EVOL2 — minimal shared state for the hybrid bot.
 *  - Coarse visit grid for frontier-style exploration under fog
 *  - Enemy last-seen tracking (pos, tick, carrying, stunCd)
 *  - Ghost probability heatmap (coarse grid, decays each tick)
 *  Keep it tiny and robust; we’ll extend later (ghost probs, priors, etc.).
 */

export type Pt = { x: number; y: number };

const MAP_W = 16000, MAP_H = 9000; // safe defaults
// How long to remember enemies (in ticks) before dropping them
export const DEFAULT_ENEMY_MAX_AGE = 40;
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

  // Ghost probability heatmap per cell
  readonly ghostProb: number[];
  ghostDecay: number;

  // Enemy last-seen
  enemies = new Map<number, EnemySeen>();
  enemyMaxAge: number;

  constructor(
    bounds?: { w?: number; h?: number },
    cols = 8,
    rows = 5,
    enemyMaxAge = DEFAULT_ENEMY_MAX_AGE,
    spawnPoints: Pt[] = [],
    ghostDecay = 0.95
  ) {
    const W = bounds?.w ?? MAP_W;
    const H = bounds?.h ?? MAP_H;
    this.cols = cols;
    this.rows = rows;
    this.cellW = W / cols;
    this.cellH = H / rows;
    const size = cols * rows;
    this.visits = Array(size).fill(0);
    this.enemyMaxAge = enemyMaxAge;
    this.ghostProb = Array(size).fill(0);
    this.ghostDecay = ghostDecay;
    this.seedGhosts(spawnPoints);
  }

  private idxFromPoint(p: Pt): number {
    const cx = clamp(Math.floor(p.x / this.cellW), 0, this.cols - 1);
    const cy = clamp(Math.floor(p.y / this.cellH), 0, this.rows - 1);
    return cy * this.cols + cx;
  }

  touchVisit(p: Pt) {
    this.visits[this.idxFromPoint(p)]++;
  }

  /** Seed ghost probabilities around known spawn points */
  private seedGhosts(spawns: Pt[]) {
    for (const s of spawns) {
      const i = this.idxFromPoint(s);
      this.ghostProb[i] = 1;
    }
  }

  /** Apply exponential decay to all ghost probabilities */
  decayGhosts() {
    for (let i = 0; i < this.ghostProb.length; i++) {
      this.ghostProb[i] *= this.ghostDecay;
    }
  }

  /** Update probabilities with observed or captured ghosts */
  updateGhosts(visible: Pt[] = [], captured: Pt[] = []) {
    for (const g of visible) {
      const i = this.idxFromPoint(g);
      this.ghostProb[i] = 1;
    }
    for (const g of captured) {
      const i = this.idxFromPoint(g);
      this.ghostProb[i] = 0;
    }
  }

  /** Center points of top-N cells by probability (descending) */
  topGhostCells(n = 1): Array<{ center: Pt; prob: number }> {
    const cells = this.ghostProb
      .map((prob, idx) => ({ prob, idx }))
      .filter(c => c.prob > 0)
      .sort((a, b) => b.prob - a.prob)
      .slice(0, n);
    return cells.map(({ prob, idx }) => {
      const cy = Math.floor(idx / this.cols);
      const cx = idx % this.cols;
      return { center: centerOfCell(cx, cy, this.cellW, this.cellH), prob };
    });
  }

  /** Probability lookup for a point */
  ghostProbAt(p: Pt): number {
    return this.ghostProb[this.idxFromPoint(p)];
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

  pruneEnemies(currentTick: number, maxAge = this.enemyMaxAge) {
    for (const [id, e] of this.enemies) {
      if (currentTick - e.lastTick > maxAge) this.enemies.delete(id);
    }
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
    if (tick !== undefined) this.pruneEnemies(tick);
  }
}

// ---- singleton per process (fine while only our team uses this bot) ----
type AnyObj = Record<string, any>;
const G: AnyObj = (globalThis as AnyObj).__HYBRID_STATE__ ||= {};
export function getState(ctx: any, obs: any): HybridState {
  // Reset on new match or at tick 0/1 to be safe
  const key = "team"; // one state is fine for our side in this runner
  if (!G[key] || obs?.tick <= 1) {
    G[key] = new HybridState(ctx?.bounds, 8, 5, DEFAULT_ENEMY_MAX_AGE, ctx?.ghostSpawns);
  }
  return G[key] as HybridState;
}
