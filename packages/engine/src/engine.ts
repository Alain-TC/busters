import { Action, GameState, TeamId, GhostState, BusterPublicState } from '@busters/shared';
import { RULES, MAP_W, MAP_H, TEAM0_BASE, TEAM1_BASE } from '@busters/shared';
import { clamp, dist, dist2, norm, roundi } from '@busters/shared';
import { XorShift32 } from '@busters/shared';

export type InitOpts = { seed?: number; bustersPerPlayer: number; ghostCount: number; endurancePool?: number[] };

export function initGame({ seed = 1, bustersPerPlayer, ghostCount, endurancePool = [3, 15, 40] }: InitOpts): GameState {
  const rng = new XorShift32(seed);
  const busters: BusterPublicState[] = [];
  let id = 0;
  for (let t: TeamId = 0; t < 2; t++) {
    for (let i = 0; i < bustersPerPlayer; i++) {
      const base = t === 0 ? TEAM0_BASE : TEAM1_BASE;
      const jitterX = Math.floor((rng.float() - 0.5) * 400);
      const jitterY = Math.floor((rng.float() - 0.5) * 400);
      busters.push({ id: id++, teamId: t, x: base.x + jitterX, y: base.y + jitterY, state: 0, value: 0, stunCd: 0, radarUsed: false });
    }
  }
  const ghosts: GhostState[] = [];
  for (let g = 0; g < ghostCount; g++) {
    const gx = Math.floor(rng.float() * (MAP_W - 1000)) + 500;
    const gy = Math.floor(rng.float() * (MAP_H - 1000)) + 500;
    const endurance = endurancePool[Math.floor(rng.float() * endurancePool.length)];
    ghosts.push({ id: g, x: gx, y: gy, endurance, engagedBy: 0 });
  }
  const state: GameState = {
    seed, tick: 0, width: MAP_W, height: MAP_H,
    bustersPerPlayer, ghostCount,
    scores: { 0: 0, 1: 0 },
    busters, ghosts,
    radarNextVision: {},                 // used by next tick only
    lastSeenTickForGhost: {}
  };
  return state;
}

function withinBase(b: {x:number;y:number}): { team: TeamId | null } {
  const base0 = dist(b.x, b.y, TEAM0_BASE.x, TEAM0_BASE.y) <= RULES.BASE_RADIUS ? 0 : null;
  const base1 = dist(b.x, b.y, TEAM1_BASE.x, TEAM1_BASE.y) <= RULES.BASE_RADIUS ? 1 : null;
  return { team: (base0 ?? base1) as TeamId | null };
}

export type ActionsByTeam = Record<TeamId, Action[]>; // index aligned with each team's busters order

