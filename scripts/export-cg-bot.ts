// scripts/export-cg-bot.ts
import fs from "fs";
import path from "path";

type Genome = { radarTurn:number; stunRange:number; releaseDist:number; };

function findGenome(): Genome {
  const candidates = [
    "packages/sim-runner/artifacts/simrunner_best_genome.json",
    "artifacts/simrunner_best_genome.json",
  ].map(p => path.resolve(p));

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const j = JSON.parse(raw);
        const g = (j?.best ?? j) as Partial<Genome>;
        if (typeof g.radarTurn === "number" &&
            typeof g.stunRange === "number" &&
            typeof g.releaseDist === "number") {
          return g as Genome;
        }
      } catch {}
    }
  }
  // Fallback to a known-good genome
  return { radarTurn: 23, stunRange: 1766, releaseDist: 1600 };
}

const g = findGenome();

const code = `/**
 * EvolvedBot — Codingame single-file bot (auto-generated)
 * Params: radarTurn=${g.radarTurn}, stunRange=${g.stunRange}, releaseDist=${g.releaseDist}
 *
 * Heuristics added:
 *  - Early patrol waypoints per buster (L-sweep).
 *  - Staggered RADAR: only first two busters, spaced by +3 ticks.
 */

function dist(ax, ay, bx, by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx,dy); }

const GENOME = { radarTurn:${g.radarTurn}, stunRange:${g.stunRange}, releaseDist:${g.releaseDist} };
const BUST_MIN = 900, BUST_MAX = 1760;
const STUN_RANGE = GENOME.stunRange;

// === Codingame init ===
const bustersPerPlayer = parseInt(readline(),10);
const ghostCount = parseInt(readline(),10);
const myTeamId = parseInt(readline(),10);
const myBase = (myTeamId===0) ? {x:0,y:0} : {x:16000,y:9000};
const enemyBase = (myTeamId===0) ? {x:16000,y:9000} : {x:0,y:0};

// === Per-buster state ===
const stunCd    = new Map(); // id -> cooldown turns
const usedRadar = new Map(); // id -> boolean
const patrolIdx = new Map(); // id -> 0..N-1
for (let i=0;i<bustersPerPlayer;i++){ stunCd.set(i,0); usedRadar.set(i,false); patrolIdx.set(i,0); }

let tick = 0;

// Patrol waypoints (two per buster, mirrored by team)
function patrolFor(bi){
  // Spread targets: corners & mid-edges. Index by buster slot, not entity id.
  const left = (myTeamId===0);
  const pts = [
    // slot 0
    left ? [{x:4000,y:1200},{x:6000,y:3200}] : [{x:12000,y:7800},{x:10000,y:5800}],
    // slot 1
    left ? [{x:1200,y:4000},{x:3200,y:6000}] : [{x:14800,y:5000},{x:12800,y:3000}],
    // slot 2
    left ? [{x:6000,y:6800},{x:8000,y:4800}] : [{x:10000,y:2200},{x:8000,y:4200}],
    // slot 3
    left ? [{x:3000,y:8200},{x:5200,y:6200}] : [{x:13000,y:800},{x:11000,y:2800}],
  ];
  return pts[bi % pts.length];
}

// Stagger RADAR: only slots 0 and 1, shifted by +3 ticks to avoid double pop
function shouldRadar(slot,t){
  const baseTurn = GENOME.radarTurn;
  if (slot===0) return t>=baseTurn;
  if (slot===1) return t>=(baseTurn+3);
  return false;
}

while (true) {
  tick++;
  for (const [k,v] of stunCd) if (v>0) stunCd.set(k, v-1);

  const entities = parseInt(readline(),10);
  const myBusters = [];
  const enemies   = [];
  const ghosts    = [];

  for (let i=0;i<entities;i++){
    const s = readline().split(" ");
    const id = parseInt(s[0],10);
    const x = parseInt(s[1],10);
    const y = parseInt(s[2],10);
    const et = parseInt(s[3],10);
    const state = parseInt(s[4],10);
    const val = parseInt(s[5],10);

    if (et === -1) ghosts.push({ id, x, y, stamina: state, attackers: val });
    else if (et === myTeamId) myBusters.push({ id, x, y, state, value: val });
    else enemies.push({ id, x, y, state, value: val });
  }

  const actions = new Array(bustersPerPlayer);

  // Output exactly bustersPerPlayer actions in slot order (0..N-1)
  for (let slot=0; slot<bustersPerPlayer; slot++){
    const me = myBusters[slot] || myBusters[0] || { id:slot, x:myBase.x, y:myBase.y, state:0, value:0 };
    const carrying = (me.state === 1);
    const stunned  = (me.state === 2);
    const myStunCd = stunCd.get(me.id) || 0;
    const usedR    = usedRadar.get(me.id) || false;

    // nearest enemy / ghost
    let eNear=null, eD=1e9;
    for (const e of enemies){ const d=dist(me.x,me.y,e.x,e.y); if(d<eD){eD=d; eNear=e;} }
    let gNear=null, gD=1e9;
    for (const gg of ghosts){ const d=dist(me.x,me.y,gg.x,gg.y); if(d<gD){gD=d; gNear=gg;} }

    // 1) Carrying → go home, RELEASE when close
    if (carrying){
      const dHome = dist(me.x, me.y, myBase.x, myBase.y);
      actions[slot] = (dHome <= GENOME.releaseDist) ? "RELEASE" : \`MOVE \${myBase.x} \${myBase.y}\`;
      continue;
    }

    // 2) Opportunistic STUN if close and ready
    if (!stunned && eNear && eD <= STUN_RANGE && myStunCd <= 0){
      stunCd.set(me.id, 20);
      actions[slot] = \`STUN \${eNear.id}\`;
      continue;
    }

    // 3) Ghost logic (standard bust window)
    if (gNear){
      if (gD >= BUST_MIN && gD <= BUST_MAX){
        actions[slot] = \`BUST \${gNear.id}\`;
      } else if (gD < BUST_MIN){
        const vx = me.x - gNear.x, vy = me.y - gNear.y;
        const L = Math.hypot(vx,vy) || 1;
        const k = (BUST_MIN + 5) / L;
        actions[slot] = \`MOVE \${Math.round(gNear.x + vx*k)} \${Math.round(gNear.y + vy*k)}\`;
      } else {
        actions[slot] = \`MOVE \${gNear.x} \${gNear.y}\`;
      }
      continue;
    }

    // 4) One-time RADAR (staggered to reduce redundancy)
    if (!usedR && shouldRadar(slot, tick)){
      usedRadar.set(me.id, true);
      actions[slot] = "RADAR";
      continue;
    }

    // 5) Early-game patrol waypoints (until some info appears)
    const pts = patrolFor(slot);
    const pi = patrolIdx.get(me.id) || 0;
    const tgt = pts[Math.min(pi, pts.length-1)];
    const dT = dist(me.x, me.y, tgt.x, tgt.y);
    if (dT > 600) {
      actions[slot] = \`MOVE \${tgt.x} \${tgt.y}\`;
    } else {
      patrolIdx.set(me.id, Math.min(pi+1, pts.length-1));
      actions[slot] = \`MOVE \${enemyBase.x} \${enemyBase.y}\`; // advance towards pressure
    }
  }

  for (let i=0;i<bustersPerPlayer;i++) console.log(actions[i]);
}
`;

const out = path.resolve("my_cg_bot.js");
fs.writeFileSync(out, code);
console.log("Wrote Codingame bot ->", out);

