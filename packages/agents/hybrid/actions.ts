import { HybridState, getState } from "../lib/state";
import {
  W,
  H,
  BUST_MIN,
  BUST_MAX,
  STUN_CD,
  PATROLS,
  resolveBases,
  spacedTarget,
  uniqTeam,
  clamp,
  dist,
  norm,
} from "./utils";
import {
  micro,
  scoreCandidate,
  resetMicroPerf,
  microPerf,
  microOverBudget,
  estimateInterceptPoint,
  duelStunDelta,
  contestedBustDelta,
  releaseBlockDelta,
  twoTurnContestDelta,
  ejectDelta,
  interceptDelta,
  twoTurnInterceptDelta,
  twoTurnEjectDelta,
} from "./scoring";
import {
  M,
  MPatrol,
  beginLifecycle,
  markActive,
  resetHybridMemory,
  getLastTick,
  setLastTick,
  fog,
} from "./memory";
import {
  buildPlan,
  getPlanTick,
  getAssignedTask,
  TUNE,
  BASE_SCORE_RADIUS,
  EJECT_RADIUS,
  ENEMY_NEAR_RADIUS,
  STUN_CHECK_RADIUS,
} from "./planner";
import type { Ctx, Obs, Ent, Pt } from "./planner";

/** Attach debug metadata to an action */
function dbg<T extends Record<string, any>>(act: T, tag: string, reason?: string, extra?: any) {
  (act as any).__dbg = { tag, reason, extra };
  return act;
}

type InstantParams = {
  me: Ent;
  carrying: boolean;
  enemies: Ent[];
  friends: Ent[];
  ghosts: (Ent & { id: number })[];
  canStun: boolean;
  stunned: boolean;
  m: { stunReadyAt: number; radarUsed: boolean };
  localIdx: number;
  tick: number;
  MY: Pt;
};

export function handleInstantActions(params: InstantParams) {
  const { me, carrying, enemies, friends, ghosts, canStun, stunned, m, localIdx, tick, MY } = params;

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
        return dbg({ type: "EJECT", x: tx, y: ty }, "EJECT", handoff ? "handoff" : "threat");
      }
    }
  }

  let targetEnemy: Ent | undefined = enemies.find(e =>
    e.state === 1 && (e.stunnedFor ?? 0) <= 0 && (e.range ?? dist(me.x, me.y, e.x, e.y)) <= TUNE.STUN_RANGE,
  );
  if (!targetEnemy) {
    const cand = enemies.find(e =>
      e.state !== 2 && (e.stunnedFor ?? 0) <= 0 && (e.range ?? dist(me.x, me.y, e.x, e.y)) <= BUST_MAX,
    );
    if (cand) targetEnemy = cand;
  }
  if (canStun && targetEnemy) {
    const duel =
      micro(() =>
        duelStunDelta({
          me,
          enemy: targetEnemy!,
          canStunMe: true,
          canStunEnemy: targetEnemy!.state !== 2,
          stunRange: TUNE.STUN_RANGE,
        }),
      ) +
      (targetEnemy.state === 1
        ? micro(() => releaseBlockDelta({ blocker: me, carrier: targetEnemy!, myBase: MY, stunRange: TUNE.STUN_RANGE }))
        : 0);
    if (duel >= 0) {
      m.stunReadyAt = tick + STUN_CD;
      return dbg(
        { type: "STUN", busterId: targetEnemy.id },
        "STUN",
        targetEnemy.state === 1 ? "enemy_carrier" : "threat",
      );
    }
  }

  if (!m.radarUsed && !stunned) {
    if (localIdx === 0 && tick === TUNE.RADAR1_TURN) {
      m.radarUsed = true;
      fog.clearCircle(me, 4000);
      return dbg({ type: "RADAR" }, "RADAR", "RADAR1_TURN");
    }
    if (localIdx === 1 && tick === TUNE.RADAR2_TURN) {
      m.radarUsed = true;
      fog.clearCircle(me, 4000);
      return dbg({ type: "RADAR" }, "RADAR", "RADAR2_TURN");
    }
  }

  if (ghosts.length) {
    const g = ghosts[0];
    const r = g.range ?? dist(me.x, me.y, g.x, g.y);
    if (r >= BUST_MIN && r <= BUST_MAX) return dbg({ type: "BUST", ghostId: g.id }, "BUST_RING", "in_ring");
  }

  return undefined;
}

