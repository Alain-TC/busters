import HYBRID_PARAMS, { TUNE as TUNE_IN, WEIGHTS as WEIGHTS_IN, Tune, Weights } from "../hybrid-params";
import { HybridState, predictEnemyPath } from "../lib/state";
import { hungarian } from "../hungarian";
import { BUST_MIN, BUST_MAX, PATROLS, blockerRing, uniqTeam, dist } from "./utils";
import { M, MPatrol, fog } from "./memory";
import {
  micro,
  microOverBudget,
  estimateInterceptPoint,
  duelStunDelta,
  contestedBustDelta,
  releaseBlockDelta,
  twoTurnContestDelta,
  interceptDelta,
  twoTurnInterceptDelta,
} from "./scoring";

export const TUNE: Tune = TUNE_IN;
const WEIGHTS: Weights = WEIGHTS_IN as any;

export function setHybridParams(params: { TUNE: Partial<Tune>; WEIGHTS: Partial<Weights> }) {
  Object.assign(TUNE, params.TUNE);
  Object.assign(WEIGHTS, params.WEIGHTS);
}

/** --- Small constants --- */
export const BASE_SCORE_RADIUS = 1600; // must be strictly inside to score
export const EJECT_RADIUS = 1760;
export const ENEMY_NEAR_RADIUS = 2200;
export const STUN_CHECK_RADIUS = 2500;
const PREDICT_TICKS = 3;

export type Pt = { x: number; y: number };
export type Ctx = {
  tick: number;
  myBase?: Pt;
  enemyBase?: Pt;
  bustersPerPlayer?: number;
};
export type Ent = {
  id: number;
  x: number;
  y: number;
  range?: number;
  state?: number;
  value?: number;
  carrying?: number | undefined;
  stunnedFor?: number;
};
export type Obs = {
  tick: number;
  self: Ent & { stunCd?: number; carrying?: number | undefined; localIndex?: number };
  enemies?: Ent[];
  friends?: Ent[];
  ghostsVisible?: (Ent & { id: number })[];
};

export type TaskType = "BUST" | "INTERCEPT" | "DEFEND" | "BLOCK" | "EXPLORE" | "SUPPORT" | "CARRY";
export type Task = { type: TaskType; target: Pt; payload?: any; baseScore: number };

let planTick = -1;
let planAssign = new Map<number, Task>(); // busterId -> task

export function resetPlan() {
  planTick = -1;
  planAssign.clear();
}

export function getPlanTick() {
  return planTick;
}

export function getAssignedTask(id: number) {
  return planAssign.get(id);
}

export function buildTasks(ctx: Ctx, meObs: Obs, state: HybridState, MY: Pt, EN: Pt): Task[] {
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
    const onRingBonus = r >= BUST_MIN && r <= BUST_MAX ? WEIGHTS.BUST_RING_BONUS : 0;
    const risk = enemies.filter(e => dist(e.x, e.y, g.x, g.y) <= ENEMY_NEAR_RADIUS).length * WEIGHTS.BUST_ENEMY_NEAR_PEN;
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
    tasks.push({ type: "BLOCK", target: blockerRing(TUNE, MY, EN), baseScore: WEIGHTS.BLOCK_BASE });
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
    const prob = fog.probAt(target!);
    baseScore += prob * 100;
    if (state.roleOf(mate.id) === "SCOUT") baseScore += 5;
    tasks.push({ type: "EXPLORE", target: target!, payload, baseScore });
  }

  return tasks;
}

