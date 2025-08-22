// Param-driven Hybrid bot + vector<->params helpers for subject=hybrid

import type { BotModule } from "../types"; // If you don't have this, replace BotModule with: { meta?: any; act: Function }
import { TUNE as BASE_TUNE, WEIGHTS as BASE_WEIGHTS } from "@busters/agents/hybrid-params";
import { Fog } from "@busters/agents/fog";

// Automatically derive weight keys so ORDER always includes all weights
const WEIGHT_KEYS = Object.keys(BASE_WEIGHTS) as (keyof typeof BASE_WEIGHTS)[];

/** The flat param order (TUNE + all WEIGHTS) used for Hybrid evolution */
export const ORDER: readonly string[] = [
  // TUNE (9)
  "TUNE.RELEASE_DIST",
  "TUNE.STUN_RANGE",
  "TUNE.RADAR1_TURN",
  "TUNE.RADAR2_TURN",
  "TUNE.SPACING",
  "TUNE.SPACING_PUSH",
  "TUNE.BLOCK_RING",
  "TUNE.DEFEND_RADIUS",
  "TUNE.EXPLORE_STEP_REWARD",
  // WEIGHTS
  ...WEIGHT_KEYS.map(k => `WEIGHTS.${k}`),
];

type Pt = { x: number; y: number };
type Ent = { id: number; x: number; y: number; range?: number; state?: number; value?: number };

type Ctx = {
  tick: number;
  myBase?: Pt;
  enemyBase?: Pt;
  bustersPerPlayer?: number;
};

type Obs = {
  tick: number;
  self: Ent & { stunCd?: number; carrying?: number | undefined; localIndex?: number };
  enemies?: Ent[];
  friends?: Ent[];
  ghostsVisible?: (Ent & { id: number })[];
};

type TW = { TUNE: typeof BASE_TUNE; WEIGHTS: typeof BASE_WEIGHTS };

/** Build the baseline vector from current source params (m0 for CEM) */
export function baselineVec(): number[] {
  const v: number[] = [];
  const T = BASE_TUNE as any;
  const W = BASE_WEIGHTS as any;
  for (const key of ORDER) {
    const [root, name] = key.split(".");
    v.push(root === "TUNE" ? Number(T[name]) : Number(W[name]));
  }
  return v;
}

/** Clamp & coerce vector -> {TUNE, WEIGHTS} */
export function twFromVec(vec: number[]): TW {
  const pick = (key: string, def: number) => {
    const idx = ORDER.indexOf(key);
    return idx >= 0 && Number.isFinite(vec[idx]) ? vec[idx] : def;
  };
  const TUNE = {
    RELEASE_DIST: Math.round(clamp(pick("TUNE.RELEASE_DIST", BASE_TUNE.RELEASE_DIST), 1200, 1600)),
    STUN_RANGE: Math.round(clamp(pick("TUNE.STUN_RANGE", BASE_TUNE.STUN_RANGE), 1650, 1850)),
    RADAR1_TURN: Math.round(clamp(pick("TUNE.RADAR1_TURN", BASE_TUNE.RADAR1_TURN), 0, 5)),
    RADAR2_TURN: Math.round(clamp(pick("TUNE.RADAR2_TURN", BASE_TUNE.RADAR2_TURN), 40, 70)),
    SPACING: Math.round(clamp(pick("TUNE.SPACING", BASE_TUNE.SPACING), 600, 1300)),
    SPACING_PUSH: Math.round(clamp(pick("TUNE.SPACING_PUSH", BASE_TUNE.SPACING_PUSH), 200, 420)),
    BLOCK_RING: Math.round(clamp(pick("TUNE.BLOCK_RING", BASE_TUNE.BLOCK_RING), 1650, 1850)),
    DEFEND_RADIUS: Math.round(clamp(pick("TUNE.DEFEND_RADIUS", BASE_TUNE.DEFEND_RADIUS), 2500, 4200)),
    EXPLORE_STEP_REWARD: clamp(pick("TUNE.EXPLORE_STEP_REWARD", BASE_TUNE.EXPLORE_STEP_REWARD), 0.3, 1.5),
  } as const;

  const WEIGHTS = {
    BUST_BASE: Math.round(clamp(pick("WEIGHTS.BUST_BASE", BASE_WEIGHTS.BUST_BASE), 6, 18)),
    BUST_RING_BONUS: Math.round(clamp(pick("WEIGHTS.BUST_RING_BONUS", BASE_WEIGHTS.BUST_RING_BONUS), 0, 10)),
    BUST_ENEMY_NEAR_PEN: Math.round(clamp(pick("WEIGHTS.BUST_ENEMY_NEAR_PEN", BASE_WEIGHTS.BUST_ENEMY_NEAR_PEN), 0, 8)),
    INTERCEPT_BASE: Math.round(clamp(pick("WEIGHTS.INTERCEPT_BASE", BASE_WEIGHTS.INTERCEPT_BASE), 6, 20)),
    INTERCEPT_DIST_PEN: clamp(pick("WEIGHTS.INTERCEPT_DIST_PEN", BASE_WEIGHTS.INTERCEPT_DIST_PEN), 0.0005, 0.03),
    DEFEND_BASE: Math.round(clamp(pick("WEIGHTS.DEFEND_BASE", BASE_WEIGHTS.DEFEND_BASE), 4, 18)),
    DEFEND_NEAR_BONUS: Math.round(clamp(pick("WEIGHTS.DEFEND_NEAR_BONUS", BASE_WEIGHTS.DEFEND_NEAR_BONUS), 0, 10)),
    BLOCK_BASE: Math.round(clamp(pick("WEIGHTS.BLOCK_BASE", BASE_WEIGHTS.BLOCK_BASE), 0, 12)),
    EXPLORE_BASE: Math.round(clamp(pick("WEIGHTS.EXPLORE_BASE", BASE_WEIGHTS.EXPLORE_BASE), 0, 10)),
    DIST_PEN: clamp(pick("WEIGHTS.DIST_PEN", BASE_WEIGHTS.DIST_PEN), 0.0005, 0.02),
  } as const;

  return { TUNE, WEIGHTS };
}

