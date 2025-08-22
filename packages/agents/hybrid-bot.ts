/** Hybrid baseline with auction/assignment (with __dbg tags) */
export const meta = { name: "HybridBaseline" };

// Params are imported so CEM can overwrite them.
import HYBRID_PARAMS, { TUNE as TUNE_IN, WEIGHTS as WEIGHTS_IN } from "./hybrid-params";
import { Fog } from "./fog";
import { HybridState, getState, predictEnemyPath } from "./lib/state";
import {
  estimateInterceptPoint,
  duelStunDelta,
  contestedBustDelta,
  releaseBlockDelta,
  twoTurnContestDelta,
  ejectDelta,
  interceptDelta,
  twoTurnInterceptDelta,
  twoTurnEjectDelta,
  scoreCandidate,
  resetMicroPerf,
  microPerf,
  microOverBudget,
} from "./micro";
import { hungarian } from "./hungarian";
// Import basic vector helpers directly to avoid workspace package resolution issues
import { clamp, dist, norm } from "../shared/src/vec.ts";

const micro = (fn: () => number) => (microOverBudget() ? 0 : fn());

// Keep one fog instance for the whole team (sim-runner calls act per ally each tick)
const fog = new Fog();

/** Bind params locally (reads from hybrid-params) */
const TUNE = TUNE_IN;
const WEIGHTS = WEIGHTS_IN as any;

/** --- Small utils (no imports) --- */
const W = 16000, H = 9000;
const BASE_SCORE_RADIUS = 1600; // must be strictly inside to score
const BUST_MIN = 900, BUST_MAX = 1760;
const STUN_CD = 20;
export const EJECT_RADIUS = 1760;
export const ENEMY_NEAR_RADIUS = 2200;
export const STUN_CHECK_RADIUS = 2500;
const PREDICT_TICKS = 3;

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

type Ent = { id: number; x: number; y: number; range?: number; state?: number; value?: number; stunnedFor?: number };

type Obs = {
  tick: number;
  self: Ent & { stunCd?: number; carrying?: number | undefined; localIndex?: number };
  enemies?: Ent[];
  friends?: Ent[];
  ghostsVisible?: (Ent & { id: number })[];
};

/** Memory per buster */
const mem = new Map<number, { stunReadyAt: number; radarUsed: boolean }>();
export const __mem = mem; // exposed for tests
function M(id: number) { if (!mem.has(id)) mem.set(id, { stunReadyAt: 0, radarUsed: false }); return mem.get(id)!; }
let lastTick = Infinity;

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
    const [dx, dy] = norm(raw.x - me.x, raw.y - me.y);
    const px = -dy, py = dx;
    return { x: clamp(raw.x + phase * 220 * px, 0, W), y: clamp(raw.y + phase * 220 * py, 0, H) };
  }
  let nearest: Ent | undefined, best = Infinity;
  for (const f of friends) {
    if (f.id === me.id) continue;
    const d = dist(me.x, me.y, f.x, f.y);
    if (d < best) { best = d; nearest = f; }
  }
  if (!nearest || best >= TUNE.SPACING) return raw;
  const [ax, ay] = norm(me.x - nearest.x, me.y - nearest.y);
  return { x: clamp(raw.x + ax * TUNE.SPACING_PUSH, 0, W), y: clamp(raw.y + ay * TUNE.SPACING_PUSH, 0, H) };
}

/** Base-block ring point (outside enemy base, facing from ours) */
function blockerRing(myBase: Pt, enemyBase: Pt): Pt {
  const [vx, vy] = norm(enemyBase.x - myBase.x, enemyBase.y - myBase.y);
  return { x: clamp(enemyBase.x - vx * TUNE.BLOCK_RING, 0, W), y: clamp(enemyBase.y - vy * TUNE.BLOCK_RING, 0, H) };
}

