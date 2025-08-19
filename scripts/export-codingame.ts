// scripts/export-codingame.ts
// Export a single-file CodinGame script from either:
//   --from genome  --in packages/sim-runner/artifacts/simrunner_best_genome.json
//   --from hybrid  [--weights path.json]  (weights optional; uses sensible defaults)
//   --out agents/codingame-bot.js  (default)

import fs from "fs";
import path from "path";

type Genome = { radarTurn: number; stunRange: number; releaseDist: number };

function arg(flag: string, dflt?: string) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
function has(flag: string) {
  return process.argv.includes(flag);
}
function ensureDir(p: string) {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

const mode = arg("--from", "genome"); // "genome" | "hybrid"
const inPath = arg("--in", "packages/sim-runner/artifacts/simrunner_best_genome.json");
const weightsPath = arg("--weights", "");
const outPath = arg("--out", "agents/codingame-bot.js");

function writeOut(code: string) {
  ensureDir(outPath);
  fs.writeFileSync(outPath, code, "utf8");
  console.log(`Wrote CodinGame bot -> ${outPath}`);
}

// ---------- Templates (avoid template literals inside generated JS) ----------

function cgHeader(): string {
  return [
    "/**",
    " * CodinGame Busters — EVOL2 exporter (Milestone M2)",
    " * Single-file bot generated from local training/tournament artifacts.",
    " */",
    "",
    "const W = 16000, H = 9000;",
    "const BUST_MIN = 900, BUST_MAX = 1760;",
    "const STUN_CD = 20;",
    "const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));",
    "function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); }",
    "",
    "// Robust header read (some engines give 3 numbers on one line)",
    "let firstLine = (readline() || '').trim();",
    "let parts = firstLine.split(/\\s+/).map(Number).filter(n => !Number.isNaN(n));",
    "let bustersPerPlayer, ghostCount, myTeamId;",
    "if (parts.length >= 3) { [bustersPerPlayer, ghostCount, myTeamId] = parts; }",
    "else { bustersPerPlayer = parts[0]; ghostCount = parseInt(readline()); myTeamId = parseInt(readline()); }",
    "",
    "const myBase = (myTeamId === 0) ? {x:0,y:0} : {x:W,y:H};",
    "const enemyBase = (myTeamId === 0) ? {x:W,y:H} : {x:0,y:0};",
    "let tick = 0;",
    "",
    "// Per-buster memory: stun cooldown & radar usage & patrol index",
    "const mem = new Map();",
    "function getMem(id){ if(!mem.has(id)) mem.set(id,{stunReadyAt:0,radarUsed:false,wp:0}); return mem.get(id); }",
    "",
  ].join("\n");
}

// --- GENOME bot (very small rule-set param’d by radarTurn/stunRange/releaseDist)
function makeGenomeBot(g: Genome): string {
  const body = [
    `const RELEASE_DIST = ${g.releaseDist};`,
    `const STUN_RANGE   = ${g.stunRange};`,
    `const RADAR_TURN   = ${g.radarTurn};`,
    "",
    "// Simple patrols to spread out when nothing visible",
    "const PATROLS = [",
    "  [{x:2500,y:2500},{x:12000,y:2000},{x:15000,y:8000},{x:2000,y:8000},{x:8000,y:4500}],",
    "  [{x:13500,y:6500},{x:8000,y:1200},{x:1200,y:1200},{x:8000,y:7800},{x:8000,y:4500}],",
    "  [{x:8000,y:4500},{x:14000,y:4500},{x:8000,y:8000},{x:1000,y:4500},{x:8000,y:1000}],",
    "  [{x:2000,y:7000},{x:14000,y:7000},{x:14000,y:2000},{x:2000,y:2000},{x:8000,y:4500}]",
    "];",
    "",
    "while (true) {",
    "  const n = parseInt(readline()); if (!Number.isFinite(n)) break;",
    "  const allies=[], enemies=[], ghosts=[];",
    "  for (let i=0;i<n;i++){",
    "    const a = readline().trim().split(/\\s+/);",
    "    const id=+a[0], x=+a[1], y=+a[2], type=+a[3], state=+a[4], value=+a[5];",
    "    if (type===-1) ghosts.push({id,x,y,st:state,on:value});",
    "    else if (type===myTeamId) allies.push({id,x,y,state,value});",
    "    else enemies.push({id,x,y,state,value});",
    "  }",
    "  allies.sort((a,b)=>a.id-b.id);",
    "  const actions = new Array(bustersPerPlayer).fill(null);",
    "",
    "  // choose a scout for RADAR turn",
    "  const scoutId = allies[0] ? allies[0].id : -1;",
    "",
    "  for (let ai=0; ai<allies.length; ai++){",
    "    const me = allies[ai]; const m = getMem(me.id);",
    "    const carrying = (me.state===1); const stunned = (me.state===2);",
    "",
    "    // 1) Carry → base / release",
    "    if (carrying){",
    "      const d = dist(me.x,me.y,myBase.x,myBase.y);",
    "      if (d <= RELEASE_DIST) { actions[ai] = 'RELEASE'; continue; }",
    "      actions[ai] = 'MOVE '+myBase.x+' '+myBase.y; continue;",
    "    }",
    "",
    "    // Build range-ordered views",
    "    const ghostsR = ghosts.map(g=>({g, r:dist(me.x,me.y,g.x,g.y)})).sort((a,b)=>a.r-b.r);",
    "    const enemiesR= enemies.map(e=>({e, r:dist(me.x,me.y,e.x,e.y)})).sort((a,b)=>a.r-b.r);",
    "",
    "    // 2) STUN priority: enemy carrying within STUN_RANGE, else nearest enemy within BUST_MAX",
    "    const canStun = (tick >= m.stunReadyAt) && !stunned;",
    "    let toStun = null;",
    "    for (const er of enemiesR){ if (er.e.state===1 && er.r <= STUN_RANGE) { toStun = er.e; break; } }",
    "    if (!toStun && enemiesR.length && enemiesR[0].r <= BUST_MAX) toStun = enemiesR[0].e;",
    "    if (canStun && toStun){ actions[ai] = 'STUN '+toStun.id; m.stunReadyAt = tick + STUN_CD; continue; }",
    "",
    "    // 3) RADAR once at RADAR_TURN by scout",
    "    if (!m.radarUsed && me.id===scoutId && tick===RADAR_TURN && !stunned){",
    "      actions[ai] = 'RADAR'; m.radarUsed = true; continue;",
    "    }",
    "",
    "    // 4) BUST ring",
    "    if (ghostsR.length){",
    "      const g = ghostsR[0].g; const r = ghostsR[0].r;",
    "      if (r >= BUST_MIN && r <= BUST_MAX){ actions[ai] = 'BUST '+g.id; continue; }",
    "      actions[ai] = 'MOVE '+g.x+' '+g.y; continue;",
    "    }",
    "",
    "    // 5) Intercept enemy carrier",
    "    const carrier = enemiesR.find(er=>er.e.state===1);",
    "    if (carrier){",
    "      const tx = Math.round((carrier.e.x + enemyBase.x)/2);",
    "      const ty = Math.round((carrier.e.y + enemyBase.y)/2);",
    "      actions[ai] = 'MOVE '+clamp(tx,0,W)+' '+clamp(ty,0,H); continue;",
    "    }",
    "",
    "    // 6) Patrol exploration",
    "    const path = PATROLS[ai % PATROLS.length];",
    "    let wp = m.wp % path.length; const tgt = path[wp];",
    "    if (dist(me.x,me.y,tgt.x,tgt.y) < 800){ m.wp=(m.wp+1)%path.length; }",
    "    const T = path[m.wp % path.length];",
    "    actions[ai] = 'MOVE '+clamp(T.x,0,W)+' '+clamp(T.y,0,H);",
    "  }",
    "",
    "  for (let i=0;i<bustersPerPlayer;i++){",
    "    console.log(actions[i] || ('MOVE '+myBase.x+' '+myBase.y));",
    "  }",
    "  tick++;",
    "}",
  ].join("\n");
  return cgHeader() + "\n" + body + "\n";
}

// --- HYBRID baseline (M2). Same as above but with a bit richer defaults & 2 radars.
function makeHybridBot(weights?: Partial<Genome> & { radar2Turn?: number }) {
  const w = {
    radarTurn: 2,
    stunRange: 1760,
    releaseDist: 1600,
    radar2Turn: 55,
    ...(weights || {}),
  };
  const body = [
    `const RELEASE_DIST = ${w.releaseDist};`,
    `const STUN_RANGE   = ${w.stunRange};`,
    `const RADAR1_TURN  = ${w.radarTurn};`,
    `const RADAR2_TURN  = ${w.radar2Turn};`,
    "",
    "const PATROLS = [",
    "  [{x:2500,y:2500},{x:12000,y:2000},{x:15000,y:8000},{x:2000,y:8000},{x:8000,y:4500}],",
    "  [{x:13500,y:6500},{x:8000,y:1200},{x:1200,y:1200},{x:8000,y:7800},{x:8000,y:4500}],",
    "  [{x:8000,y:4500},{x:14000,y:4500},{x:8000,y:8000},{x:1000,y:4500},{x:8000,y:1000}],",
    "  [{x:2000,y:7000},{x:14000,y:7000},{x:14000,y:2000},{x:2000,y:2000},{x:8000,y:4500}]",
    "];",
    "",
    "while (true) {",
    "  const n = parseInt(readline()); if (!Number.isFinite(n)) break;",
    "  const allies=[], enemies=[], ghosts=[];",
    "  for (let i=0;i<n;i++){",
    "    const a = readline().trim().split(/\\s+/);",
    "    const id=+a[0], x=+a[1], y=+a[2], type=+a[3], state=+a[4], value=+a[5];",
    "    if (type===-1) ghosts.push({id,x,y,st:state,on:value});",
    "    else if (type===myTeamId) allies.push({id,x,y,state,value});",
    "    else enemies.push({id,x,y,state,value});",
    "  }",
    "  allies.sort((a,b)=>a.id-b.id);",
    "  const scoutId  = allies[0]?.id ?? -1;",
    "  const radar2Id = allies[1]?.id ?? -1;",
    "  const actions = new Array(bustersPerPlayer).fill(null);",
    "",
    "  for (let ai=0; ai<allies.length; ai++){",
    "    const me = allies[ai]; const m = getMem(me.id);",
    "    const carrying = (me.state===1); const stunned = (me.state===2);",
    "",
    "    if (carrying){",
    "      const d = dist(me.x,me.y,myBase.x,myBase.y);",
    "      if (d <= RELEASE_DIST) { actions[ai] = 'RELEASE'; continue; }",
    "      actions[ai] = 'MOVE '+myBase.x+' '+myBase.y; continue;",
    "    }",
    "",
    "    const ghostsR = ghosts.map(g=>({g, r:dist(me.x,me.y,g.x,g.y)})).sort((a,b)=>a.r-b.r);",
    "    const enemiesR= enemies.map(e=>({e, r:dist(me.x,me.y,e.x,e.y)})).sort((a,b)=>a.r-b.r);",
    "",
    "    const canStun = (tick >= m.stunReadyAt) && !stunned;",
    "    let toStun = null;",
    "    for (const er of enemiesR){ if (er.e.state===1 && er.r <= STUN_RANGE) { toStun = er.e; break; } }",
    "    if (!toStun && enemiesR.length && enemiesR[0].r <= BUST_MAX) toStun = enemiesR[0].e;",
    "    if (canStun && toStun){ actions[ai] = 'STUN '+toStun.id; m.stunReadyAt = tick + STUN_CD; continue; }",
    "",
    "    if (!m.radarUsed && !stunned){",
    "      if (me.id===scoutId  && tick===RADAR1_TURN){ actions[ai]='RADAR'; m.radarUsed=true; continue; }",
    "      if (me.id===radar2Id && tick===RADAR2_TURN){ actions[ai]='RADAR'; m.radarUsed=true; continue; }",
    "    }",
    "",
    "    if (ghostsR.length){",
    "      const g = ghostsR[0].g; const r = ghostsR[0].r;",
    "      if (r>=BUST_MIN && r<=BUST_MAX){ actions[ai] = 'BUST '+g.id; continue; }",
    "      actions[ai] = 'MOVE '+g.x+' '+g.y; continue;",
    "    }",
    "",
    "    const carrier = enemiesR.find(er=>er.e.state===1);",
    "    if (carrier){",
    "      const tx = Math.round((carrier.e.x + enemyBase.x)/2);",
    "      const ty = Math.round((carrier.e.y + enemyBase.y)/2);",
    "      actions[ai] = 'MOVE '+clamp(tx,0,W)+' '+clamp(ty,0,H); continue;",
    "    }",
    "",
    "    const path = PATROLS[ai % PATROLS.length];",
    "    let wp = m.wp % path.length; const tgt = path[wp];",
    "    if (dist(me.x,me.y,tgt.x,tgt.y) < 800){ m.wp=(m.wp+1)%path.length; }",
    "    const T = path[m.wp % path.length];",
    "    actions[ai] = 'MOVE '+clamp(T.x,0,W)+' '+clamp(T.y,0,H);",
    "  }",
    "",
    "  for (let i=0;i<bustersPerPlayer;i++){",
    "    console.log(actions[i] || ('MOVE '+myBase.x+' '+myBase.y));",
    "  }",
    "  tick++;",
    "}",
  ].join("\n");
  return cgHeader() + "\n" + body + "\n";
}

// ---------- Main ----------
(async function main(){
  if (mode === "genome") {
    if (!fs.existsSync(inPath)) {
      console.error(`Genome file not found: ${inPath}`);
      process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(inPath, "utf8"));
    const g: Genome = (raw.radarTurn !== undefined) ? raw
                   : raw.best ? raw.best
                   : { radarTurn: 16, stunRange: 1760, releaseDist: 1600 };
    writeOut(makeGenomeBot(g));
    return;
  }

  if (mode === "hybrid") {
    let weights: any = undefined;
    if (weightsPath && fs.existsSync(weightsPath)) {
      weights = JSON.parse(fs.readFileSync(weightsPath, "utf8"));
    }
    writeOut(makeHybridBot(weights));
    return;
  }

  console.error(`Unknown --from mode: ${mode}`);
  process.exit(1);
})();