/** Coerce {TUNE, WEIGHTS} -> vector (ORDER) */
export function vecFromTW(tw: TW): number[] {
  const out: number[] = [];
  const T = tw.TUNE as any;
  const W = tw.WEIGHTS as any;
  for (const key of ORDER) {
    const [root, name] = key.split(".");
    out.push(root === "TUNE" ? Number(T[name]) : Number(W[name]));
  }
  return out;
}

/** Small default sigmas per dimension for CEM sampling */
export function defaultSigmas(): number[] {
  return ORDER.map(k => {
    if (k.includes("RADAR")) return 1.0;
    if (k.endsWith("EXPLORE_STEP_REWARD")) return 0.15;
    if (k.endsWith("DIST_PEN") || k.endsWith("INTERCEPT_DIST_PEN")) return 0.0025;
    if (k.includes("BASE") || k.includes("BONUS") || k.includes("PEN")) return 1.5;
    // distances
    return 80;
  });
}

/** Create a param-driven Hybrid bot (same logic as @busters/agents/hybrid, but using provided params) */
export function makeHybridBotFromTW(tw: TW): BotModule {
  const TUNE = tw.TUNE;
  const WEIGHTS = tw.WEIGHTS;

  // --- inline utils
  const W = 16000, H = 9000;
  const BUST_MIN = 900, BUST_MAX = 1760;
  const STUN_CD = 20;

  function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
  function dist(ax: number, ay: number, bx: number, by: number) { return Math.hypot(ax - bx, ay - by); }
  function norm(dx: number, dy: number) { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; }

  const PATROLS: Pt[][] = [
    [ {x:2500,y:2500},{x:12000,y:2000},{x:15000,y:8000},{x:2000,y:8000},{x:8000,y:4500} ],
    [ {x:13500,y:6500},{x:8000,y:1200},{x:1200,y:1200},{x:8000,y:7800},{x:8000,y:4500} ],
    [ {x:8000,y:4500},{x:14000,y:4500},{x:8000,y:8000},{x:1000,y:4500},{x:8000,y:1000} ],
    [ {x:2000,y:7000},{x:14000,y:7000},{x:14000,y:2000},{x:2000,y:2000},{x:8000,y:4500} ]
  ];

  function resolveBases(ctx: Ctx): { my: Pt; enemy: Pt } {
    const my = ctx.myBase ?? { x: 0, y: 0 };
    const enemy = ctx.enemyBase ?? { x: W - my.x, y: H - my.y };
    return { my, enemy };
  }

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

  function blockerRing(myBase: Pt, enemyBase: Pt): Pt {
    const v = norm(enemyBase.x - myBase.x, enemyBase.y - myBase.y);
    return { x: clamp(enemyBase.x - v.x * TUNE.BLOCK_RING, 0, W), y: clamp(enemyBase.y - v.y * TUNE.BLOCK_RING, 0, H) };
  }

  type TaskType = "BUST" | "INTERCEPT" | "DEFEND" | "BLOCK" | "EXPLORE";
  type Task = { type: TaskType; target: Pt; payload?: any; baseScore: number };

  let planTick = -1;
  let planAssign = new Map<number, Task>();

  const pMem = new Map<number, { wp: number }>();
  function MPatrol(id: number) { if (!pMem.has(id)) pMem.set(id, { wp: 0 }); return pMem.get(id)!; }

  const mem = new Map<number, { stunReadyAt: number; radarUsed: boolean }>();
  function M(id: number) { if (!mem.has(id)) mem.set(id, { stunReadyAt: 0, radarUsed: false }); return mem.get(id)!; }
  const fog = new Fog();
  let lastTick = Infinity;

  function uniqTeam(self: Ent, friends?: Ent[]): Ent[] {
    const map = new Map<number, Ent>();
    map.set(self.id, self);
    (friends ?? []).forEach(f => map.set(f.id, f));
    return Array.from(map.values());
  }

  function buildTasks(ctx: Ctx, meObs: Obs, MY: Pt, EN: Pt): Task[] {
    const tasks: Task[] = [];
    const enemies = meObs.enemies ?? [];
    const ghosts = meObs.ghostsVisible ?? [];

    // INTERCEPT enemy carriers
    for (const e of enemies) {
      if (e.state === 1) {
        const tx = Math.round((e.x + MY.x) / 2);
        const ty = Math.round((e.y + MY.y) / 2);
        tasks.push({ type: "INTERCEPT", target: { x: tx, y: ty }, payload: { enemyId: e.id }, baseScore: WEIGHTS.INTERCEPT_BASE });
      }
    }

    // DEFEND base if enemies are close
    const nearThreat = enemies.find(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS);
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
    if (!enemies.some(e => e.state === 1)) {
      tasks.push({ type: "BLOCK", target: blockerRing(MY, EN), baseScore: WEIGHTS.BLOCK_BASE });
    }

    // EXPLORE: next waypoints from patrols
    const team = uniqTeam(meObs.self, meObs.friends);
    for (const mate of team) {
      const idx = ((mate as any).localIndex ?? 0) % PATROLS.length;
      const M = MPatrol(mate.id);
      const path = PATROLS[idx];
      const wp = M.wp % path.length;
      tasks.push({ type: "EXPLORE", target: path[wp], payload: { id: mate.id, wp }, baseScore: WEIGHTS.EXPLORE_BASE + TUNE.EXPLORE_STEP_REWARD });
    }
    return tasks;
  }

  function scoreAssign(b: Ent, t: Task, enemies: Ent[], MY: Pt): number {
    const d = dist(b.x, b.y, t.target.x, t.target.y);
    let s = t.baseScore - d * WEIGHTS.DIST_PEN;
    if (t.type === "INTERCEPT") s -= d * WEIGHTS.INTERCEPT_DIST_PEN;
    if (t.type === "BUST") {
      const r = dist(b.x, b.y, t.target.x, t.target.y);
      if (r >= BUST_MIN && r <= BUST_MAX) s += WEIGHTS.BUST_RING_BONUS * 0.5;
    }
    if (t.type === "DEFEND") {
      const near = enemies.filter(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS).length;
      s += near * 1.5;
    }
    return s;
  }

  function runAuction(team: Ent[], tasks: Task[], enemies: Ent[], MY: Pt): Map<number, Task> {
    const assigned = new Map<number, Task>();
    const freeB = new Set(team.map(b => b.id));
    const freeT = new Set(tasks.map((_, i) => i));
    const S: { b: number; t: number; s: number }[] = [];
    for (let bi = 0; bi < team.length; bi++) {
      for (let ti = 0; ti < tasks.length; ti++) {
        S.push({ b: bi, t: ti, s: scoreAssign(team[bi], tasks[ti], enemies, MY) });
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

  const bot: BotModule = {
    meta: { name: "HybridSubject" },
    act(ctx: Ctx, obs: Obs) {
      const me = obs.self;
      const m = M(me.id);
      const tick = (ctx.tick ?? obs.tick ?? 0) | 0;
      if (tick <= 1 && tick < lastTick) { mem.clear(); pMem.clear(); planTick = -1; fog.reset(); }
      lastTick = tick;

      const { my: MY, enemy: EN } = resolveBases(ctx);
      const enemies = (obs.enemies ?? []).slice().sort((a,b)=> (a.range ?? dist(me.x,me.y,a.x,a.y)) - (b.range ?? dist(me.x,me.y,b.x,b.y)));
      const ghosts  = (obs.ghostsVisible ?? []).slice().sort((a,b)=> (a.range ?? dist(me.x,me.y,a.x,a.y)) - (b.range ?? dist(me.x,me.y,b.x,b.y)));
      const friends = uniqTeam(me, obs.friends);

      const bpp = ctx.bustersPerPlayer ?? Math.max(3, friends.length || 3);
      const localIdx = (me as any).localIndex ?? (me.id % bpp);

      const carrying = me.carrying !== undefined ? true : (me.state === 1);
      const stunned = (me.state === 2);
      const stunCdLeft = me.stunCd ?? Math.max(0, (m.stunReadyAt - tick));
      const canStun = !stunned && stunCdLeft <= 0;

      // Release if at base
      if (carrying) {
        const d0 = dist(me.x, me.y, MY.x, MY.y);
        if (d0 <= TUNE.RELEASE_DIST) return { type: "RELEASE" };
        const home = spacedTarget(me, MY, friends);
        return { type: "MOVE", x: home.x, y: home.y };
      }

      // Stun priority: enemy carrier in range, else nearest in bust range
      let targetEnemy: Ent | undefined = enemies.find(e => e.state === 1 && (e.range ?? dist(me.x,me.y,e.x,e.y)) <= TUNE.STUN_RANGE);
      if (!targetEnemy && enemies.length && (enemies[0].range ?? dist(me.x,me.y,enemies[0].x,enemies[0].y)) <= BUST_MAX) {
        targetEnemy = enemies[0];
      }
      if (canStun && targetEnemy) {
        m.stunReadyAt = tick + STUN_CD;
        return { type: "STUN", busterId: targetEnemy.id };
      }

      // Proactive defense vs campers
      const threatNearBase = enemies.find(e => dist(e.x, e.y, MY.x, MY.y) <= TUNE.DEFEND_RADIUS);
      if (threatNearBase) {
        const eRange = threatNearBase.range ?? dist(me.x, me.y, threatNearBase.x, threatNearBase.y);
        if (canStun && eRange <= TUNE.STUN_RANGE) {
          m.stunReadyAt = tick + STUN_CD;
          return { type: "STUN", busterId: threatNearBase.id };
        }
        const mid = { x: Math.round((threatNearBase.x + MY.x) / 2), y: Math.round((threatNearBase.y + MY.y) / 2) };
        const hold = spacedTarget(me, mid, friends);
        return { type: "MOVE", x: hold.x, y: hold.y };
      }

      // Scheduled RADAR
      if (!(m as any).radarUsed && !stunned) {
        if (localIdx === 0 && tick === TUNE.RADAR1_TURN) { (m as any).radarUsed = true; return { type: "RADAR" }; }
        if (localIdx === 1 && tick === TUNE.RADAR2_TURN) { (m as any).radarUsed = true; return { type: "RADAR" }; }
      }

      // Bust immediately if already in ring
      if (ghosts.length) {
        const g0 = ghosts[0];
        const r0 = g0.range ?? dist(me.x, me.y, g0.x, g0.y);
        if (r0 >= BUST_MIN && r0 <= BUST_MAX) return { type: "BUST", ghostId: g0.id };
      }

      // Build plan once per tick
      if (planTick !== tick) {
        const team = friends;
        const tasks = buildTasks(ctx, obs, MY, EN);
        planAssign = runAuction(team, tasks, enemies, MY);
        planTick = tick;
      }

      // Follow my assigned task
      const myTask = planAssign.get(me.id);
      if (myTask) {
        if (myTask.type === "BUST" && ghosts.length) {
          const g = ghosts.find(gg => gg.id === myTask.payload?.ghostId) ?? ghosts[0];
          const r = dist(me.x, me.y, g.x, g.y);
          if (r >= BUST_MIN && r <= BUST_MAX) return { type: "BUST", ghostId: g.id };
          const chase = spacedTarget(me, { x: g.x, y: g.y }, friends);
          return { type: "MOVE", x: chase.x, y: chase.y };
        }
        const tgt = myTask.target;
        const P = spacedTarget(me, tgt, friends);
        return { type: "MOVE", x: P.x, y: P.y };
      }

      // fallback
      if (ghosts.length) {
        const g = ghosts[0];
        const chase = spacedTarget(me, { x: g.x, y: g.y }, friends);
        return { type: "MOVE", x: chase.x, y: chase.y };
      }
      const back = spacedTarget(me, MY, friends);
      return { type: "MOVE", x: back.x, y: back.y };
    },
  };

  return bot;
}

/** Simple clamp */
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