export function step(state: GameState, actions: ActionsByTeam): GameState {
  // NOTE: radarNextVision is not carried over; it is *consumed* by perception for this tick only
  const next: GameState = {
    ...state,
    tick: state.tick + 1,
    busters: state.busters.map(b => ({ ...b, state: b.state === 3 ? 0 : b.state })),
    ghosts: state.ghosts.map(g => ({ ...g, engagedBy: 0 })),
    radarNextVision: {}, // ← will be filled by RADAR uses this tick, to apply on *next* tick
    lastSeenTickForGhost: { ...state.lastSeenTickForGhost }
  };

  const busterById = new Map<number, BusterPublicState>();
  next.busters.forEach(b => busterById.set(b.id, b));
  const ghostById = new Map<number, GhostState>();
  next.ghosts.forEach(g => ghostById.set(g.id, g));

  // Keep "start-of-tick" facts for edge rules
  const startCarry = new Map<number, number | null>(); // busterId -> ghostId if carrying
  const startStates = new Map<number, number>();       // busterId -> state at start
  for (const b of state.busters) {
    startCarry.set(b.id, b.state === 1 ? (b.value as number) : null);
    startStates.set(b.id, b.state);
  }

  // Fast index by team
  const byTeam: Record<TeamId, BusterPublicState[]> = { 0: [], 1: [] } as any;
  next.busters.forEach(b => byTeam[b.teamId].push(b));

  // 1) Collect intents
  const intents = new Map<number, Action>(); // busterId -> action
  for (const t of [0, 1] as TeamId[]) {
    const teamActs = actions[t] || [];
    const teamB = byTeam[t];
    for (let i = 0; i < teamB.length; i++) {
      const b = teamB[i];
      const a = teamActs[i];
      if (!a) continue;
      if (b.state === 2) continue; // stunned cannot act
      switch (a.type) {
        case 'MOVE': intents.set(b.id, { type: 'MOVE', x: clamp(a.x, 0, next.width - 1), y: clamp(a.y, 0, next.height - 1) }); break;
        case 'RELEASE': intents.set(b.id, a); break;
        case 'RADAR': intents.set(b.id, a); break;
        case 'EJECT': {
          const dx = a.x - b.x, dy = a.y - b.y; const [nx, ny] = norm(dx, dy);
          intents.set(b.id, { type: 'EJECT', x: roundi(b.x + nx * RULES.EJECT_MAX), y: roundi(b.y + ny * RULES.EJECT_MAX) });
          break;
        }
        case 'STUN': intents.set(b.id, a); break;
        case 'BUST': intents.set(b.id, a); break;
      }
    }
  }

  // 2) Apply MOVE (all positions update before other effects)
  for (const b of next.busters) {
    const a = intents.get(b.id);
    if (a?.type === 'MOVE') {
      const dx = a.x - b.x, dy = a.y - b.y; const d = Math.hypot(dx, dy);
      if (d <= RULES.MOVE_SPEED) { b.x = roundi(a.x); b.y = roundi(a.y); }
      else { const [nx, ny] = norm(dx, dy); b.x = roundi(b.x + nx * RULES.MOVE_SPEED); b.y = roundi(b.y + ny * RULES.MOVE_SPEED); }
    }
  }

  // Helper to drop (or score) a carried ghost from a buster, id taken from start-of-tick
  const dropped = new Set<number>(); // ghostIds already materialized
  function dropCarried(b: BusterPublicState, ghostId: number | null, opts?: { forceNoScore?: boolean }) {
    if (ghostId === null || dropped.has(ghostId)) return;
    const base = withinBase(b).team;
    if (!opts?.forceNoScore && base !== null) {
      next.scores[base] += 1; // scoring on drop in base (attacker or victim)
      // no ghost added back to the map
    } else {
      const ghost = { id: ghostId, x: b.x, y: b.y, endurance: 0, engagedBy: 0 };
      next.ghosts.push(ghost);
      ghostById.set(ghostId, ghost);
      dropped.add(ghostId);
    }
    // clear carry flag on this buster (keep stunned if applicable)
    if (b.state === 1) { b.state = 0; b.value = 0; }
  }

  // 3) STUN resolution (extends stunned by +10; both drop any carried ghost)
  for (const b of next.busters) {
    const a = intents.get(b.id);
    if (a?.type === 'STUN' && b.stunCd <= 0) {
      const target = busterById.get(a.busterId);
      if (target && target.teamId !== b.teamId) {
        const d = dist(b.x, b.y, target.x, target.y);
        if (d <= RULES.STUN_RANGE) {
          // Extend or set stun
          const wasStunned = startStates.get(target.id) === 2;
          const prev = wasStunned ? (typeof target.value === 'number' ? (target.value as number) : 0) : 0;
          target.state = 2;
          target.value = prev + RULES.STUN_DURATION;

          // Both sides drop what they were carrying (start-of-tick)
          dropCarried(target, startCarry.get(target.id) ?? null);
          dropCarried(b,      startCarry.get(b.id)      ?? null);

          // cooldown
          b.stunCd = RULES.STUN_COOLDOWN;
        }
      }
    }
  }

  // 4) RELEASE / EJECT / RADAR
  for (const b of next.busters) {
    const a = intents.get(b.id);
    if (a?.type === 'RADAR' && !b.radarUsed) {
      // RADAR applies next turn only
      next.radarNextVision[b.id] = true;
      b.radarUsed = true;
    }
    if (a?.type === 'RELEASE') {
      if (b.state === 1) {
        const baseTeam = withinBase(b).team;
        const gid = b.value as number;
        if (baseTeam !== null) {
          // score + ghost removed from game
          next.scores[baseTeam] += 1;
          // (ghost was already removed from map when captured)
          b.state = 0; b.value = 0;
        } else {
          // drop to ground (no score)
          const ghost = { id: gid, x: b.x, y: b.y, endurance: 0, engagedBy: 0 };
          next.ghosts.push(ghost);
          ghostById.set(gid, ghost);
          b.state = 0; b.value = 0;
        }
      }
    }
    if (a?.type === 'EJECT') {
      if (b.state === 1) {
        const gid = b.value as number;
        const ghost = { id: gid, x: a.x, y: a.y, endurance: 0, engagedBy: 0 };
        next.ghosts.push(ghost);
        ghostById.set(gid, ghost);
        b.state = 0; b.value = 0;
      }
    }
  }

  // 5) If a buster is carrying and *attempts* BUST, its carried ghost escapes immediately (no scoring)
  for (const b of next.busters) {
    const a = intents.get(b.id);
    if (a?.type === 'BUST' && (startCarry.get(b.id) ?? null) !== null) {
      const gid = startCarry.get(b.id)!;
      // force no score even if inside base: it's an escape, not a release
      if (!dropped.has(gid)) {
        const ghost = { id: gid, x: b.x, y: b.y, endurance: 0, engagedBy: 0 };
        next.ghosts.push(ghost);
        ghostById.set(gid, ghost);
        dropped.add(gid);
      }
      // clear carry
      if (b.state === 1) { b.state = 0; b.value = 0; }
    }
  }

  // 6) BUST accumulation & capture decision
  const bustingByGhost = new Map<number, { byTeam: Record<TeamId, number>; closest: Record<TeamId, { b: BusterPublicState; d2: number } | null> }>();
  for (const g of next.ghosts) bustingByGhost.set(g.id, { byTeam: { 0: 0, 1: 0 } as any, closest: { 0: null, 1: null } });

  for (const b of next.busters) {
    const a = intents.get(b.id);
    if (a?.type === 'BUST') {
      const g = ghostById.get(a.ghostId);
      if (!g) continue;
      const d = dist(b.x, b.y, g.x, g.y);
      if (d >= RULES.BUST_MIN && d <= RULES.BUST_MAX) {
        const acc = bustingByGhost.get(g.id)!;
        acc.byTeam[b.teamId] += 1;
        const d2curr = dist2(b.x, b.y, g.x, g.y);
        const c = acc.closest[b.teamId];
        if (!c || d2curr < c.d2) acc.closest[b.teamId] = { b, d2: d2curr };
        g.engagedBy += 1;
        // state flag (optional)
        b.state = b.state === 2 ? 2 : 3;
        b.value = g.id as any;
      }
    }
  }

  // Endurance loss
  for (const g of next.ghosts) {
    const acc = bustingByGhost.get(g.id);
    if (!acc) continue;
    const hits = (acc.byTeam[0] || 0) + (acc.byTeam[1] || 0);
    if (hits > 0) g.endurance = Math.max(0, g.endurance - hits);
  }

  // Capture resolution with team-priority and nearest inside winning team
  const captured: { ghostId: number; winnerTeam: TeamId; takerBusterId: number }[] = [];
  for (const g of next.ghosts) {
    if (g.endurance > 0) continue;
    const acc = bustingByGhost.get(g.id); if (!acc) continue;
    const n0 = acc.byTeam[0] || 0, n1 = acc.byTeam[1] || 0;
    if (n0 === 0 && n1 === 0) continue;
    if (n0 === n1) continue; // tie ⇒ no capture this turn
    const winner = (n0 > n1 ? 0 : 1) as TeamId;
    const closest = acc.closest[winner];
    if (closest) captured.push({ ghostId: g.id, winnerTeam: winner, takerBusterId: closest.b.id });
  }
  if (captured.length) {
    for (const c of captured) {
      next.ghosts = next.ghosts.filter(g => g.id !== c.ghostId);
      ghostById.delete(c.ghostId);
      const carrier = busterById.get(c.takerBusterId);
      if (carrier) { carrier.state = 1; carrier.value = c.ghostId; }
    }
  }

  // 7) Ghost flee: one tick after they were seen; tie → flee from barycenter of tied nearest busters
  const detectedNow = new Set<number>();
  for (const g of next.ghosts) {
    for (const b of next.busters) {
      const d = dist(b.x, b.y, g.x, g.y);
      if (d <= RULES.VISION) { detectedNow.add(g.id); break; }
    }
  }
  for (const g of next.ghosts) {
    const wasSeenLast = state.lastSeenTickForGhost[g.id] === state.tick - 1;
    if (wasSeenLast) {
      // collect distances to all busters
      let minD2 = Infinity;
      const dists: Array<{b:BusterPublicState; d2:number}> = [];
      for (const b of next.busters) {
        const d2v = dist2(b.x, b.y, g.x, g.y);
        dists.push({ b, d2: d2v });
        if (d2v < minD2) minD2 = d2v;
      }
      const tied = dists.filter(e => e.d2 === minD2);
      let awayFrom = { x: 0, y: 0 };
      if (tied.length > 1) {
        // barycenter of tied nearest
        awayFrom.x = Math.round(tied.reduce((s,e)=>s+e.b.x,0)/tied.length);
        awayFrom.y = Math.round(tied.reduce((s,e)=>s+e.b.y,0)/tied.length);
      } else {
        awayFrom = tied[0] ? { x: tied[0].b.x, y: tied[0].b.y } : { x: g.x, y: g.y };
      }
      const [nx, ny] = norm(g.x - awayFrom.x, g.y - awayFrom.y);
      g.x = clamp(roundi(g.x + nx * RULES.GHOST_FLEE), 0, next.width - 1);
      g.y = clamp(roundi(g.y + ny * RULES.GHOST_FLEE), 0, next.height - 1);
    }
    if (detectedNow.has(g.id)) next.lastSeenTickForGhost[g.id] = next.tick;
  }

  // 8) Timers
  for (const b of next.busters) {
    if (b.state === 2) {
      b.value = Math.max(0, (b.value as number) - 1);
      if (b.value === 0) { b.state = 0; }
    }
    if (b.stunCd > 0) b.stunCd -= 1;
  }

  return next;
}
