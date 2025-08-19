/** Hybrid baseline with auction/assignment (with __dbg tags) */
export const meta = { name: "HybridBaseline" };

// Params are imported so CEM can overwrite them.
import HYBRID_PARAMS, { TUNE as TUNE_IN, WEIGHTS as WEIGHTS_IN } from "./hybrid-params";
import { Fog } from "./fog";
import { HybridState, getState } from "./lib/state";
import {
  estimateInterceptPoint,
  duelStunDelta,
  contestedBustDelta,
  releaseBlockDelta,
} from "./micro";

// Keep one fog instance for the whole team (sim-runner calls act per ally each tick)
const fog = new Fog();

/** Bind params locally (reads from hybrid-params) */
const TUNE = TUNE_IN;
const WEIGHTS = WEIGHTS_IN as any;

/** --- Small utils (no imports) --- */
const W = 16000, H = 9000;
const BUST_MIN = 900, BUST_MAX = 1760;
const STUN_CD = 20;

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function dist(ax: number, ay: number, bx: number, by: number) { return Math.hypot(ax - bx, ay - by); }
function norm(dx: number, dy: number) { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; }

/** Attach debug metadata to an action */
function dbg<T extends Record<string, any>>(act: T, tag: string, reason?: string, extra?: any) {
  (act as any).__dbg = { tag, reason, extra };
  return act;
}

type Pt = { x: number; y: number };

type Ctx = {
  tick: number;
  myBase?: Pt;
  enemyBase?: Pt;
  bustersPerPlayer?: number;
};

type Ent = { id: number; x: number; y: number; range?: number; state?: number; value?: number };

type Obs = {
  tick: number;
  self: Ent & { stunCd?: number; carrying?: number | undefined; localIndex?: number };
  enemies?: Ent[];
  friends?: Ent[];
  ghostsVisible?: (Ent & { id: number })[];
};

/** Memory per buster */
const mem = new Map<number, { stunReadyAt: number; radarUsed: boolean; wp: number }>();
function M(id: number) { if (!mem.has(id)) mem.set(id, { stunReadyAt: 0, radarUsed: false, wp: 0 }); return mem.get(id)!; }

/** Patrol paths used as exploration frontiers (simple & fast) */
const PATROLS: Pt[][] = [
  [ {x:2500,y:2500},{x:12000,y:2000},{x:15000,y:8000},{x:2000,y:8000},{x:8000,y:4500} ],
  [ {x:13500,y:6500},{x:8000,y:1200},{x:1200,y:1200},{x:8000,y:7800},{x:8000,y:4500} ],
  [ {x:8000,y:4500},{x:14000,y:4500},{x:8000,y:8000},{x:1000,y:4500},{x:8000,y:1000} ],
  [ {x:2000,y:7000},{x:14000,y:7000},{x:14000,y:2000},{x:2000,y:2000},{x:8000,y:4500} ]
];

/** Resolve bases robustly (mirror enemy if missing) */
function resolveBases(ctx: Ctx): { my: Pt; enemy: Pt } {
  const my = ctx.myBase ?? { x: 0, y: 0 };
  const enemy = ctx.enemyBase ?? { x: W - my.x, y: H - my.y };
  return { my, enemy };
}

/** Anti-collision: nudge target away from nearest friend */
function spacedTarget(me: Ent, raw: Pt, friends?: Ent[]): Pt {
  if (!friends || friends.length <= 1) {
    const phase = ((me.id * 9301) ^ 0x9e37) & 1 ? 1 : -1;
    const dir = norm(raw.x - me.x, raw.y - me.y);
    const px = -dir.y, py = dir.x;
    return { x: clamp(raw.x + phase * 220 * px, 0, W), y: clamp(raw.y + phase * 220 * py, 0, H) };
  }
  let nearest: Ent | undefined, best = Infinity;
  for (const f of friends) {
    if (f.id === me.id) continue;
    const d = dist(me.x, me.y, f.x, f.y);
    if (d < best) { best = d; nearest = f; }
  }
  if (!nearest || best >= TUNE.SPACING) return raw;
  const away = norm(me.x - nearest.x, me.y - nearest.y);
  return { x: clamp(raw.x + away.x * TUNE.SPACING_PUSH, 0, W), y: clamp(raw.y + away.y * TUNE.SPACING_PUSH, 0, H) };
}