/** ---- Auction / Task machinery ---- */
type TaskType = "BUST" | "INTERCEPT" | "DEFEND" | "BLOCK" | "EXPLORE" | "SUPPORT" | "CARRY";
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
  const team = uniqTeam(meObs.self, meObs.friends);
  const tick = ctx.tick ?? meObs.tick ?? 0;

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
      const path = predictEnemyPath(e, MY, PREDICT_TICKS);
      for (const p of path) {
        const tx = Math.round((p.x + MY.x) / 2);
        const ty = Math.round((p.y + MY.y) / 2);
        tasks.push({ type: "INTERCEPT", target: { x: tx, y: ty }, payload: { enemyId: e.id }, baseScore: WEIGHTS.INTERCEPT_BASE });
      }
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
    const risk = (enemies.filter(e => dist(e.x, e.y, g.x, g.y) <= ENEMY_NEAR_RADIUS).length) * WEIGHTS.BUST_ENEMY_NEAR_PEN;
    tasks.push({ type: "BUST", target: { x: g.x, y: g.y }, payload: { ghostId: g.id }, baseScore: WEIGHTS.BUST_BASE + onRingBonus - risk });

    // SUPPORT contested busts
    const alliesNear = team.filter(f => dist(f.x, f.y, g.x, g.y) <= BUST_MAX);
    const enemiesNear = enemies.filter(e => dist(e.x, e.y, g.x, g.y) <= ENEMY_NEAR_RADIUS);
    if (alliesNear.length && enemiesNear.length) {
      tasks.push({
        type: "SUPPORT",
        target: { x: g.x, y: g.y },
        payload: { ghostId: g.id, allyIds: alliesNear.map(a => a.id) },
        baseScore: WEIGHTS.SUPPORT_BASE + enemiesNear.length,
      });
    }
  }

  // SUPPORT stun chains on enemies
  for (const e of enemies) {
    const alliesNear = team.filter(f => f.id !== e.id && dist(f.x, f.y, e.x, e.y) <= TUNE.STUN_RANGE);
    const ready = alliesNear.some(a => M(a.id).stunReadyAt <= tick);
    if (alliesNear.length && ready && (e.state !== 2 || (e.stunnedFor ?? 0) <= 2)) {
      tasks.push({
        type: "SUPPORT",
        target: { x: e.x, y: e.y },
        payload: { enemyId: e.id, allyIds: alliesNear.map(a => a.id) },
        baseScore: WEIGHTS.SUPPORT_BASE + alliesNear.length,
      });
    }
  }

  // CARRY allies back to base
  for (const mate of team) {
    const isCarrying = mate.carrying !== undefined || mate.state === 1;
    if (!isCarrying) continue;
    const mid = { x: Math.round((mate.x + MY.x) / 2), y: Math.round((mate.y + MY.y) / 2) };
    const near = enemies.filter(e => dist(e.x, e.y, mid.x, mid.y) <= ENEMY_NEAR_RADIUS).length;
    const baseScore = WEIGHTS.CARRY_BASE - near * WEIGHTS.CARRY_ENEMY_NEAR_PEN;
    tasks.push({ type: "CARRY", target: mid, payload: { id: mate.id }, baseScore });
  }

  // BLOCK enemy base (if no carriers seen)
  if (!enemies.some(e => e.state === 1) && !Array.from(state.enemies.values()).some(e => e.carrying)) {
    tasks.push({ type: "BLOCK", target: blockerRing(MY, EN), baseScore: WEIGHTS.BLOCK_BASE });
  }

  // EXPLORE: coarse frontier via shared state (fallback to patrols)
  const early = (ctx.tick ?? meObs.tick ?? 0) < 5;
  for (const mate of team) {
    let target: Pt | undefined;
    let baseScore = WEIGHTS.EXPLORE_BASE + TUNE.EXPLORE_STEP_REWARD;
    const payload: any = { id: mate.id };
    if (!early) {
      const fr = fog.frontier(mate);
      target = fr.target;
      baseScore += fr.score * 1e-5; // scale frontier score
    }
    if (!target) {
      const idx = ((mate as any).localIndex ?? 0) % PATROLS.length;
      const Mx = MPatrol(mate.id);
      const path = PATROLS[idx];
      const wp = Mx.wp % path.length;
      target = path[wp];
      payload.wp = wp;
    }
    // bias toward high-probability / stale cells from fog
    const prob = fog.probAt(target!);
    baseScore += prob * 100;
    // Role bias: scouts favor exploring
    if (state.roleOf(mate.id) === "SCOUT") baseScore += 5;
    tasks.push({ type: "EXPLORE", target: target!, payload, baseScore });
  }

  return tasks;
}

/** tiny patrol memory for exploration */
const pMem = new Map<number, { wp: number }>();
export const __pMem = pMem; // exposed for tests
function MPatrol(id: number) { if (!pMem.has(id)) pMem.set(id, { wp: 0 }); return pMem.get(id)!; }

