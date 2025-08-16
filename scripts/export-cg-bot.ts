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
  return { radarTurn: 23, stunRange: 1766, releaseDist: 1600 };
}

const g = findGenome();

const code = `/**
 * EvolvedBot — Codingame single-file bot (auto-generated)
 * Params: radarTurn=\${${'g.radarTurn'}}, stunRange=\${${'g.stunRange'}}, releaseDist=\${${'g.releaseDist'}}
 */

function dist(ax, ay, bx, by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx,dy); }

const GENOME = { radarTurn:${g.radarTurn}, stunRange:${g.stunRange}, releaseDist:${g.releaseDist} };
const BUST_MIN = 900, BUST_MAX = 1760;
const STUN_RANGE = GENOME.stunRange;

const bustersPerPlayer = parseInt(readline(),10);
const ghostCount = parseInt(readline(),10);
const myTeamId = parseInt(readline(),10);
const myBase = (myTeamId===0) ? {x:0,y:0} : {x:16000,y:9000};

const stunCd    = new Map();
const usedRadar = new Map();
for (let i=0;i<bustersPerPlayer;i++){ stunCd.set(i,0); usedRadar.set(i,false); }

let tick = 0;

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

  for (let i=0;i<bustersPerPlayer;i++){
    const me = myBusters[i] || myBusters[0] || { id:i, x:myBase.x, y:myBase.y, state:0, value:0 };
    const carrying = (me.state === 1);
    const stunned  = (me.state === 2);
    const myStunCd = stunCd.get(me.id) || 0;

    let eNear = null, eD = 1e9;
    for (const e of enemies){ const d = dist(me.x, me.y, e.x, e.y); if (d<eD){ eD=d; eNear=e; } }

    let gNear = null, gD = 1e9;
    for (const gg of ghosts){ const d = dist(me.x, me.y, gg.x, gg.y); if (d<gD){ gD=d; gNear=gg; } }

    if (carrying){
      const dHome = dist(me.x, me.y, myBase.x, myBase.y);
      actions[i] = (dHome <= GENOME.releaseDist) ? "RELEASE" : \`MOVE \${myBase.x} \${myBase.y}\`;
      continue;
    }

    if (!stunned && eNear && eD <= STUN_RANGE && myStunCd <= 0){
      stunCd.set(me.id, 20);
      actions[i] = \`STUN \${eNear.id}\`;
      continue;
    }

    if (gNear){
      if (gD >= BUST_MIN && gD <= BUST_MAX){
        actions[i] = \`BUST \${gNear.id}\`;
      } else if (gD < BUST_MIN){
        const vx = me.x - gNear.x, vy = me.y - gNear.y;
        const L = Math.hypot(vx,vy) || 1;
        const k = (BUST_MIN + 5) / L;
        actions[i] = \`MOVE \${Math.round(gNear.x + vx*k)} \${Math.round(gNear.y + vy*k)}\`;
      } else {
        actions[i] = \`MOVE \${gNear.x} \${gNear.y}\`;
      }
      continue;
    }

    if (!usedRadar.get(me.id) && tick >= GENOME.radarTurn){
      usedRadar.set(me.id, true);
      actions[i] = "RADAR";
      continue;
    }

    actions[i] = \`MOVE \${myBase.x} \${myBase.y}\`;
  }

  for (let i=0;i<bustersPerPlayer;i++) console.log(actions[i]);
}
`;

const out = path.resolve("my_cg_bot.js");
fs.writeFileSync(out, code);
console.log("Wrote Codingame bot ->", out);
