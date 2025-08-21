/**
 * CodinGame Busters — EVOL2 exporter
 * Single-file bot generated from local training/tournament artifacts.
 */

const W = 16000, H = 9000;
const BUST_MIN = 900, BUST_MAX = 1760;
const STUN_CD = 20;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function dist(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return Math.hypot(dx, dy); }

// Robust header read (some engines give 3 numbers on one line)
let firstLine = (readline() || '').trim();
let parts = firstLine.split(/\s+/).map(Number).filter(n => !Number.isNaN(n));
let bustersPerPlayer, ghostCount, myTeamId;
if (parts.length >= 3) { [bustersPerPlayer, ghostCount, myTeamId] = parts; }
else { bustersPerPlayer = parts[0]; ghostCount = parseInt(readline()); myTeamId = parseInt(readline()); }

const myBase = (myTeamId === 0) ? {x:0,y:0} : {x:W,y:H};
const enemyBase = (myTeamId === 0) ? {x:W,y:H} : {x:0,y:0};
let tick = 0;

// Per-buster memory: stun cooldown & radar usage & patrol index
const mem = new Map();
function getMem(id){ if(!mem.has(id)) mem.set(id,{stunReadyAt:0,radarUsed:false,wp:0}); return mem.get(id); }

const RELEASE_DIST = 1583;
const STUN_RANGE   = 1589;
const RADAR_TURN   = 6;

// Simple patrols to spread out when nothing visible
const PATROLS = [
  [{x:2500,y:2500},{x:12000,y:2000},{x:15000,y:8000},{x:2000,y:8000},{x:8000,y:4500}],
  [{x:13500,y:6500},{x:8000,y:1200},{x:1200,y:1200},{x:8000,y:7800},{x:8000,y:4500}],
  [{x:8000,y:4500},{x:14000,y:4500},{x:8000,y:8000},{x:1000,y:4500},{x:8000,y:1000}],
  [{x:2000,y:7000},{x:14000,y:7000},{x:14000,y:2000},{x:2000,y:2000},{x:8000,y:4500}]
];

while (true) {
  const n = parseInt(readline()); if (!Number.isFinite(n)) break;
  const allies=[], enemies=[], ghosts=[];
  for (let i=0;i<n;i++){
    const a = readline().trim().split(/\s+/);
    const id=+a[0], x=+a[1], y=+a[2], type=+a[3], state=+a[4], value=+a[5];
    if (type===-1) ghosts.push({id,x,y,st:state,on:value});
    else if (type===myTeamId) allies.push({id,x,y,state,value});
    else enemies.push({id,x,y,state,value});
  }
  allies.sort((a,b)=>a.id-b.id);
  const actions = new Array(bustersPerPlayer).fill(null);

  // choose a scout for RADAR turn
  const scoutId = allies[0] ? allies[0].id : -1;

  for (let ai=0; ai<allies.length; ai++){
    const me = allies[ai]; const m = getMem(me.id);
    const carrying = (me.state===1); const stunned = (me.state===2);

    // 1) Carry → base / release
    if (carrying){
      const d = dist(me.x,me.y,myBase.x,myBase.y);
      if (d <= RELEASE_DIST) { actions[ai] = 'RELEASE'; continue; }
      actions[ai] = 'MOVE '+myBase.x+' '+myBase.y; continue;
    }

    // Build range-ordered views
    const ghostsR = ghosts.map(g=>({g, r:dist(me.x,me.y,g.x,g.y)})).sort((a,b)=>a.r-b.r);
    const enemiesR= enemies.map(e=>({e, r:dist(me.x,me.y,e.x,e.y)})).sort((a,b)=>a.r-b.r);

    // 2) STUN priority: enemy carrying within STUN_RANGE, else nearest enemy within BUST_MAX
    const canStun = (tick >= m.stunReadyAt) && !stunned;
    let toStun = null;
    for (const er of enemiesR){
      if (er.e.state === 2) continue;
      if (er.e.state===1 && er.r <= STUN_RANGE) { toStun = er.e; break; }
    }
    if (!toStun){
      const cand = enemiesR.find(er => er.e.state !== 2 && er.r <= BUST_MAX);
      if (cand) toStun = cand.e;
    }
    if (canStun && toStun){ actions[ai] = 'STUN '+toStun.id; m.stunReadyAt = tick + STUN_CD; continue; }

    // 3) RADAR once at RADAR_TURN by scout
    if (!m.radarUsed && me.id===scoutId && tick===RADAR_TURN && !stunned){
      actions[ai] = 'RADAR'; m.radarUsed = true; continue;
    }

    // 4) BUST ring
    if (ghostsR.length){
      const g = ghostsR[0].g; const r = ghostsR[0].r;
      if (r >= BUST_MIN && r <= BUST_MAX){ actions[ai] = 'BUST '+g.id; continue; }
      actions[ai] = 'MOVE '+g.x+' '+g.y; continue;
    }

    // 5) Intercept enemy carrier
    const carrier = enemiesR.find(er=>er.e.state===1);
    if (carrier){
      const tx = Math.round((carrier.e.x + enemyBase.x)/2);
      const ty = Math.round((carrier.e.y + enemyBase.y)/2);
      actions[ai] = 'MOVE '+clamp(tx,0,W)+' '+clamp(ty,0,H); continue;
    }

    // 6) Patrol exploration
    const path = PATROLS[ai % PATROLS.length];
    let wp = m.wp % path.length; const tgt = path[wp];
    if (dist(me.x,me.y,tgt.x,tgt.y) < 800){ m.wp=(m.wp+1)%path.length; }
    const T = path[m.wp % path.length];
    actions[ai] = 'MOVE '+clamp(T.x,0,W)+' '+clamp(T.y,0,H);
  }

  for (let i=0;i<bustersPerPlayer;i++){
    console.log(actions[i] || ('MOVE '+myBase.x+' '+myBase.y));
  }
  tick++;
}