/** Score of assigning buster -> task (bigger is better) */
function scoreAssign(b: Ent, t: Task, enemies: Ent[], MY: Pt, tick: number, state: HybridState): number {
  const baseD = dist(b.x, b.y, t.target.x, t.target.y);
  let s = t.baseScore - baseD * WEIGHTS.DIST_PEN;
  const canStunMe = M(b.id).stunReadyAt <= tick;

  if (t.type === "INTERCEPT") {
    const enemy = enemies.find(e => e.id === t.payload?.enemyId);
    if (enemy) {
      const P = estimateInterceptPoint(b, enemy, MY);
      const d = dist(b.x, b.y, P.x, P.y);
      s = t.baseScore - d * WEIGHTS.DIST_PEN - d * WEIGHTS.INTERCEPT_DIST_PEN;
      s += micro(() => duelStunDelta({ me: b, enemy, canStunMe, canStunEnemy: enemy.state !== 2, stunRange: TUNE.STUN_RANGE }));
      s += micro(() => interceptDelta({ me: b, enemy, myBase: MY }));
      s += micro(() => releaseBlockDelta({ blocker: b, carrier: enemy, myBase: MY, stunRange: TUNE.STUN_RANGE }));
      const near = (enemy.range ?? dist(b.x, b.y, enemy.x, enemy.y)) <= STUN_CHECK_RADIUS;
      const threat = enemy.state === 1 && dist(enemy.x, enemy.y, MY.x, MY.y) <= TUNE.RELEASE_DIST + 2000;
      if (near || threat) {
        s += micro(() =>
          twoTurnInterceptDelta({
            me: b,
            enemy,
            myBase: MY,
            stunRange: TUNE.STUN_RANGE,
            canStunMe,
            canStunEnemy: enemy.state !== 2,
          })
        );
      }
    } else {
      s -= baseD * WEIGHTS.INTERCEPT_DIST_PEN;
    }
  }

  if (t.type === "BUST") {
    const r = dist(b.x, b.y, t.target.x, t.target.y);
    if (r >= BUST_MIN && r <= BUST_MAX) s += WEIGHTS.BUST_RING_BONUS * 0.5;
    s += micro(() =>
      contestedBustDelta({
        me: b,
        ghost: { x: t.target.x, y: t.target.y, id: t.payload?.ghostId },
        enemies,
        bustMin: BUST_MIN,
        bustMax: BUST_MAX,
        stunRange: TUNE.STUN_RANGE,
        canStunMe,
      })
    );
    const close = enemies.filter(e => dist(e.x, e.y, t.target.x, t.target.y) <= STUN_CHECK_RADIUS);
    for (const e of close) {
      if (microOverBudget()) break;
      s += micro(() =>
        twoTurnContestDelta({
          me: b,
          enemy: e,
          ghost: { x: t.target.x, y: t.target.y, id: t.payload?.ghostId },
          bustMin: BUST_MIN,
          bustMax: BUST_MAX,
          stunRange: TUNE.STUN_RANGE,
          canStunMe,
          canStunEnemy: e.state !== 2,
        })
      );
    }
  }

  if (t.type === "SUPPORT") {
    const enemiesNear = enemies.filter(e => dist(e.x, e.y, t.target.x, t.target.y) <= ENEMY_NEAR_RADIUS).length;
    const allies = (t.payload?.allyIds?.length ?? 0);
    s += (enemiesNear - allies) * (WEIGHTS.DEFEND_NEAR_BONUS * 0.5);
    if (canStunMe) s += WEIGHTS.DEFEND_NEAR_BONUS;
  }

  if (t.type === "CARRY") {
    const homeD = dist(b.x, b.y, MY.x, MY.y);
    const midRisk = enemies.filter(e => dist(e.x, e.y, t.target.x, t.target.y) <= ENEMY_NEAR_RADIUS).length;
    s -= (homeD - baseD) * WEIGHTS.DIST_PEN; // total penalty is dist to base
    s -= midRisk * WEIGHTS.CARRY_ENEMY_NEAR_PEN;
    if (t.payload?.id === b.id) s += 2; // slight bias for original carrier
  }

  if (t.type === "BLOCK") {
    const carrier = enemies.find(e => e.state === 1);
    if (carrier) {
      s += micro(() => releaseBlockDelta({ blocker: b, carrier, myBase: MY, stunRange: TUNE.STUN_RANGE }));
      if (dist(carrier.x, carrier.y, MY.x, MY.y) <= TUNE.RELEASE_DIST + 2000) {
        s += micro(() =>
          twoTurnContestDelta({
            me: b,
            enemy: carrier,
            bustMin: BUST_MIN,
            bustMax: BUST_MAX,
            stunRange: TUNE.STUN_RANGE,
            canStunMe,
            canStunEnemy: carrier.state !== 2,
          })
        );
      }
    }
  }

  if (t.type === "DEFEND") {
    const near = enemies.filter(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS).length;
    s += near * 1.5;
  }

  // Role biases
  const role = state.roleOf(b.id);
  if (role === "SCOUT" && t.type === "EXPLORE") s += 5;
  if (role === "CHASER" && t.type === "BUST") s += 5;
  if (role === "INTERCEPT" && t.type === "INTERCEPT") s += 5;
  if (role === "BLOCK" && t.type === "BLOCK") s += 5;
  return s;
}

