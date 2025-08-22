import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const art = path.resolve(__dirname, "../packages/sim-runner/artifacts/simrunner_best_genome.json");
if (!fs.existsSync(art)) {
  throw new Error("Missing artifacts/simrunner_best_genome.json — run training first.");
}
const g = JSON.parse(fs.readFileSync(art, "utf-8"));

const code = `/**
 * EvolvedBot — Codingame single-file bot (auto-generated)
 * Params: radarTurn=${g.radarTurn}, stunRange=${g.stunRange}, releaseDist=${g.releaseDist}
 */

function dist(ax, ay, bx, by){ const dx=ax-bx, dy=ay-by; return Math.hypot(dx,dy); }

const GENOME = { radarTurn:${g.radarTurn}, stunRange:${g.stunRange}, releaseDist:${g.releaseDist} };
const BUST_MIN = 900, BUST_MAX = 1760;
const BASE_SCORE_RADIUS = 1600;

const bustersPerPlayer = parseInt(readline(),10);
const ghostCount = parseInt(readline(),10);
const myTeamId = parseInt(readline(),10);
const myBase = (myTeamId===0) ? {x:0,y:0} : {x:16000,y:9000};

const radarUsed = new Map(); // id -> boolean
const stunCd    = new Map(); // id -> cooldown turns

for (let i=0;i<bustersPerPlayer;i++){
  radarUsed.set(i, false);
  stunCd.set(i, 0);
}

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

  const actions = [];

  // Output exactly bustersPerPlayer actions
  for (let i=0;i<bustersPerPlayer;i++){
    const me = myBusters[i] || myBusters[0] || { id:-1, x:myBase.x, y:myBase.y, state:0, value:0 };
    const carrying = (me.state === 1);
    const myStun = stunCd.get(me.id) || 0;
    const usedRadar = radarUsed.get(me.id) || false;

    let nearestEnemy = null, dE = Infinity;
    for (const e of enemies){ const d = dist(me.x, me.y, e.x, e.y); if (d<dE){ dE=d; nearestEnemy={id:e.id,range:d,x:e.x,y:e.y}; } }

    let targetGhost = null, dG = Infinity;
    for (const gh of ghosts){ const d = dist(me.x, me.y, gh.x, gh.y); if (d<dG){ dG=d; targetGhost={id:gh.id,range:d,x:gh.x,y:gh.y}; } }

    if (carrying){
      const dHome = dist(me.x, me.y, myBase.x, myBase.y);
      if (dHome < Math.min(GENOME.releaseDist, BASE_SCORE_RADIUS)) { actions.push("RELEASE"); }
      else { actions.push(\`MOVE \${myBase.x} \${myBase.y}\`); }
    } else {
      if (nearestEnemy && nearestEnemy.range <= GENOME.stunRange && myStun <= 0){
        stunCd.set(me.id, 20);
        actions.push(\`STUN \${nearestEnemy.id}\`);
      } else if (targetGhost){
        if (targetGhost.range >= BUST_MIN && targetGhost.range <= BUST_MAX){
          actions.push(\`BUST \${targetGhost.id}\`);
        } else {
          actions.push(\`MOVE \${targetGhost.x} \${targetGhost.y}\`);
        }
      } else if (!usedRadar && tick >= GENOME.radarTurn){
        radarUsed.set(me.id, true);
        actions.push("RADAR");
      } else {
        actions.push(\`MOVE \${myBase.x} \${myBase.y}\`);
      }
    }
  }

  for (let i=0;i<bustersPerPlayer;i++) console.log(actions[i] || \`MOVE \${myBase.x} \${myBase.y}\`);
}
`;

const out = path.resolve(__dirname, "../my_cg_bot.js");
fs.writeFileSync(out, code);
console.log("Wrote Codingame bot ->", out);
