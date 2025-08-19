// packages/sim-runner/scripts/export-cg-bot.ts
// Usage:
//   pnpm -C packages/sim-runner tsx scripts/export-cg-bot.ts \
//     artifacts/best_hybrid.json ../agents/codingame-hybrid.js
//
// Reads best_hybrid.json (from training) and writes a single-file Codingame bot
// with the parameters inlined (no imports, no bundling required).

import fs from "fs";
import path from "path";

type TW = { TUNE: any; WEIGHTS: any };

const ORDER = [
  "TUNE.RELEASE_DIST",
  "TUNE.STUN_RANGE",
  "TUNE.RADAR1_TURN",
  "TUNE.RADAR2_TURN",
  "TUNE.SPACING",
  "TUNE.SPACING_PUSH",
  "TUNE.BLOCK_RING",
  "TUNE.DEFEND_RADIUS",
  "TUNE.EXPLORE_STEP_REWARD",
  "WEIGHTS.BUST_BASE",
  "WEIGHTS.BUST_RING_BONUS",
  "WEIGHTS.BUST_ENEMY_NEAR_PEN",
  "WEIGHTS.INTERCEPT_BASE",
  "WEIGHTS.INTERCEPT_DIST_PEN",
  "WEIGHTS.DEFEND_BASE",
  "WEIGHTS.DEFEND_NEAR_BONUS",
  "WEIGHTS.BLOCK_BASE",
  "WEIGHTS.EXPLORE_BASE",
  "WEIGHTS.DIST_PEN",
] as const;

function coerceToTW(raw: any): TW {
  // Case 1: already shaped
  if (raw && raw.TUNE && raw.WEIGHTS) return raw as TW;

  // Case 2: GA vector result
  if (Array.isArray(raw) && raw.length === ORDER.length) {
    const TUNE: any = {};
    const WEIGHTS: any = {};
    ORDER.forEach((key, i) => {
      const v = raw[i];
      if (key.startsWith("TUNE.")) TUNE[key.slice(5)] = v;
      else WEIGHTS[key.slice(8)] = v;
    });
    return { TUNE, WEIGHTS };
  }

  // Case 3: { vec: number[] }
  if (raw && Array.isArray(raw.vec) && raw.vec.length === ORDER.length) {
    return coerceToTW(raw.vec);
  }

  throw new Error("Invalid best_hybrid.json — expected {TUNE, WEIGHTS} or a vector of length " + ORDER.length);
}

