/**
 * Evolved Heuristic Bot — Codingame-compatible single file
 * Params injected by compiler: radarTurn, stunRange, releaseDist
 * Reads from stdin with readline(), prints one action per buster per turn.
 */

const GENOME = {
  radarTurn: 23,
  stunRange: 1766,
  releaseDist: 1600
};

// --- Constants from rules (do not change) ---
const MAP_W = 16001, MAP_H = 9001;
const BASE0 = { x: 0, y: 0 }, BASE1 = { x: 16000, y: 9000 };
const BUST_MIN = 900, BUST_MAX = 1760;
const STUN_MAX_RANGE = 1760, STUN_CD_TURNS = 20;
const BASE_SCORE_RADIUS = 1600;

// --- Utility math ---
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx*dx + dy*dy; };
const dist  = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

// --- Persistent per-buster memory (we track our own cooldowns & radar use) ---
/** stun cooldown turns left per my buster id */
const stunCd = new Map();
/** whether this buster has used RADAR already */
const radarUsed = new Map();

// --- Read init ---
const bustersPerPlayer = parseInt(readline(), 10);
const ghostCount = parseInt(readline(), 10); // not used by policy but read to keep input aligned
const myTeamId = parseInt(readline(), 10);
const myBase = (myTeamId === 0) ? BASE0 : BASE1;
const enemyBase = (myTeamId === 0) ? BASE1 : BASE0;

let tick = 0;

// game loop
while (true) {
  const entities = parseInt(readline(), 10);

  /** visible entities this tick */
  const myBusters = [];   // {id,x,y,state,value}
  const enemies = [];     // {id,x,y,state,value}
  const ghosts = [];      // {id,x,y,stamina,engagedBy}

  for (let i = 0; i < entities; i++) {
    const [eid, sx, sy, etype, sstate, svalue] = readline().split(' ').map(Number);
    if (etype === myTeamId) {
      myBusters.push({ id: eid, x: sx, y: sy, state: sstate, value: svalue });
      if (!stunCd.has(eid)) stunCd.set(eid, 0);
      if (!radarUsed.has(eid)) radarUsed.set(eid, false);
    } else if (etype === -1) {
      ghosts.push({ id: eid, x: sx, y: sy, stamina: sstate, engagedBy: svalue });
    } else {
      enemies.push({ id: eid, x: sx, y: sy, state: sstate, value: svalue });
    }
  }

  // decrement stun cooldowns each tick
  for (const b of myBusters) {
    const cd = stunCd.get(b.id) || 0;
    if (cd > 0) stunCd.set(b.id, cd - 1);
  }

  // Helper: nearest item from (x,y)
  function nearest(arr, x, y) {
    if (arr.length === 0) return null;
    let best = null, bestD2 = Infinity;
    for (const it of arr) {
      const d2 = dist2(x, y, it.x, it.y);
      if (d2 < bestD2) { bestD2 = d2; best = { it, d: Math.sqrt(d2) }; }
    }
    return best;
  }

  // Sort our busters by id for stable output order (CG best practice)
  myBusters.sort((a, b) => a.id - b.id);

  const out = [];

  for (const me of myBusters) {
    const cd = stunCd.get(me.id) || 0;
    const usedRadar = radarUsed.get(me.id) || false;

    // Stunned: action ignored by referee; send a MOVE to be safe
    if (me.state === 2) {
      out.push(`MOVE ${me.x} ${me.y} stunned`);
      continue;
    }

    // Carrying → go home & release when strictly inside base (< BASE_SCORE_RADIUS)
    if (me.state === 1) {
      const dHome = dist(me.x, me.y, myBase.x, myBase.y);
      if (dHome < Math.min(GENOME.releaseDist, BASE_SCORE_RADIUS)) {
        out.push('RELEASE carry→score');
      } else {
        out.push(`MOVE ${myBase.x} ${myBase.y} carry→home`);
      }
      continue;
    }

    // Try STUN if off CD and enemy in range, skipping already stunned targets
    if (cd <= 0 && enemies.length > 0) {
      const ne = nearest(enemies, me.x, me.y);
      if (
        ne &&
        ne.d <= Math.min(GENOME.stunRange, STUN_MAX_RANGE) &&
        ne.it.state !== 2 // avoid wasting STUN on already stunned enemy
      ) {
        stunCd.set(me.id, STUN_CD_TURNS);
        out.push(`STUN ${ne.it.id} stun!`);
        continue;
      }
    }

    // Ghost logic: bust if in [900,1760], else move to it
    const ng = nearest(ghosts, me.x, me.y);
    if (ng) {
      if (ng.d >= BUST_MIN && ng.d <= BUST_MAX) {
        out.push(`BUST ${ng.it.id} bust`);
      } else {
        out.push(`MOVE ${ng.it.x} ${ng.it.y} chase`);
      }
      continue;
    }

    // No target: consider RADAR once after radarTurn
    if (!usedRadar && tick >= GENOME.radarTurn) {
      radarUsed.set(me.id, true);
      out.push('RADAR');
      continue;
    }

    // Fallback exploration: drift toward mid between bases
    const tx = Math.max(0, Math.min(MAP_W - 1, ((myBase.x + enemyBase.x) / 2) | 0));
    const ty = Math.max(0, Math.min(MAP_H - 1, ((myBase.y + enemyBase.y) / 2) | 0));
    out.push(`MOVE ${tx} ${ty} idle`);
  }

  // Emit one command per my buster in order
  for (const line of out) console.log(line);

  tick++;
}