/** Score of assigning buster -> task (bigger is better) */
export function scoreAssign(b: Ent, t: Task, enemies: Ent[], MY: Pt, tick: number, state: HybridState): number {
  const baseD = dist(b.x, b.y, t.target.x, t.target.y);
  let s = t.baseScore - baseD * WEIGHTS.DIST_PEN;
  const canStunMe = M(b.id).stunReadyAt <= tick;

  const distBE = new Map<number, number>();
  const distTE = new Map<number, number>();
  const distEM = new Map<number, number>();
  const bDist = (e: Ent) => {
    let d = distBE.get(e.id);
    if (d === undefined) { d = dist(b.x, b.y, e.x, e.y); distBE.set(e.id, d); }
    return d;
  };
  const tDist = (e: Ent) => {
    let d = distTE.get(e.id);
    if (d === undefined) { d = dist(t.target.x, t.target.y, e.x, e.y); distTE.set(e.id, d); }
    return d;
  };
  const mDist = (e: Ent) => {
    let d = distEM.get(e.id);
    if (d === undefined) { d = dist(e.x, e.y, MY.x, MY.y); distEM.set(e.id, d); }
    return d;
  };

  if (t.type === "INTERCEPT") {
    const enemy = enemies.find(e => e.id === t.payload?.enemyId);
    if (enemy) {
      const P = estimateInterceptPoint(b, enemy, MY);
      const d = dist(b.x, b.y, P.x, P.y);
      s = t.baseScore - d * WEIGHTS.DIST_PEN - d * WEIGHTS.INTERCEPT_DIST_PEN;
      const be = bDist(enemy);
      if (be <= STUN_CHECK_RADIUS) {
        s += micro(() => duelStunDelta({ me: b, enemy, canStunMe, canStunEnemy: enemy.state !== 2, stunRange: TUNE.STUN_RANGE }));
        s += micro(() => interceptDelta({ me: b, enemy, myBase: MY }));
        s += micro(() => releaseBlockDelta({ blocker: b, carrier: enemy, myBase: MY, stunRange: TUNE.STUN_RANGE }));
      }
      const near = (enemy.range ?? be) <= STUN_CHECK_RADIUS;
      const threat = enemy.state === 1 && mDist(enemy) <= TUNE.RELEASE_DIST + 2000;
      if ((near || threat) && be <= STUN_CHECK_RADIUS) {
        s += micro(() =>
          twoTurnInterceptDelta({
            me: b,
            enemy,
            myBase: MY,
            stunRange: TUNE.STUN_RANGE,
            canStunMe,
            canStunEnemy: enemy.state !== 2,
          }),
        );
      }
    } else {
      s -= baseD * WEIGHTS.INTERCEPT_DIST_PEN;
    }
  }

  if (t.type === "BUST") {
    const r = baseD;
    if (r >= BUST_MIN && r <= BUST_MAX) s += WEIGHTS.BUST_RING_BONUS * 0.5;
    const contested = enemies.some(e => tDist(e) <= STUN_CHECK_RADIUS || bDist(e) <= STUN_CHECK_RADIUS);
    if (contested) {
      s += micro(() =>
        contestedBustDelta({
          me: b,
          ghost: { x: t.target.x, y: t.target.y, id: t.payload?.ghostId },
          enemies,
          bustMin: BUST_MIN,
          bustMax: BUST_MAX,
          stunRange: TUNE.STUN_RANGE,
          canStunMe,
        }),
      );
    }
    const close = enemies.filter(e => tDist(e) <= STUN_CHECK_RADIUS && bDist(e) <= STUN_CHECK_RADIUS);
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
        }),
      );
    }
  }

  if (t.type === "SUPPORT") {
    const enemiesNear = enemies.filter(e => tDist(e) <= ENEMY_NEAR_RADIUS).length;
    const allies = t.payload?.allyIds?.length ?? 0;
    s += (enemiesNear - allies) * (WEIGHTS.DEFEND_NEAR_BONUS * 0.5);
    if (canStunMe) s += WEIGHTS.DEFEND_NEAR_BONUS;
  }

  if (t.type === "CARRY") {
    const homeD = dist(b.x, b.y, MY.x, MY.y);
    const midRisk = enemies.filter(e => tDist(e) <= ENEMY_NEAR_RADIUS).length;
    s -= (homeD - baseD) * WEIGHTS.DIST_PEN;
    s -= midRisk * WEIGHTS.CARRY_ENEMY_NEAR_PEN;
    if (t.payload?.id === b.id) s += 2;
  }

  if (t.type === "BLOCK") {
    const carrier = enemies.find(e => e.state === 1);
    if (carrier) {
      const be = bDist(carrier);
      if (be <= STUN_CHECK_RADIUS) {
        s += micro(() => releaseBlockDelta({ blocker: b, carrier, myBase: MY, stunRange: TUNE.STUN_RANGE }));
        if (mDist(carrier) <= TUNE.RELEASE_DIST + 2000) {
          s += micro(() =>
            twoTurnContestDelta({
              me: b,
              enemy: carrier,
              ghost: undefined,
              bustMin: BUST_MIN,
              bustMax: BUST_MAX,
              stunRange: TUNE.STUN_RANGE,
              canStunMe,
              canStunEnemy: carrier.state !== 2,
            }),
          );
        }
      }
    }
  }

  if (t.type === "DEFEND") {
    const near = enemies.filter(e => mDist(e) <= TUNE.DEFEND_RADIUS).length;
    s += near * 1.5;
  }

  const role = state.roleOf(b.id);
  if (role === "SCOUT" && t.type === "EXPLORE") s += 5;
  if (role === "CHASER" && t.type === "BUST") s += 5;
  if (role === "INTERCEPT" && t.type === "INTERCEPT") s += 5;
  if (role === "BLOCK" && t.type === "BLOCK") s += 5;
  return s;
}

export const HUNGARIAN_MAX_COMBOS = Number(
  (typeof process !== "undefined" ? process.env.HUNGARIAN_MAX_COMBOS : undefined) ?? 100,
);

export function runAuction(team: Ent[], tasks: Task[], enemies: Ent[], MY: Pt, tick: number, state: HybridState) {
  const assigned = new Map<number, Task>();

  if (team.length && tasks.length && team.length * tasks.length <= HUNGARIAN_MAX_COMBOS) {
    const cost = team.map(b => tasks.map(t => -scoreAssign(b, t, enemies, MY, tick, state)));
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

export type BuildPlanArgs = {
  ctx: Ctx;
  obs: Obs;
  state: HybridState;
  friends: Ent[];
  enemiesAll: Ent[];
  MY: Pt;
  EN: Pt;
  tick: number;
};

export function buildPlan(args: BuildPlanArgs) {
  const { ctx, obs, state, friends, enemiesAll, MY, EN, tick } = args;
  const team = friends;
  const tasks = buildTasks(ctx, obs, state, MY, EN);
  planAssign = runAuction(team, tasks, enemiesAll, MY, tick, state);
  planTick = tick;
}