function buildCgBotSource(TUNE: any, WEIGHTS: any): string {
  const TUNE_STR = JSON.stringify(TUNE, null, 2);
  const WEIGHTS_STR = JSON.stringify(WEIGHTS, null, 2);

  return `/**
 * HybridBaseline (EVOL2) — single-file Codingame bot
 * Generated automatically from best_hybrid.json
 *
 * Actions: MOVE x y | BUST id | RELEASE | STUN id | RADAR
 */

const W = 16000, H = 9000;
const BUST_MIN = 900, BUST_MAX = 1760;
const STUN_CD = 20;

const TUNE = ${TUNE_STR} ;
const WEIGHTS = ${WEIGHTS_STR} ;

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function norm(dx, dy) { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; }

const mem = new Map(); // id -> { stunReadyAt, radarUsed, wp }
function M(id) {
  if (!mem.has(id)) mem.set(id, { stunReadyAt: 0, radarUsed: false, wp: 0 });
  return mem.get(id);
}

const PATROLS = [
  [ {x:2500,y:2500},{x:12000,y:2000},{x:15000,y:8000},{x:2000,y:8000},{x:8000,y:4500} ],
  [ {x:13500,y:6500},{x:8000,y:1200},{x:1200,y:1200},{x:8000,y:7800},{x:8000,y:4500} ],
  [ {x:8000,y:4500},{x:14000,y:4500},{x:8000,y:8000},{x:1000,y:4500},{x:8000,y:1000} ],
  [ {x:2000,y:7000},{x:14000,y:7000},{x:14000,y:2000},{x:2000,y:2000},{x:8000,y:4500} ]
];

function spacedTarget(me, raw, friends) {
  if (!friends || friends.length <= 1) {
    const phase = ((me.id * 9301) ^ 0x9e37) & 1 ? 1 : -1;
    const dir = norm(raw.x - me.x, raw.y - me.y);
    const px = -dir.y, py = dir.x;
    return { x: clamp(raw.x + phase * 220 * px, 0, W), y: clamp(raw.y + phase * 220 * py, 0, H) };
  }
  let nearest = null, best = 1e9;
  for (const f of friends) {
    if (f.id === me.id) continue;
    const d = dist(me.x, me.y, f.x, f.y);
    if (d < best) { best = d; nearest = f; }
  }
  if (!nearest || best >= TUNE.SPACING) return raw;
  const away = norm(me.x - nearest.x, me.y - nearest.y);
  return { x: clamp(raw.x + away.x * TUNE.SPACING_PUSH, 0, W), y: clamp(raw.y + away.y * TUNE.SPACING_PUSH, 0, H) };
}

function blockerRing(myBase, enemyBase) {
  const v = norm(enemyBase.x - myBase.x, enemyBase.y - myBase.y);
  return { x: clamp(enemyBase.x - v.x * TUNE.BLOCK_RING, 0, W), y: clamp(enemyBase.y - v.y * TUNE.BLOCK_RING, 0, H) };
}

function scoreAssign(b, t, enemies, MY) {
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

function runAuction(team, tasks, enemies, MY) {
  const assigned = new Map();
  const freeB = new Set(team.map(b => b.id));
  const freeT = new Set(tasks.map((_, i) => i));

  const S = [];
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

// ======== Codingame I/O ========
const bustersPerPlayer = parseInt(readline(), 10);
const ghostCount = parseInt(readline(), 10);
const myTeamId = parseInt(readline(), 10);

const MY_BASE = myTeamId === 0 ? { x: 0, y: 0 } : { x: W, y: H };
const EN_BASE = myTeamId === 0 ? { x: W, y: H } : { x: 0, y: 0 };

let tick = 0;

while (true) {
  const entities = parseInt(readline(), 10);

  const my = [];
  const enemies = [];
  const ghosts = [];

  for (let i = 0; i < entities; i++) {
    const parts = readline().split(' ');
    const entityId = parseInt(parts[0], 10);
    const x = parseInt(parts[1], 10);
    const y = parseInt(parts[2], 10);
    const entityType = parseInt(parts[3], 10);
    const state = parseInt(parts[4], 10);
    const value = parseInt(parts[5], 10);

    if (entityType === -1) {
      ghosts.push({ id: entityId, x, y, stamina: state, attackers: value });
    } else if (entityType === myTeamId) {
      my.push({ id: entityId, x, y, state, value });
    } else {
      enemies.push({ id: entityId, x, y, state, value });
    }
  }

  my.sort((a, b) => a.id - b.id);
  const idToLocalIndex = new Map();
  my.forEach((b, i) => idToLocalIndex.set(b.id, i));

  function withRangeTo(p, list) {
    return list
      .map(e => ({...e, range: dist(p.x, p.y, e.x, e.y)}))
      .sort((a, b) => a.range - b.range);
  }

  const tasks = [];

  for (const e of enemies) {
    if (e.state === 1) {
      const tx = Math.round((e.x + MY_BASE.x) / 2);
      const ty = Math.round((e.y + MY_BASE.y) / 2);
      tasks.push({ type: "INTERCEPT", target: { x: tx, y: ty }, payload: { enemyId: e.id }, baseScore: WEIGHTS.INTERCEPT_BASE });
    }
  }

  const nearThreat = enemies.find(e => dist(e.x, e.y, MY_BASE.x, MY_BASE.y) <= TUNE.DEFEND_RADIUS);
  if (nearThreat) {
    const tx = Math.round((nearThreat.x + MY_BASE.x) / 2);
    const ty = Math.round((nearThreat.y + MY_BASE.y) / 2);
    tasks.push({ type: "DEFEND", target: { x: tx, y: ty }, payload: { enemyId: nearThreat.id }, baseScore: WEIGHTS.DEFEND_BASE + WEIGHTS.DEFEND_NEAR_BONUS });
  }

  for (const g of ghosts) {
    tasks.push({ type: "BUST", target: { x: g.x, y: g.y }, payload: { ghostId: g.id }, baseScore: WEIGHTS.BUST_BASE });
  }

  if (!enemies.some(e => e.state === 1)) {
    tasks.push({ type: "BLOCK", target: blockerRing(MY_BASE, EN_BASE), baseScore: WEIGHTS.BLOCK_BASE });
  }

  for (const mate of my) {
    const localIdx = idToLocalIndex.get(mate.id) || 0;
    const path = PATROLS[localIdx % PATROLS.length];
    const mm = M(mate.id);
    const wp = mm.wp % path.length;
    tasks.push({ type: "EXPLORE", target: path[wp], payload: { id: mate.id, wp }, baseScore: WEIGHTS.EXPLORE_BASE + TUNE.EXPLORE_STEP_REWARD });
  }

  const assign = runAuction(my, tasks, enemies, MY_BASE);
  const actions = [];

  for (const me of my) {
    const m = M(me.id);
    const localIdx = idToLocalIndex.get(me.id) || 0;

    const enemiesByRange = withRangeTo(me, enemies);
    const ghostsByRange = withRangeTo(me, ghosts);

    const carrying = (me.state === 1);
    const stunned = (me.state === 2);
    const canStun = !stunned && tick >= m.stunReadyAt;

    if (carrying) {
      const d = dist(me.x, me.y, MY_BASE.x, MY_BASE.y);
      if (d <= TUNE.RELEASE_DIST) {
        actions.push('RELEASE');
        continue;
      }
      const home = spacedTarget(me, MY_BASE, my);
      actions.push(\`MOVE \${home.x|0} \${home.y|0}\`);
      continue;
    }

    let targetEnemy = enemiesByRange.find(e => e.state === 1 && e.range <= TUNE.STUN_RANGE);
    if (!targetEnemy && enemiesByRange.length && enemiesByRange[0].range <= BUST_MAX) {
      targetEnemy = enemiesByRange[0];
    }
    if (canStun && targetEnemy) {
      m.stunReadyAt = tick + STUN_CD;
      actions.push(\`STUN \${targetEnemy.id}\`);
      continue;
    }

    if (!m.radarUsed && !stunned) {
      if (localIdx === 0 && tick === TUNE.RADAR1_TURN) { m.radarUsed = true; actions.push('RADAR'); continue; }
      if (localIdx === 1 && tick === TUNE.RADAR2_TURN) { m.radarUsed = true; actions.push('RADAR'); continue; }
    }

    if (ghostsByRange.length) {
      const g0 = ghostsByRange[0];
      if (g0.range >= BUST_MIN && g0.range <= BUST_MAX) {
        actions.push(\`BUST \${g0.id}\`);
        continue;
      }
    }

    const t = assign.get(me.id);

    if (t) {
      if (t.type === "BUST" && ghostsByRange.length) {
        const targetId = t.payload && t.payload.ghostId;
        const g = (ghostsByRange.find(gg => gg.id === targetId) || ghostsByRange[0]);
        if (g.range >= BUST_MIN && g.range <= BUST_MAX) {
          actions.push(\`BUST \${g.id}\`);
          continue;
        }
        const chase = spacedTarget(me, { x: g.x, y: g.y }, my);
        actions.push(\`MOVE \${chase.x|0} \${chase.y|0}\`);
        continue;
      }

      if (t.type === "INTERCEPT" || t.type === "DEFEND" || t.type === "BLOCK" || t.type === "EXPLORE") {
        if (t.type === "EXPLORE") {
          const mm = M(me.id);
          const path = PATROLS[localIdx % PATROLS.length];
          const cur = path[mm.wp % path.length];
          if (dist(me.x, me.y, cur.x, cur.y) < 800) mm.wp = (mm.wp + 1) % path.length;
        }
        const tgt = spacedTarget(me, t.target, my);
        actions.push(\`MOVE \${tgt.x|0} \${tgt.y|0}\`);
        continue;
      }
    }

    if (ghostsByRange.length) {
      const g = ghostsByRange[0];
      const chase = spacedTarget(me, { x: g.x, y: g.y }, my);
      actions.push(\`MOVE \${chase.x|0} \${chase.y|0}\`);
      continue;
    }

    const back = spacedTarget(me, MY_BASE, my);
    actions.push(\`MOVE \${back.x|0} \${back.y|0}\`);
  }

  for (const a of actions) console.log(a);
  tick++;
}
`;
}

async function main() {
  const inPath = process.argv[2] || "artifacts/best_hybrid.json";
  const outPath = process.argv[3] || "../agents/codingame-hybrid.js";

  const absIn = path.resolve(process.cwd(), inPath);
  const absOut = path.resolve(process.cwd(), outPath);

  const raw = JSON.parse(fs.readFileSync(absIn, "utf8"));
  const { TUNE, WEIGHTS } = coerceToTW(raw);

  const src = buildCgBotSource(TUNE, WEIGHTS);

  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, src);
  console.log(`Wrote Codingame bot -> ${absOut}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