/** Auction/assignment: use Hungarian for optimal matching when manageable */
function runAuction(team: Ent[], tasks: Task[], enemies: Ent[], MY: Pt, tick: number, state: HybridState): Map<number, Task> {
  const assigned = new Map<number, Task>();

  // Use Hungarian when both team and task sizes are reasonable
  if (team.length && tasks.length && team.length * tasks.length <= 100) {
    const cost = team.map(b =>
      tasks.map(t => -scoreAssign(b, t, enemies, MY, tick, state))
    );
    const match = hungarian(cost);
    for (let i = 0; i < team.length; i++) {
      const ti = match[i];
      if (ti >= 0 && ti < tasks.length) {
        assigned.set(team[i].id, tasks[ti]);
      }
    }
    return assigned;
  }

  // Fallback greedy heuristic
  const freeB = new Set(team.map(b => b.id));
  const freeT = new Set(tasks.map((_, i) => i));
  const S: { b: number; t: number; s: number }[] = [];
  for (let bi = 0; bi < team.length; bi++) {
    for (let ti = 0; ti < tasks.length; ti++) {
      S.push({ b: bi, t: ti, s: scoreAssign(team[bi], tasks[ti], enemies, MY, tick, state) });
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

// Expose internals for testing
export const __runAuction = runAuction;
export const __scoreAssign = scoreAssign;
export const __buildTasks = buildTasks;
export const __fog = fog;

/** --- Main per-buster policy --- */
export function act(ctx: Ctx, obs: Obs) {
  resetMicroPerf();
  const tick = (ctx.tick ?? obs.tick ?? 0) | 0;
  if (tick <= 1 && tick < lastTick) {
    mem.clear();
    pMem.clear();
    planTick = -1;
    planAssign.clear();
    fog.reset();
  }
  lastTick = tick;
  const me = obs.self;
  const finish = <T>(act: T) => {
    if (process.env.MICRO_TIMING) {
      console.log(`[micro] t=${tick} b=${me.id} twoTurn=${microPerf.twoTurnMs.toFixed(3)}ms calls=${microPerf.twoTurnCalls}`);
    }
    return act;
  };
  const m = M(me.id);
  const state = getState(ctx, obs);
  state.trackEnemies(obs.enemies, tick);
  state.decayGhosts();
  state.diffuseGhosts();

  fog.beginTick(tick);
  const friends = uniqTeam(me, obs.friends);
  for (const f of friends) { fog.markVisited(f); state.touchVisit(f); state.subtractSeen(f, 400); }
  state.updateRoles(friends);

  const { my: MY, enemy: EN } = resolveBases(ctx);
  const enemiesObs = (obs.enemies ?? []).slice().sort((a,b)=> (a.range ?? dist(me.x,me.y,a.x,a.y)) - (b.range ?? dist(me.x,me.y,b.x,b.y)));
  const ghosts  = (obs.ghostsVisible ?? []).slice().sort((a,b)=> (a.range ?? dist(me.x,me.y,a.x,a.y)) - (b.range ?? dist(me.x,me.y,b.x,b.y)));
  const remembered = Array.from(state.enemies.values()).map(e => ({ id: e.id, x: e.last.x, y: e.last.y, state: e.carrying ? 1 : 0 }));
  const enemyMap = new Map<number, Ent>();
  for (const e of enemiesObs) enemyMap.set(e.id, e);
  for (const e of remembered) if (!enemyMap.has(e.id)) enemyMap.set(e.id, e);
  const enemiesAll = Array.from(enemyMap.values()).sort((a,b)=> (a.range ?? dist(me.x,me.y,a.x,a.y)) - (b.range ?? dist(me.x,me.y,b.x,b.y)));
  const enemies = enemiesObs;

  if (enemies.length || ghosts.length) { fog.clearCircle(me, ENEMY_NEAR_RADIUS); state.subtractSeen(me, ENEMY_NEAR_RADIUS); }
  for (const g of ghosts) { fog.bumpGhost(g.x, g.y); }
  if (ghosts.length) state.updateGhosts(ghosts.map(g => ({ x: g.x, y: g.y }))); 

  const bpp = ctx.bustersPerPlayer ?? Math.max(3, friends.length || 3);
  (me as any).localIndex = (me as any).localIndex ?? (me.id % bpp);
  const localIdx = (me as any).localIndex;

  const carrying = me.carrying !== undefined ? true : (me.state === 1);
  const stunned = (me.state === 2);
  const stunCdLeft = me.stunCd ?? Math.max(0, (m.stunReadyAt - tick));
  const canStun = !stunned && stunCdLeft <= 0;

  /* ---------- High-priority instant actions ---------- */

  // Carrying but not yet inside scoring radius
  if (carrying) {
    const dHome = dist(me.x, me.y, MY.x, MY.y);
    if (dHome >= Math.min(TUNE.RELEASE_DIST, BASE_SCORE_RADIUS)) {
      const threat = enemies.find(e => (e.stunnedFor ?? 0) <= 0 && dist(e.x, e.y, me.x, me.y) <= TUNE.STUN_RANGE);
      let handoff: Ent | undefined;
      for (const f of friends) {
        if (f.id === me.id) continue;
        if (dist(f.x, f.y, me.x, me.y) <= EJECT_RADIUS && dist(f.x, f.y, MY.x, MY.y) + 400 < dHome) {
          handoff = f; break;
        }
      }
      if ((!canStun && threat) || handoff) {
        const target = handoff ?? MY;
        const [dx, dy] = norm(target.x - me.x, target.y - me.y);
        const tx = clamp(me.x + dx * EJECT_RADIUS, 0, W);
        const ty = clamp(me.y + dy * EJECT_RADIUS, 0, H);
        return finish(dbg({ type: "EJECT", x: tx, y: ty }, "EJECT", handoff ? "handoff" : "threat"));
      }
    }
    // fall through to planning for carry task
  }

  // Stun priority: enemy carrier in range, else nearest in bust range
  let targetEnemy: Ent | undefined = enemies.find(e =>
    e.state === 1 && (e.stunnedFor ?? 0) <= 0 && (e.range ?? dist(me.x,me.y,e.x,e.y)) <= TUNE.STUN_RANGE);
  if (!targetEnemy) {
    const cand = enemies.find(e =>
      e.state !== 2 && (e.stunnedFor ?? 0) <= 0 && (e.range ?? dist(me.x,me.y,e.x,e.y)) <= BUST_MAX);
    if (cand) targetEnemy = cand;
  }
  if (canStun && targetEnemy) {
    const duel =
      micro(() =>
        duelStunDelta({
          me,
          enemy: targetEnemy,
          canStunMe: true,
          canStunEnemy: targetEnemy.state !== 2,
          stunRange: TUNE.STUN_RANGE,
        })
      ) +
      (targetEnemy.state === 1
        ? micro(() => releaseBlockDelta({ blocker: me, carrier: targetEnemy, myBase: MY, stunRange: TUNE.STUN_RANGE }))
        : 0);
    if (duel >= 0) {
      mem.get(me.id)!.stunReadyAt = tick + STUN_CD;
      return finish(dbg({ type: "STUN", busterId: targetEnemy.id }, "STUN", targetEnemy.state === 1 ? "enemy_carrier" : "threat"));
    }
  }

  // Scheduled RADAR (staggered)
  if (!m.radarUsed && !stunned) {
    if (localIdx === 0 && tick === TUNE.RADAR1_TURN) { m.radarUsed = true; fog.clearCircle(me, 4000); return finish(dbg({ type: "RADAR" }, "RADAR", "RADAR1_TURN")); }
    if (localIdx === 1 && tick === TUNE.RADAR2_TURN) { m.radarUsed = true; fog.clearCircle(me, 4000); return finish(dbg({ type: "RADAR" }, "RADAR", "RADAR2_TURN")); }
  }

  // Bust immediately if already in ring
  if (ghosts.length) {
    const g = ghosts[0];
    const r = g.range ?? dist(me.x, me.y, g.x, g.y);
    if (r >= BUST_MIN && r <= BUST_MAX) return finish(dbg({ type: "BUST", ghostId: g.id }, "BUST_RING", "in_ring"));
  }

  /* ---------- Build shared plan once per tick ---------- */

  if (planTick !== tick) {
    const team = friends; // includes self
    const tasks = buildTasks(ctx, obs, state, MY, EN);
    planAssign = runAuction(team, tasks, enemiesAll, MY, tick, state);
    planTick = tick;
  }

  /* ---------- Follow my assigned task (fallbacks preserved) ---------- */

  const myTask = planAssign.get(me.id);

  if (myTask) {
    const candidates: { act: any; base: number; deltas: number[]; tag: string; reason?: string }[] = [];

    if (carrying) {
      const ally = friends.filter(f => f.id !== me.id).sort((a,b)=> dist(a.x,a.y,MY.x,MY.y) - dist(b.x,b.y,MY.x,MY.y))[0];
      const target = ally ?? MY;
      const [dx, dy] = norm(target.x - me.x, target.y - me.y);
      const tx = clamp(me.x + dx * EJECT_RADIUS, 0, W);
      const ty = clamp(me.y + dy * EJECT_RADIUS, 0, H);
      const enemy = enemiesAll[0];
      const deltas: number[] = [];
      deltas.push(micro(() => ejectDelta({ me, target: { x: tx, y: ty }, myBase: MY, ally })));
      if (enemy) {
        deltas.push(
          micro(() =>
            twoTurnEjectDelta({
              me,
              enemy,
              target: { x: tx, y: ty },
              myBase: MY,
              stunRange: TUNE.STUN_RANGE,
              canStunEnemy: enemy.state !== 2,
            })
          )
        );
      }
      candidates.push({
        act: { type: "EJECT", x: tx, y: ty },
        base: 95,
        deltas,
        tag: "EJECT",
        reason: ally ? "handoff" : "base",
      });
    }

    if (myTask.type === "CARRY") {
      const dHome = dist(me.x, me.y, MY.x, MY.y);
      if (dHome < Math.min(TUNE.RELEASE_DIST, BASE_SCORE_RADIUS)) {
        candidates.push({ act: { type: "RELEASE" }, base: 120, deltas: [], tag: "RELEASE", reason: "carry" });
      }
      const center = myTask.target;
      const radius = 400;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const px = clamp(center.x + Math.cos(ang) * radius, 0, W);
        const py = clamp(center.y + Math.sin(ang) * radius, 0, H);
        const P = spacedTarget(me, { x: px, y: py }, friends);
        const sim = { id: me.id, x: P.x, y: P.y } as Ent;
        const close = enemiesAll.filter(e => dist(e.x, e.y, P.x, P.y) <= STUN_CHECK_RADIUS);
        const deltas: number[] = [];
        for (const e of close) {
          if (microOverBudget()) break;
          deltas.push(
            micro(() =>
              twoTurnContestDelta({
                me: sim,
                enemy: e,
                bustMin: BUST_MIN,
                bustMax: BUST_MAX,
                stunRange: TUNE.STUN_RANGE,
                canStunMe: canStun,
                canStunEnemy: e.state !== 2,
              })
            )
          );
        }
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas, tag: "MOVE_CARRY", reason: `a${i}` });
      }
      const enemy = enemiesAll.find(e => (e.range ?? dist(me.x, me.y, e.x, e.y)) <= TUNE.STUN_RANGE);
      if (enemy && canStun) {
        const delta = micro(() =>
          duelStunDelta({
            me,
            enemy,
            canStunMe: true,
            canStunEnemy: enemy.state !== 2,
            stunRange: TUNE.STUN_RANGE,
          })
        );
        candidates.push({ act: { type: "STUN", busterId: enemy.id }, base: 110, deltas: [delta], tag: "STUN", reason: "carry" });
      }
    }

    if (myTask.type === "BUST" && ghosts.length) {
      const g = ghosts.find(gg => gg.id === myTask.payload?.ghostId) ?? ghosts[0];
      const r = dist(me.x, me.y, g.x, g.y);
      if (r >= BUST_MIN && r <= BUST_MAX) {
        candidates.push({
          act: { type: "BUST", ghostId: g.id },
          base: 100,
          deltas: (() => {
            const base = micro(() =>
              contestedBustDelta({
                me,
                ghost: { x: g.x, y: g.y, id: g.id },
                enemies: enemiesAll,
                bustMin: BUST_MIN,
                bustMax: BUST_MAX,
                stunRange: TUNE.STUN_RANGE,
                canStunMe: canStun,
              })
            );
            const close = enemiesAll.filter(e => dist(e.x, e.y, g.x, g.y) <= STUN_CHECK_RADIUS);
            let extra = 0;
            for (const e of close) {
              if (microOverBudget()) break;
              extra += micro(() =>
                twoTurnContestDelta({
                  me,
                  enemy: e,
                  ghost: { x: g.x, y: g.y, id: g.id },
                  bustMin: BUST_MIN,
                  bustMax: BUST_MAX,
                  stunRange: TUNE.STUN_RANGE,
                  canStunMe: canStun,
                  canStunEnemy: e.state !== 2,
                })
              );
            }
            return [base + extra];
          })(),
          tag: "BUST_RING",
          reason: "task_bust",
        });
      }
      const ringR = (BUST_MIN + BUST_MAX) / 2;
      for (let i = 0; i < 8; i++) {
        const ang = (Math.PI * 2 * i) / 8;
        const px = clamp(g.x + Math.cos(ang) * ringR, 0, W);
        const py = clamp(g.y + Math.sin(ang) * ringR, 0, H);
        const P = spacedTarget(me, { x: px, y: py }, friends);
        const sim = { id: me.id, x: P.x, y: P.y } as Ent;
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        const baseDelta = micro(() =>
          contestedBustDelta({
            me: sim,
            ghost: { x: g.x, y: g.y, id: g.id },
            enemies: enemiesAll,
            bustMin: BUST_MIN,
            bustMax: BUST_MAX,
            stunRange: TUNE.STUN_RANGE,
            canStunMe: canStun,
          })
        );
        const close = enemiesAll.filter(e => dist(e.x, e.y, g.x, g.y) <= STUN_CHECK_RADIUS);
        let extra = 0;
        for (const e of close) {
          if (microOverBudget()) break;
          extra += micro(() =>
            twoTurnContestDelta({
              me: sim,
              enemy: e,
              ghost: { x: g.x, y: g.y, id: g.id },
              bustMin: BUST_MIN,
              bustMax: BUST_MAX,
              stunRange: TUNE.STUN_RANGE,
              canStunMe: canStun,
              canStunEnemy: e.state !== 2,
            })
          );
        }
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas: [baseDelta + extra], tag: "MOVE_RING", reason: `a${i}` });
      }
    }

    if (myTask.type === "INTERCEPT") {
      const enemy = enemiesAll.find(e => e.id === myTask.payload?.enemyId);
      const center = enemy ? estimateInterceptPoint(me, enemy, MY) : myTask.target;
      const radius = 400;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const px = clamp(center.x + Math.cos(ang) * radius, 0, W);
        const py = clamp(center.y + Math.sin(ang) * radius, 0, H);
        const P = spacedTarget(me, { x: px, y: py }, friends);
        const sim = { id: me.id, x: P.x, y: P.y } as Ent;
        const deltas: number[] = [];
        if (enemy) {
          deltas.push(micro(() => interceptDelta({ me: sim, enemy, myBase: MY })));
          deltas.push(
            micro(() => releaseBlockDelta({ blocker: sim, carrier: enemy, myBase: MY, stunRange: TUNE.STUN_RANGE }))
          );
          const near = (enemy.range ?? dist(me.x, me.y, enemy.x, enemy.y)) <= STUN_CHECK_RADIUS;
          const threat = enemy.state === 1 && dist(enemy.x, enemy.y, MY.x, MY.y) <= TUNE.RELEASE_DIST + 2000;
          if (near || threat) {
            deltas.push(
              micro(() =>
                twoTurnInterceptDelta({
                  me: sim,
                  enemy,
                  myBase: MY,
                  stunRange: TUNE.STUN_RANGE,
                  canStunMe: canStun,
                  canStunEnemy: enemy.state !== 2,
                })
              )
            );
          }
        }
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas, tag: "MOVE_INT", reason: `a${i}` });
      }
      if (enemy && (enemy.range ?? dist(me.x, me.y, enemy.x, enemy.y)) <= TUNE.STUN_RANGE && canStun) {
        let delta = micro(() =>
          duelStunDelta({
            me,
            enemy,
            canStunMe: true,
            canStunEnemy: enemy.state !== 2,
            stunRange: TUNE.STUN_RANGE,
          })
        );
        delta += micro(() =>
          twoTurnInterceptDelta({
            me,
            enemy,
            myBase: MY,
            stunRange: TUNE.STUN_RANGE,
            canStunMe: true,
            canStunEnemy: enemy.state !== 2,
          })
        );
        candidates.push({ act: { type: "STUN", busterId: enemy.id }, base: 110, deltas: [delta], tag: "STUN", reason: "intercept" });
      }
    }

    if (myTask.type === "SUPPORT") {
      const center = myTask.target;
      const radius = 400;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const px = clamp(center.x + Math.cos(ang) * radius, 0, W);
        const py = clamp(center.y + Math.sin(ang) * radius, 0, H);
        const P = spacedTarget(me, { x: px, y: py }, friends);
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas: [], tag: "MOVE_SUP", reason: `a${i}` });
      }
      const enemy = myTask.payload?.enemyId ? enemiesAll.find(e => e.id === myTask.payload.enemyId) : undefined;
      if (enemy && (enemy.range ?? dist(me.x, me.y, enemy.x, enemy.y)) <= TUNE.STUN_RANGE && canStun) {
        const delta = micro(() =>
          duelStunDelta({
            me,
            enemy,
            canStunMe: true,
            canStunEnemy: enemy.state !== 2,
            stunRange: TUNE.STUN_RANGE,
          })
        );
        candidates.push({ act: { type: "STUN", busterId: enemy.id }, base: 110, deltas: [delta], tag: "STUN", reason: "support" });
      }
      const ghost = myTask.payload?.ghostId ? ghosts.find(g => g.id === myTask.payload.ghostId) : undefined;
      if (ghost) {
        const r = dist(me.x, me.y, ghost.x, ghost.y);
        if (r >= BUST_MIN && r <= BUST_MAX) {
          candidates.push({
            act: { type: "BUST", ghostId: ghost.id },
            base: 100,
            deltas: [
              micro(() =>
                contestedBustDelta({
                  me,
                  ghost: { x: ghost.x, y: ghost.y, id: ghost.id },
                  enemies: enemiesAll,
                  bustMin: BUST_MIN,
                  bustMax: BUST_MAX,
                  stunRange: TUNE.STUN_RANGE,
                  canStunMe: canStun,
                })
              ),
            ],
            tag: "BUST_RING",
            reason: "support_bust",
          });
        }
      }
    }

    if (myTask.type === "DEFEND" || myTask.type === "BLOCK" || myTask.type === "EXPLORE") {
      const center = myTask.target;
      const radius = 400;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const px = clamp(center.x + Math.cos(ang) * radius, 0, W);
        const py = clamp(center.y + Math.sin(ang) * radius, 0, H);
        const P = spacedTarget(me, { x: px, y: py }, friends);
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas: [], tag: `MOVE_${myTask.type}`, reason: `a${i}` });
      }

      if (myTask.type === "BLOCK") {
        const carrier = enemiesAll.find(e => e.state === 1);
        if (carrier) {
          let delta = micro(() => releaseBlockDelta({ blocker: me, carrier, myBase: MY, stunRange: TUNE.STUN_RANGE }));
          if (dist(carrier.x, carrier.y, MY.x, MY.y) <= TUNE.RELEASE_DIST + 2000) {
            delta += micro(() =>
              twoTurnContestDelta({
                me,
                enemy: carrier,
                bustMin: BUST_MIN,
                bustMax: BUST_MAX,
                stunRange: TUNE.STUN_RANGE,
                canStunMe: canStun,
                canStunEnemy: carrier.state !== 2,
              })
            );
          }
          candidates.push({ act: { type: "MOVE", x: center.x, y: center.y }, base: 100, deltas: [delta], tag: "BLOCK_CORE" });
        }
      }

      if (myTask.type === "DEFEND") {
        const near = enemies.filter(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS).length * 0.2;
        candidates.push({ act: { type: "MOVE", x: center.x, y: center.y }, base: 100, deltas: [near], tag: "DEFEND_CORE" });
      }

      if (myTask.type === "EXPLORE" && myTask.payload?.wp !== undefined) {
        const mateId = myTask.payload?.id ?? me.id;
        const Mx = MPatrol(mateId);
        const path = PATROLS[((me as any).localIndex ?? 0) % PATROLS.length];
        const cur = path[Mx.wp % path.length];
        if (dist(me.x, me.y, cur.x, cur.y) < 800) Mx.wp = (Mx.wp + 1) % path.length;
        const next = path[Mx.wp % path.length];
        const P = spacedTarget(me, next, friends);
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas: [], tag: "EXPLORE_WP", reason: `wp_${Mx.wp}` });
      }
    }

    if (candidates.length) {
      const scored = candidates.map(c => ({ s: scoreCandidate({ base: c.base, deltas: c.deltas }), c }));
      scored.sort((a, b) => b.s - a.s);
      const best = scored[0].c;
      return finish(dbg(best.act, best.tag, best.reason));
    }
  }

  // If still nothing, use previous simple heuristics

  if (ghosts.length) {
    const g = ghosts[0];
    const chase = spacedTarget(me, { x: g.x, y: g.y }, friends);
    return finish(dbg({ type: "MOVE", x: chase.x, y: chase.y }, "CHASE", "nearest_ghost"));
  }

  const back = spacedTarget(me, MY, friends);
  return finish(dbg({ type: "MOVE", x: back.x, y: back.y }, "IDLE_BACK", "no_task"));
}