/** Base-block ring point (outside enemy base, facing from ours) */
function blockerRing(myBase: Pt, enemyBase: Pt): Pt {
  const v = norm(enemyBase.x - myBase.x, enemyBase.y - myBase.y);
  return { x: clamp(enemyBase.x - v.x * TUNE.BLOCK_RING, 0, W), y: clamp(enemyBase.y - v.y * TUNE.BLOCK_RING, 0, H) };
}

/** ---- Auction / Task machinery ---- */
type TaskType = "BUST" | "INTERCEPT" | "DEFEND" | "BLOCK" | "EXPLORE";
type Task = { type: TaskType; target: Pt; payload?: any; baseScore: number };

/** Shared per-tick plan cache (computed once, read by all) */
let planTick = -1;
let planAssign = new Map<number, Task>(); // busterId -> task

function uniqTeam(self: Ent, friends?: Ent[]): Ent[] {
  const map = new Map<number, Ent>();
  map.set(self.id, self);
  (friends ?? []).forEach(f => map.set(f.id, f));
  return Array.from(map.values());
}

function buildTasks(ctx: Ctx, meObs: Obs, state: HybridState, MY: Pt, EN: Pt): Task[] {
  const tasks: Task[] = [];
  const enemies = meObs.enemies ?? [];
  const ghosts = meObs.ghostsVisible ?? [];

  // INTERCEPT enemy carriers (visible)
  for (const e of enemies) {
    if (e.state === 1) {
      const tx = Math.round((e.x + MY.x) / 2);
      const ty = Math.round((e.y + MY.y) / 2);
      tasks.push({ type: "INTERCEPT", target: { x: tx, y: ty }, payload: { enemyId: e.id }, baseScore: WEIGHTS.INTERCEPT_BASE });
    }
  }
  // INTERCEPT last-seen carriers
  for (const e of state.enemies.values()) {
    if (e.carrying && !enemies.some(v => v.id === e.id)) {
      const tx = Math.round((e.last.x + MY.x) / 2);
      const ty = Math.round((e.last.y + MY.y) / 2);
      tasks.push({ type: "INTERCEPT", target: { x: tx, y: ty }, payload: { enemyId: e.id }, baseScore: WEIGHTS.INTERCEPT_BASE });
    }
  }

  // DEFEND base if enemies are close
  let nearThreat = enemies.find(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS);
  if (!nearThreat) {
    for (const e of state.enemies.values()) {
      if (dist(e.last.x, e.last.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS) {
        nearThreat = { id: e.id, x: e.last.x, y: e.last.y } as Ent;
        break;
      }
    }
  }
  if (nearThreat) {
    const tx = Math.round((nearThreat.x + MY.x) / 2);
    const ty = Math.round((nearThreat.y + MY.y) / 2);
    tasks.push({ type: "DEFEND", target: { x: tx, y: ty }, payload: { enemyId: nearThreat.id }, baseScore: WEIGHTS.DEFEND_BASE + WEIGHTS.DEFEND_NEAR_BONUS });
  }

  // BUST visible ghosts
  for (const g of ghosts) {
    const r = g.range ?? dist(meObs.self.x, meObs.self.y, g.x, g.y);
    const onRingBonus = (r >= BUST_MIN && r <= BUST_MAX) ? WEIGHTS.BUST_RING_BONUS : 0;
    const risk = (enemies.filter(e => dist(e.x, e.y, g.x, g.y) <= 2200).length) * WEIGHTS.BUST_ENEMY_NEAR_PEN;
    tasks.push({ type: "BUST", target: { x: g.x, y: g.y }, payload: { ghostId: g.id }, baseScore: WEIGHTS.BUST_BASE + onRingBonus - risk });
  }

  // BLOCK enemy base (if no carriers seen)
  if (!enemies.some(e => e.state === 1) && !Array.from(state.enemies.values()).some(e => e.carrying)) {
    tasks.push({ type: "BLOCK", target: blockerRing(MY, EN), baseScore: WEIGHTS.BLOCK_BASE });
  }

  // EXPLORE: coarse frontier via shared state (fallback to patrols)
  const team = uniqTeam(meObs.self, meObs.friends);
  const early = (ctx.tick ?? meObs.tick ?? 0) < 5;
  for (const mate of team) {
    let target: Pt | undefined;
    const payload: any = { id: mate.id };
    if (!early) target = state.bestFrontier();
    if (!target) {
      const idx = ((mate as any).localIndex ?? 0) % PATROLS.length;
      const Mx = MPatrol(mate.id);
      const path = PATROLS[idx];
      const wp = Mx.wp % path.length;
      target = path[wp];
      payload.wp = wp;
    }
    tasks.push({ type: "EXPLORE", target: target!, payload, baseScore: WEIGHTS.EXPLORE_BASE + TUNE.EXPLORE_STEP_REWARD });
  }

  return tasks;
}

/** tiny patrol memory for exploration */
const pMem = new Map<number, { wp: number }>();
function MPatrol(id: number) { if (!pMem.has(id)) pMem.set(id, { wp: 0 }); return pMem.get(id)!; }

/** Score of assigning buster -> task (bigger is better) */
function scoreAssign(b: Ent, t: Task, enemies: Ent[], MY: Pt, tick: number): number {
  const baseD = dist(b.x, b.y, t.target.x, t.target.y);
  let s = t.baseScore - baseD * WEIGHTS.DIST_PEN;
  const canStunMe = M(b.id).stunReadyAt <= tick;

  if (t.type === "INTERCEPT") {
    const enemy = enemies.find(e => e.id === t.payload?.enemyId);
    if (enemy) {
      const P = estimateInterceptPoint(b, enemy, MY);
      const d = dist(b.x, b.y, P.x, P.y);
      s = t.baseScore - d * WEIGHTS.DIST_PEN - d * WEIGHTS.INTERCEPT_DIST_PEN;
      s += duelStunDelta({ me: b, enemy, canStunMe, canStunEnemy: enemy.state !== 2, stunRange: TUNE.STUN_RANGE });
      s += releaseBlockDelta({ blocker: b, carrier: enemy, myBase: MY, stunRange: TUNE.STUN_RANGE });
    } else {
      s -= baseD * WEIGHTS.INTERCEPT_DIST_PEN;
    }
  }

  if (t.type === "BUST") {
    const r = dist(b.x, b.y, t.target.x, t.target.y);
    if (r >= BUST_MIN && r <= BUST_MAX) s += WEIGHTS.BUST_RING_BONUS * 0.5;
    s += contestedBustDelta({
      me: b,
      ghost: { x: t.target.x, y: t.target.y, id: t.payload?.ghostId },
      enemies,
      bustMin: BUST_MIN,
      bustMax: BUST_MAX,
      stunRange: TUNE.STUN_RANGE,
      canStunMe,
    });
  }

  if (t.type === "BLOCK") {
    const carrier = enemies.find(e => e.state === 1);
    if (carrier) {
      s += releaseBlockDelta({ blocker: b, carrier, myBase: MY, stunRange: TUNE.STUN_RANGE });
    }
  }

  if (t.type === "DEFEND") {
    const near = enemies.filter(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS).length;
    s += near * 1.5;
  }
  return s;
}

/** Greedy auction: assigns at most one task per buster (fast & fine here) */
function runAuction(team: Ent[], tasks: Task[], enemies: Ent[], MY: Pt, tick: number): Map<number, Task> {
  const assigned = new Map<number, Task>();
  const freeB = new Set(team.map(b => b.id));
  const freeT = new Set(tasks.map((_, i) => i));

  // Precompute scores
  const S: { b: number; t: number; s: number }[] = [];
  for (let bi = 0; bi < team.length; bi++) {
    for (let ti = 0; ti < tasks.length; ti++) {
      S.push({ b: bi, t: ti, s: scoreAssign(team[bi], tasks[ti], enemies, MY, tick) });
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

/** --- Main per-buster policy --- */
export function act(ctx: Ctx, obs: Obs) {
  const me = obs.self;
  const m = M(me.id);
  const tick = (ctx.tick ?? obs.tick ?? 0) | 0;
  const state = getState(ctx, obs);
  state.trackEnemies(obs.enemies, tick);

  fog.beginTick(tick);
  const friends = uniqTeam(me, obs.friends);
  for (const f of friends) { fog.markVisited(f); state.touchVisit(f); }

  const { my: MY, enemy: EN } = resolveBases(ctx);
  const enemiesObs = (obs.enemies ?? []).slice().sort((a,b)=> (a.range ?? dist(me.x,me.y,a.x,a.y)) - (b.range ?? dist(me.x,me.y,b.x,b.y)));
  const ghosts  = (obs.ghostsVisible ?? []).slice().sort((a,b)=> (a.range ?? dist(me.x,me.y,a.x,a.y)) - (b.range ?? dist(me.x,me.y,b.x,b.y)));
  const remembered = Array.from(state.enemies.values()).map(e => ({ id: e.id, x: e.last.x, y: e.last.y, state: e.carrying ? 1 : 0 }));
  const enemyMap = new Map<number, Ent>();
  for (const e of enemiesObs) enemyMap.set(e.id, e);
  for (const e of remembered) if (!enemyMap.has(e.id)) enemyMap.set(e.id, e);
  const enemiesAll = Array.from(enemyMap.values()).sort((a,b)=> (a.range ?? dist(me.x,me.y,a.x,a.y)) - (b.range ?? dist(me.x,me.y,b.x,b.y)));
  const enemies = enemiesObs;

  if (enemies.length || ghosts.length) fog.clearCircle(me, 2200);
  for (const g of ghosts) fog.bumpGhost(g.x, g.y);

  const bpp = ctx.bustersPerPlayer ?? Math.max(3, friends.length || 3);
  (me as any).localIndex = (me as any).localIndex ?? (me.id % bpp);
  const localIdx = (me as any).localIndex;

  const carrying = me.carrying !== undefined ? true : (me.state === 1);
  const stunned = (me.state === 2);
  const stunCdLeft = me.stunCd ?? Math.max(0, (m.stunReadyAt - tick));
  const canStun = !stunned && stunCdLeft <= 0;

  /* ---------- High-priority instant actions ---------- */

  // Release if at base
  if (carrying) {
    const dHome = dist(me.x, me.y, MY.x, MY.y);
    if (dHome <= TUNE.RELEASE_DIST) {
      return dbg({ type: "RELEASE" }, "RELEASE", "at_base");
    }
    const home = spacedTarget(me, MY, friends);
    return dbg({ type: "MOVE", x: home.x, y: home.y }, "CARRY_HOME", "carrying");
  }

  // Stun priority: enemy carrier in range, else nearest in bust range
  let targetEnemy: Ent | undefined = enemies.find(e => e.state === 1 && (e.range ?? dist(me.x,me.y,e.x,e.y)) <= TUNE.STUN_RANGE);
  if (!targetEnemy && enemies.length && (enemies[0].range ?? dist(me.x,me.y,enemies[0].x,enemies[0].y)) <= BUST_MAX) {
    targetEnemy = enemies[0];
  }
  if (canStun && targetEnemy) {
    const duel = duelStunDelta({
      me,
      enemy: targetEnemy,
      canStunMe: true,
      canStunEnemy: targetEnemy.state !== 2,
      stunRange: TUNE.STUN_RANGE,
    });
    if (duel >= 0) {
      mem.get(me.id)!.stunReadyAt = tick + STUN_CD;
      return dbg({ type: "STUN", busterId: targetEnemy.id }, "STUN", targetEnemy.state === 1 ? "enemy_carrier" : "threat");
    }
  }

  // Scheduled RADAR (staggered)
  if (!m.radarUsed && !stunned) {
    if (localIdx === 0 && tick === TUNE.RADAR1_TURN) { m.radarUsed = true; fog.clearCircle(me, 4000); return dbg({ type: "RADAR" }, "RADAR", "RADAR1_TURN"); }
    if (localIdx === 1 && tick === TUNE.RADAR2_TURN) { m.radarUsed = true; fog.clearCircle(me, 4000); return dbg({ type: "RADAR" }, "RADAR", "RADAR2_TURN"); }
  }

  // Bust immediately if already in ring
  if (ghosts.length) {
    const g = ghosts[0];
    const r = g.range ?? dist(me.x, me.y, g.x, g.y);
    if (r >= BUST_MIN && r <= BUST_MAX) return dbg({ type: "BUST", ghostId: g.id }, "BUST_RING", "in_ring");
  }

  /* ---------- Build shared plan once per tick ---------- */

  if (planTick !== tick) {
    const team = friends; // includes self
    const tasks = buildTasks(ctx, obs, state, MY, EN);
    planAssign = runAuction(team, tasks, enemiesAll, MY, tick);
    planTick = tick;
  }

  /* ---------- Follow my assigned task (fallbacks preserved) ---------- */

  const myTask = planAssign.get(me.id);

  if (myTask) {
    if (myTask.type === "BUST" && ghosts.length) {
      const g = ghosts.find(gg => gg.id === myTask.payload?.ghostId) ?? ghosts[0];
      const r = dist(me.x, me.y, g.x, g.y);
      if (r >= BUST_MIN && r <= BUST_MAX) return dbg({ type: "BUST", ghostId: g.id }, "BUST_RING", "task_bust");
      const chase = spacedTarget(me, { x: g.x, y: g.y }, friends);
      return dbg({ type: "MOVE", x: chase.x, y: chase.y }, "TASK_BUST_CHASE", "to_ghost");
    }

    if (myTask.type === "INTERCEPT") {
      const enemy = enemiesAll.find(e => e.id === myTask.payload?.enemyId);
      if (enemy) {
        const P = estimateInterceptPoint(me, enemy, MY);
        const tgt = spacedTarget(me, P, friends);
        return dbg({ type: "MOVE", x: tgt.x, y: tgt.y }, "INTERCEPT", "est_int");
      }
      const tgt = spacedTarget(me, myTask.target, friends);
      return dbg({ type: "MOVE", x: tgt.x, y: tgt.y }, "INTERCEPT", "midpoint");
    }

    if (myTask.type === "DEFEND") {
      const tgt = spacedTarget(me, myTask.target, friends);
      return dbg({ type: "MOVE", x: tgt.x, y: tgt.y }, "DEFEND", "near_base");
    }

    if (myTask.type === "BLOCK") {
      const hold = spacedTarget(me, myTask.target, friends);
      return dbg({ type: "MOVE", x: hold.x, y: hold.y }, "BLOCK", "enemy_ring");
    }

    if (myTask.type === "EXPLORE") {
      if (myTask.payload?.wp !== undefined) {
        const mateId = myTask.payload?.id ?? me.id;
        const Mx = MPatrol(mateId);
        const path = PATROLS[((me as any).localIndex ?? 0) % PATROLS.length];
        const cur = path[Mx.wp % path.length];
        if (dist(me.x, me.y, cur.x, cur.y) < 800) Mx.wp = (Mx.wp + 1) % path.length;
        const next = path[Mx.wp % path.length];
        const P = spacedTarget(me, next, friends);
        return dbg({ type: "MOVE", x: P.x, y: P.y }, "TASK_EXPLORE", `wp_${Mx.wp}`);
      }
      const P = spacedTarget(me, myTask.target, friends);
      return dbg({ type: "MOVE", x: P.x, y: P.y }, "TASK_EXPLORE", "frontier");
    }
  }

  // If still nothing, use previous simple heuristics

  if (ghosts.length) {
    const g = ghosts[0];
    const chase = spacedTarget(me, { x: g.x, y: g.y }, friends);
    return dbg({ type: "MOVE", x: chase.x, y: chase.y }, "CHASE", "nearest_ghost");
  }

  const back = spacedTarget(me, MY, friends);
  return dbg({ type: "MOVE", x: back.x, y: back.y }, "IDLE_BACK", "no_task");
}

