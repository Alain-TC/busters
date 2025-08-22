import { clamp, dist, norm } from './vec';

export type Pt = { x: number; y: number };
export type Ent = { id: number; x: number; y: number; range?: number; state?: number; value?: number; stunnedFor?: number; carrying?: number };
export type TaskType = 'BUST' | 'INTERCEPT' | 'DEFEND' | 'BLOCK' | 'EXPLORE';
export type Task = { type: TaskType; target: Pt; payload?: any; baseScore: number };

// Basic patrol paths used for exploration
export const PATROLS: Pt[][] = [
  [ {x:2500,y:2500},{x:12000,y:2000},{x:15000,y:8000},{x:2000,y:8000},{x:8000,y:4500} ],
  [ {x:13500,y:6500},{x:8000,y:1200},{x:1200,y:1200},{x:8000,y:7800},{x:8000,y:4500} ],
  [ {x:8000,y:4500},{x:14000,y:4500},{x:8000,y:8000},{x:1000,y:4500},{x:8000,y:1000} ],
  [ {x:2000,y:7000},{x:14000,y:7000},{x:14000,y:2000},{x:2000,y:2000},{x:8000,y:4500} ]
];

// Shared patrol waypoint memory
export const pMem = new Map<number, { wp: number }>();
export function MPatrol(id: number) { if (!pMem.has(id)) pMem.set(id, { wp: 0 }); return pMem.get(id)!; }

// ---- Task builders ----
const BUST_MIN = 900, BUST_MAX = 1760;

function blockerRing(myBase: Pt, enemyBase: Pt, TUNE: any): Pt {
  const v = norm(enemyBase.x - myBase.x, enemyBase.y - myBase.y);
  return { x: clamp(enemyBase.x - v.x * TUNE.BLOCK_RING, 0, 16000), y: clamp(enemyBase.y - v.y * TUNE.BLOCK_RING, 0, 9000) };
}

function uniqTeam(self: Ent, friends?: Ent[]): Ent[] {
  const map = new Map<number, Ent>();
  map.set(self.id, self);
  (friends ?? []).forEach(f => map.set(f.id, f));
  return Array.from(map.values());
}

export type Ctx = { tick: number; myBase?: Pt; enemyBase?: Pt; bustersPerPlayer?: number };
export type Obs = { tick: number; self: Ent & { stunCd?: number; carrying?: number | undefined; localIndex?: number }; enemies?: Ent[]; friends?: Ent[]; ghostsVisible?: (Ent & { id: number })[] };

export function buildTasks(ctx: Ctx, meObs: Obs, MY: Pt, EN: Pt, TUNE: any, WEIGHTS: any): Task[] {
  const tasks: Task[] = [];
  const enemies = meObs.enemies ?? [];
  const ghosts = meObs.ghostsVisible ?? [];

  // INTERCEPT enemy carriers (visible)
  for (const e of enemies) {
    if (e.state === 1) {
      const tx = Math.round((e.x + MY.x) / 2);
      const ty = Math.round((e.y + MY.y) / 2);
      tasks.push({ type: 'INTERCEPT', target: { x: tx, y: ty }, payload: { enemyId: e.id }, baseScore: WEIGHTS.INTERCEPT_BASE });
    }
  }

  // DEFEND base if enemies are close
  const nearThreat = enemies.find(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS);
  if (nearThreat) {
    const tx = Math.round((nearThreat.x + MY.x) / 2);
    const ty = Math.round((nearThreat.y + MY.y) / 2);
    tasks.push({ type: 'DEFEND', target: { x: tx, y: ty }, payload: { enemyId: nearThreat.id }, baseScore: WEIGHTS.DEFEND_BASE + WEIGHTS.DEFEND_NEAR_BONUS });
  }

  // BUST visible ghosts
  for (const g of ghosts) {
    const r = g.range ?? dist(meObs.self.x, meObs.self.y, g.x, g.y);
    const onRingBonus = (r >= BUST_MIN && r <= BUST_MAX) ? WEIGHTS.BUST_RING_BONUS : 0;
    const risk = (enemies.filter(e => dist(e.x, e.y, g.x, g.y) <= 2200).length) * WEIGHTS.BUST_ENEMY_NEAR_PEN;
    tasks.push({ type: 'BUST', target: { x: g.x, y: g.y }, payload: { ghostId: g.id }, baseScore: WEIGHTS.BUST_BASE + onRingBonus - risk });
  }

  // BLOCK enemy base (if no carriers seen)
  if (!enemies.some(e => e.state === 1)) {
    tasks.push({ type: 'BLOCK', target: blockerRing(MY, EN, TUNE), baseScore: WEIGHTS.BLOCK_BASE });
  }

  // EXPLORE: next waypoints from patrols
  const team = uniqTeam(meObs.self, meObs.friends);
  for (const mate of team) {
    const idx = ((mate as any).localIndex ?? 0) % PATROLS.length;
    const M = MPatrol(mate.id);
    const path = PATROLS[idx];
    const wp = M.wp % path.length;
    tasks.push({ type: 'EXPLORE', target: path[wp], payload: { id: mate.id, wp }, baseScore: WEIGHTS.EXPLORE_BASE + TUNE.EXPLORE_STEP_REWARD });
  }

  return tasks;
}

// ---- Auction / Assignment ----
function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m0 = cost[0]?.length ?? 0;
  if (n === 0 || m0 === 0) return [];
  let m = m0;
  if (m < n) m = n;
  const BIG = 1e9;
  const a: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = new Array(m);
    for (let j = 0; j < m; j++) {
      a[i][j] = (j < m0) ? cost[i][j] : BIG;
    }
  }
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    let j0 = 0;
    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }
  const res = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) {
      const i = p[j] - 1;
      const col = j - 1;
      res[i] = (col < m0) ? col : -1;
    }
  }
  return res;
}

export function runAuction(team: Ent[], tasks: Task[], score: (b: Ent, t: Task) => number): Map<number, Task> {
  const assigned = new Map<number, Task>();
  if (team.length && tasks.length && team.length * tasks.length <= 100) {
    const cost = team.map(b => tasks.map(t => -score(b, t)));
    const match = hungarian(cost);
    for (let i = 0; i < team.length; i++) {
      const ti = match[i];
      if (ti >= 0 && ti < tasks.length) {
        assigned.set(team[i].id, tasks[ti]);
      }
    }
    return assigned;
  }
  const freeB = new Set(team.map(b => b.id));
  const freeT = new Set(tasks.map((_, i) => i));
  const S: { b: number; t: number; s: number }[] = [];
  for (let bi = 0; bi < team.length; bi++) {
    for (let ti = 0; ti < tasks.length; ti++) {
      S.push({ b: bi, t: ti, s: score(team[bi], tasks[ti]) });
    }
  }
  S.sort((a, b) => b.s - a.s);
  for (const { b, t } of S) {
    const bId = team[b].id;
    if (!freeB.has(bId) || !freeT.has(t)) continue;
    assigned.set(bId, tasks[t]);
    freeB.delete(bId);
    freeT.delete(t);
    if (freeB.size === 0) break;
  }
  return assigned;
}

