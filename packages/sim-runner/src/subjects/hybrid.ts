// Param-driven Hybrid bot + vector<->params helpers for subject=hybrid

import type { BotModule } from "../types"; // If you don't have this, replace BotModule with: { meta?: any; act: Function }
import { TUNE as BASE_TUNE, WEIGHTS as BASE_WEIGHTS } from "@busters/agents/hybrid-params";
import { Fog } from "@busters/agents/fog";
import { buildTasks as baseBuildTasks, runAuction as baseRunAuction, pMem } from "../../../shared/src/hybrid-core.ts";

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
    RELEASE_DIST: Math.round(clamp(pick("TUNE.RELEASE_DIST", BASE_TUNE.RELEASE_DIST), 1200, 2000)),
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

  type TaskType = "BUST" | "INTERCEPT" | "DEFEND" | "BLOCK" | "EXPLORE";
  type Task = { type: TaskType; target: Pt; payload?: any; baseScore: number };

  let planTick = -1;
  let planAssign = new Map<number, Task>();

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
        const tasks = baseBuildTasks(ctx as any, obs as any, MY, EN, TUNE, WEIGHTS);
        planAssign = baseRunAuction(team, tasks, (b, t) => scoreAssign(b, t, enemies, MY));
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