type ExecuteArgs = {
  me: Ent;
  friends: Ent[];
  enemies: Ent[];
  enemiesAll: Ent[];
  ghosts: (Ent & { id: number })[];
  carrying: boolean;
  canStun: boolean;
  MY: Pt;
};

export function executePlan(args: ExecuteArgs) {
  const { me, friends, enemies, enemiesAll, ghosts, carrying, canStun, MY } = args;
  const myTask = getAssignedTask(me.id);

  if (myTask) {
    const candidates: { act: any; base: number; deltas: number[]; tag: string; reason?: string }[] = [];
    const dHome = dist(me.x, me.y, MY.x, MY.y);

    if (carrying && dHome >= BASE_SCORE_RADIUS) {
      const ally = friends
        .filter(f => f.id !== me.id)
        .sort((a, b) => dist(a.x, a.y, MY.x, MY.y) - dist(b.x, b.y, MY.x, MY.y))[0];
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
            }),
          ),
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
      if (dHome < Math.min(TUNE.RELEASE_DIST, BASE_SCORE_RADIUS)) {
        candidates.push({ act: { type: "RELEASE" }, base: 120, deltas: [], tag: "RELEASE", reason: "carry" });
      }
      const center = myTask.target;
      const radius = 400;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const px = clamp(center.x + Math.cos(ang) * radius, 0, W);
        const py = clamp(center.y + Math.sin(ang) * radius, 0, H);
        const P = spacedTarget(TUNE, me, { x: px, y: py }, friends);
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
              }),
            ),
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
          }),
        );
        candidates.push({ act: { type: "STUN", busterId: enemy.id }, base: 110, deltas: [delta], tag: "STUN", reason: "carry" });
      }
    }

    if (myTask.type === "BUST" && ghosts.length) {
      const g = ghosts.find(gg => gg.id === myTask.payload?.ghostId);
      if (g) {
        const r = dist(me.x, me.y, g.x, g.y);
        if (r >= BUST_MIN && r <= BUST_MAX) {
          const deltas: number[] = [];
          deltas.push(
            micro(() =>
              contestedBustDelta({
                me,
                ghost: { x: g.x, y: g.y, id: g.id },
                enemies: enemiesAll,
                bustMin: BUST_MIN,
                bustMax: BUST_MAX,
                stunRange: TUNE.STUN_RANGE,
                canStunMe: canStun,
              }),
            ),
          );
          candidates.push({ act: { type: "BUST", ghostId: g.id }, base: 100, deltas, tag: "BUST_RING", reason: "carry" });
        } else {
          const center = g;
          const radius = 400;
          const baseDelta = 100 - dist(me.x, me.y, g.x, g.y) * 0.01;
          for (let i = 0; i < 6; i++) {
            const ang = (Math.PI * 2 * i) / 6;
            const px = clamp(center.x + Math.cos(ang) * radius, 0, W);
            const py = clamp(center.y + Math.sin(ang) * radius, 0, H);
            const P = spacedTarget(TUNE, me, { x: px, y: py }, friends);
            const sim = { id: me.id, x: P.x, y: P.y } as Ent;
            let extra = 0;
            for (const e of enemiesAll) {
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
                }),
              );
            }
            candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base: 100, deltas: [baseDelta + extra], tag: "MOVE_RING", reason: `a${i}` });
          }
        }
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
        const P = spacedTarget(TUNE, me, { x: px, y: py }, friends);
        const sim = { id: me.id, x: P.x, y: P.y } as Ent;
        const deltas: number[] = [];
        if (enemy) {
          deltas.push(micro(() => interceptDelta({ me: sim, enemy, myBase: MY })));
          deltas.push(micro(() => releaseBlockDelta({ blocker: sim, carrier: enemy, myBase: MY, stunRange: TUNE.STUN_RANGE })));
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
                }),
              ),
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
          }),
        );
        delta += micro(() =>
          twoTurnInterceptDelta({
            me,
            enemy,
            myBase: MY,
            stunRange: TUNE.STUN_RANGE,
            canStunMe: true,
            canStunEnemy: enemy.state !== 2,
          }),
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
        const P = spacedTarget(TUNE, me, { x: px, y: py }, friends);
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas: [], tag: "MOVE_SUP", reason: `a${i}` });
      }
      const enemy = enemiesAll.find(e => e.id === myTask.payload?.enemyId);
      if (enemy && (enemy.range ?? dist(me.x, me.y, enemy.x, enemy.y)) <= TUNE.STUN_RANGE && canStun) {
        const delta = micro(() =>
          duelStunDelta({
            me,
            enemy,
            canStunMe: true,
            canStunEnemy: enemy.state !== 2,
            stunRange: TUNE.STUN_RANGE,
          }),
        );
        candidates.push({ act: { type: "STUN", busterId: enemy.id }, base: 110, deltas: [delta], tag: "STUN", reason: "support" });
      }
    }

    if (myTask.type === "BLOCK") {
      const center = myTask.target;
      const radius = 400;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const px = clamp(center.x + Math.cos(ang) * radius, 0, W);
        const py = clamp(center.y + Math.sin(ang) * radius, 0, H);
        const P = spacedTarget(TUNE, me, { x: px, y: py }, friends);
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas: [], tag: `MOVE_${myTask.type}`, reason: `a${i}` });
      }
      const carrier = enemiesAll.find(e => e.state === 1);
      if (carrier && (carrier.range ?? dist(me.x, me.y, carrier.x, carrier.y)) <= TUNE.STUN_RANGE && canStun) {
        const delta = micro(() =>
          duelStunDelta({
            me,
            enemy: carrier,
            canStunMe: true,
            canStunEnemy: carrier.state !== 2,
            stunRange: TUNE.STUN_RANGE,
          }),
        );
        candidates.push({ act: { type: "STUN", busterId: carrier.id }, base: 110, deltas: [delta], tag: "STUN", reason: "block" });
      }
    }

    if (myTask.type === "DEFEND") {
      const center = myTask.target;
      const radius = 400;
      for (let i = 0; i < 6; i++) {
        const ang = (Math.PI * 2 * i) / 6;
        const px = clamp(center.x + Math.cos(ang) * radius, 0, W);
        const py = clamp(center.y + Math.sin(ang) * radius, 0, H);
        const P = spacedTarget(TUNE, me, { x: px, y: py }, friends);
        const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
        const near = enemies.filter(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS).length * 0.2;
        candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas: [near], tag: "DEFEND_CORE" });
      }
    }

    if (myTask.type === "EXPLORE" && myTask.payload?.wp !== undefined) {
      const mateId = myTask.payload?.id ?? me.id;
      const Mx = MPatrol(mateId);
      const path = PATROLS[((me as any).localIndex ?? 0) % PATROLS.length];
      const cur = path[Mx.wp % path.length];
      if (dist(me.x, me.y, cur.x, cur.y) < 800) Mx.wp = (Mx.wp + 1) % path.length;
      const next = path[Mx.wp % path.length];
      const P = spacedTarget(TUNE, me, next, friends);
      const base = 100 - dist(me.x, me.y, P.x, P.y) * 0.01;
      candidates.push({ act: { type: "MOVE", x: P.x, y: P.y }, base, deltas: [], tag: "EXPLORE_WP", reason: `wp_${Mx.wp}` });
    }

    if (candidates.length) {
      const scored = candidates.map(c => ({ s: scoreCandidate({ base: c.base, deltas: c.deltas }), c }));
      scored.sort((a, b) => b.s - a.s);
      const best = scored[0].c;
      return dbg(best.act, best.tag, best.reason);
    }
  }

  if (ghosts.length) {
    const g = ghosts[0];
    const chase = spacedTarget(TUNE, me, { x: g.x, y: g.y }, friends);
    return dbg({ type: "MOVE", x: chase.x, y: chase.y }, "CHASE", "nearest_ghost");
  }

  const back = spacedTarget(TUNE, me, MY, friends);
  return dbg({ type: "MOVE", x: back.x, y: back.y }, "IDLE_BACK", "no_task");
}

/** --- Main per-buster policy --- */
export function act(ctx: Ctx, obs: Obs) {
  resetMicroPerf();
  const tick = (ctx.tick ?? obs.tick ?? 0) | 0;
  if (tick <= 1 && tick < getLastTick()) {
    resetHybridMemory();
  }
  beginLifecycle(tick);
  setLastTick(tick);
  const me = obs.self;
  markActive(me.id);
  const m = M(me.id);
  const finish = <T extends { type?: string }>(act: T) => {
    if ((act as any)?.type === "STUN") {
      m.stunReadyAt = tick + STUN_CD;
    }
    if (process.env.MICRO_TIMING) {
      console.log(`[micro] t=${tick} b=${me.id} twoTurn=${microPerf.twoTurnMs.toFixed(3)}ms calls=${microPerf.twoTurnCalls}`);
    }
    return act;
  };
  const state = getState(ctx, obs);
  state.trackEnemies(obs.enemies, tick);
  state.decayGhosts();
  state.diffuseGhosts();

  fog.beginTick(tick);
  const friends = uniqTeam(me, obs.friends);
  for (const f of friends) {
    fog.markVisited(f);
    state.touchVisit(f);
    state.subtractSeen(f, 400);
  }
  state.updateRoles(friends);

  const { my: MY, enemy: EN } = resolveBases(ctx);
  const enemiesObs = (obs.enemies ?? []).slice().sort((a, b) =>
    (a.range ?? dist(me.x, me.y, a.x, a.y)) - (b.range ?? dist(me.x, me.y, b.x, b.y)),
  );
  const ghosts = (obs.ghostsVisible ?? []).slice().sort((a, b) =>
    (a.range ?? dist(me.x, me.y, a.x, a.y)) - (b.range ?? dist(me.x, me.y, b.x, b.y)),
  );
  const remembered = Array.from(state.enemies.values()).map(e => ({ id: e.id, x: e.last.x, y: e.last.y, state: e.carrying ? 1 : 0 }));
  const enemyMap = new Map<number, Ent>();
  for (const e of enemiesObs) enemyMap.set(e.id, e);
  for (const e of remembered) if (!enemyMap.has(e.id)) enemyMap.set(e.id, e);
  const enemiesAll = Array.from(enemyMap.values()).sort((a, b) =>
    (a.range ?? dist(me.x, me.y, a.x, a.y)) - (b.range ?? dist(me.x, me.y, b.x, b.y)),
  );
  const enemies = enemiesObs;

  if (enemies.length || ghosts.length) {
    fog.clearCircle(me, ENEMY_NEAR_RADIUS);
    state.subtractSeen(me, ENEMY_NEAR_RADIUS);
  }
  for (const g of ghosts) {
    fog.bumpGhost(g.x, g.y);
  }
  if (ghosts.length) state.updateGhosts(ghosts.map(g => ({ x: g.x, y: g.y })));

  const bpp = ctx.bustersPerPlayer ?? Math.max(3, friends.length || 3);
  (me as any).localIndex = (me as any).localIndex ?? me.id % bpp;
  const localIdx = (me as any).localIndex;

  const carrying = me.carrying !== undefined ? true : me.state === 1;
  const stunned = me.state === 2;
  const stunCdLeft = me.stunCd ?? Math.max(0, m.stunReadyAt - tick);
  const canStun = !stunned && stunCdLeft <= 0;

  const instant = handleInstantActions({
    me,
    carrying,
    enemies,
    friends,
    ghosts,
    canStun,
    stunned,
    m,
    localIdx,
    tick,
    MY,
  });
  if (instant) return finish(instant);

  if (getPlanTick() !== tick) {
    buildPlan({ ctx, obs, state, friends, enemiesAll, MY, EN, tick });
  }

  const action = executePlan({
    me,
    friends,
    enemies,
    enemiesAll,
    ghosts,
    carrying,
    canStun,
    MY,
  });
  return finish(action);
}
