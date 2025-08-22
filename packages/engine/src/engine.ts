import { Action, GameState, TeamId, GhostState, BusterPublicState } from '@busters/shared';
import { RULES, MAP_W, MAP_H, TEAM0_BASE, TEAM1_BASE } from '@busters/shared';
import { clamp, dist, dist2, norm, roundi, XorShift32 } from '@busters/shared';

export type InitOpts = {
  seed?: number;
  bustersPerPlayer: number;
  ghostCount: number;
  /**
   * Weighted distribution for ghost stamina values. Each entry gives the
   * stamina value and its relative weight in the draw.
   */
  enduranceWeights?: Array<{ value: number; weight: number }>;
};

export function initGame({
  seed = 1,
  bustersPerPlayer,
  ghostCount,
  enduranceWeights = [
    { value: 3, weight: 1 },
    { value: 15, weight: 3 },
    { value: 40, weight: 1 },
  ],
}: InitOpts): GameState {
  const busters: BusterPublicState[] = [];
  let id = 0;
  for (let t: TeamId = 0; t < 2; t++) {
    for (let i = 0; i < bustersPerPlayer; i++) {
      const base = t === 0 ? TEAM0_BASE : TEAM1_BASE;
      const x = base.x;
      const y = base.y;
      busters.push({ id: id++, teamId: t, x, y, state: 0, value: 0, stunCd: 0, radarUsed: false });
    }
  }
  const ghosts: GhostState[] = [];
  const rng = new XorShift32(seed);
  const pairCount = Math.floor(ghostCount / 2);
  const randCoord = () => {
    let x: number, y: number;
    do {
      x = Math.floor(rng.float() * MAP_W);
      y = Math.floor(rng.float() * MAP_H);
    } while (
      dist(x, y, TEAM0_BASE.x, TEAM0_BASE.y) < RULES.BASE_RADIUS ||
      dist(x, y, TEAM1_BASE.x, TEAM1_BASE.y) < RULES.BASE_RADIUS
    );
    return { x, y };
  };
  // Official distribution: 20% stamina 3, 60% stamina 15 and 20% stamina 40
  // implemented via weighted draw from `enduranceWeights`.
  const totalWeight = enduranceWeights.reduce((s, e) => s + e.weight, 0);
  const randEndurance = () => {
    let r = rng.float() * totalWeight;
    for (const { value, weight } of enduranceWeights) {
      if (r < weight) return value;
      r -= weight;
    }
    return enduranceWeights[enduranceWeights.length - 1].value; // fallback
  };
  for (let i = 0; i < pairCount; i++) {
    const { x: gx, y: gy } = randCoord();
    const endurance = randEndurance();
    ghosts.push({ id: ghosts.length, x: gx, y: gy, endurance, engagedBy: 0 });
    ghosts.push({
      id: ghosts.length,
      x: MAP_W - 1 - gx,
      y: MAP_H - 1 - gy,
      endurance,
      engagedBy: 0,
    });
  }
  if (ghostCount % 2 === 1) {
    const { x: gx, y: gy } = randCoord();
    const endurance = randEndurance();
    ghosts.push({ id: ghosts.length, x: gx, y: gy, endurance, engagedBy: 0 });
  }
  const state: GameState = {
    seed, tick: 0, width: MAP_W, height: MAP_H,
    bustersPerPlayer, ghostCount,
    scores: { 0: 0, 1: 0 },
    busters, ghosts,
    radarNextVision: {},                 // used by next tick only
    lastSeenTickForGhost: {},
    lastSeenByGhost: {}
  };
  return state;
}

function withinBase(b: { x: number; y: number }): TeamId | null {
  const base0 = dist(b.x, b.y, TEAM0_BASE.x, TEAM0_BASE.y) < RULES.BASE_RADIUS ? 0 : null;
  const base1 = dist(b.x, b.y, TEAM1_BASE.x, TEAM1_BASE.y) < RULES.BASE_RADIUS ? 1 : null;
  return (base0 ?? base1) as TeamId | null;
}

export type ActionsByTeam = Record<TeamId, (Action | undefined)[]>; // index aligned with each team's busters order

export function collectIntents(
  next: GameState,
  actions: ActionsByTeam,
  byTeam: Record<TeamId, BusterPublicState[]>
): Map<number, Action> {
  const intents = new Map<number, Action>(); // busterId -> action
  for (const t of [0, 1] as TeamId[]) {
    const teamActs = actions[t] || [];
    const teamB = byTeam[t];
    for (let i = 0; i < teamB.length; i++) {
      const b = teamB[i];
      const a = teamActs[i];
      if (!a || a.type === 'WAIT') continue;
      if (b.state === 2) continue; // stunned cannot act
      switch (a.type) {
        case 'MOVE':
          intents.set(b.id, {
            type: 'MOVE',
            x: clamp(a.x, 0, next.width - 1),
            y: clamp(a.y, 0, next.height - 1),
          });
          break;
        case 'RELEASE':
        case 'RADAR':
        case 'STUN':
        case 'BUST':
          intents.set(b.id, a);
          break;
        case 'EJECT': {
          const dx = a.x - b.x,
            dy = a.y - b.y;
          const d = Math.hypot(dx, dy);
          const [nx, ny] = norm(dx, dy);
          const travel = Math.min(d, RULES.EJECT_MAX);
          const ex = clamp(roundi(b.x + nx * travel), 0, MAP_W - 1);
          const ey = clamp(roundi(b.y + ny * travel), 0, MAP_H - 1);
          intents.set(b.id, { type: 'EJECT', x: ex, y: ey });
          break;
        }
      }
    }
  }
  return intents;
}

export function applyMoves(next: GameState, intents: Map<number, Action>): void {
  for (const b of next.busters) {
    if (b.state === 2) continue;
    const a = intents.get(b.id);
    if (a?.type === 'MOVE') {
      const dx = a.x - b.x,
        dy = a.y - b.y;
      const d = Math.hypot(dx, dy);
      if (d <= RULES.MOVE_SPEED) {
        b.x = roundi(a.x);
        b.y = roundi(a.y);
      } else {
        const [nx, ny] = norm(dx, dy);
        b.x = roundi(b.x + nx * RULES.MOVE_SPEED);
        b.y = roundi(b.y + ny * RULES.MOVE_SPEED);
      }
    }
  }
}

export function resolveStuns(
  next: GameState,
  intents: Map<number, Action>,
  startCarry: Map<number, number | null>,
  busterById: Map<number, BusterPublicState>,
  dropCarried: (b: BusterPublicState, ghostId: number | null, opts?: { forceNoScore?: boolean }) => void
): void {
  type PendingStun = { attacker: BusterPublicState; target: BusterPublicState };
  const pendingStuns: PendingStun[] = [];
  for (const b of next.busters) {
    if (b.state === 2) continue;
    const a = intents.get(b.id);
    if (a?.type === 'STUN' && b.stunCd <= 0) {
      // cooldown is consumed regardless of target validity or range
      b.stunCd = RULES.STUN_COOLDOWN;
      const target = busterById.get(a.busterId);
      if (target && target.teamId !== b.teamId) {
        const d = dist(b.x, b.y, target.x, target.y);
        if (d <= RULES.STUN_RANGE) {
          pendingStuns.push({ attacker: b, target });
        }
      }
    }
  }

  const stunnedTargets = new Set<number>();
  for (const { target } of pendingStuns) stunnedTargets.add(target.id);
  for (const tid of stunnedTargets) {
    const t = busterById.get(tid);
    if (t) {
      t.state = 2;
      t.value = RULES.STUN_DURATION;
    }
  }
  for (const { attacker, target } of pendingStuns) {
    intents.delete(attacker.id);
    intents.delete(target.id);
    dropCarried(target, startCarry.get(target.id) ?? null);
    dropCarried(attacker, startCarry.get(attacker.id) ?? null);
  }
}

export function handleReleases(
  next: GameState,
  intents: Map<number, Action>,
  ghostById: Map<number, GhostState>
): void {
  for (const b of next.busters) {
    if (b.state === 2) continue;
    const a = intents.get(b.id);
    if (a?.type === 'RADAR' && !b.radarUsed) {
      next.radarNextVision[b.id] = true;
      b.radarUsed = true;
    }
    if (a?.type === 'RELEASE') {
      if (b.state === 1) {
        const baseTeam = withinBase(b);
        const gid = b.value as number;
        if (baseTeam !== null) {
          next.scores[baseTeam] += 1;
          if (baseTeam !== b.teamId) {
            next.scores[b.teamId] -= 1;
          }
          b.state = 0;
          b.value = 0;
        } else {
          next.scores[b.teamId] -= 1;
          const ghost = { id: gid, x: b.x, y: b.y, endurance: 0, engagedBy: 0 };
          next.ghosts.push(ghost);
          ghostById.set(gid, ghost);
          b.state = 0;
          b.value = 0;
        }
      }
    }
    if (a?.type === 'EJECT') {
      if (b.state === 1) {
        const gid = b.value as number;
        const ghost = { id: gid, x: a.x, y: a.y, endurance: 0, engagedBy: 0 };
        next.ghosts.push(ghost);
        ghostById.set(gid, ghost);
        b.state = 0;
        b.value = 0;
      }
    }
  }
}

export function step(state: GameState, actions: ActionsByTeam): GameState {
  // NOTE: radarNextVision is not carried over; it is *consumed* by perception for this tick only
  const next: GameState = {
    ...state,
    tick: state.tick + 1,
    scores: { ...state.scores },
    busters: state.busters.map(b => ({ ...b })),
    ghosts: state.ghosts.map(g => ({ ...g, engagedBy: 0 })),
    radarNextVision: {}, // ← will be filled by RADAR uses this tick, to apply on *next* tick
    lastSeenTickForGhost: { ...state.lastSeenTickForGhost },
    lastSeenByGhost: {}
  };

  // Clear previous "busting" flags from last turn
  for (const b of next.busters) {
    if (b.state === 3) {
      b.state = 0;
      b.value = 0;
    }
  }

  const busterById = new Map<number, BusterPublicState>();
  next.busters.forEach(b => busterById.set(b.id, b));
  const ghostById = new Map<number, GhostState>();
  next.ghosts.forEach(g => ghostById.set(g.id, g));

  // Keep "start-of-tick" facts for edge rules
  const startCarry = new Map<number, number | null>(); // busterId -> ghostId if carrying
  for (const b of state.busters) {
    startCarry.set(b.id, b.state === 1 ? (b.value as number) : null);
  }

  // Fast index by team
  const byTeam: Record<TeamId, BusterPublicState[]> = { 0: [], 1: [] } as any;
  next.busters.forEach(b => byTeam[b.teamId].push(b));

  // 1) Collect intents
  const intents = collectIntents(next, actions, byTeam);

  // 2) Apply MOVE (all positions update before other effects)
  applyMoves(next, intents);

  // Helper to drop (or score) a carried ghost from a buster, id taken from start-of-tick
  const dropped = new Set<number>(); // ghostIds already materialized
  function dropCarried(b: BusterPublicState, ghostId: number | null, opts?: { forceNoScore?: boolean }) {
    if (ghostId === null || dropped.has(ghostId)) return;
    const base = withinBase(b);
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

  // 3) STUN resolution (resets stun duration; both drop any carried ghost; cooldown spent on attempt)
  resolveStuns(next, intents, startCarry, busterById, dropCarried);

  // 4) RELEASE / EJECT / RADAR
  handleReleases(next, intents, ghostById);

  // 5) If a buster is carrying and *attempts* BUST, its carried ghost escapes immediately (no scoring)
  for (const b of next.busters) {
    if (b.state === 2) continue;
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
    if (b.state === 2) continue;
    const a = intents.get(b.id);
    if (a?.type === 'BUST') {
      const g = ghostById.get(a.ghostId);
      if (!g) continue;
      const d = dist(b.x, b.y, g.x, g.y);
      if (d > RULES.BUST_MIN && d < RULES.BUST_MAX) {
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
  const detectedBy: Record<number, Array<{ x: number; y: number }>> = {};
  for (const g of next.ghosts) {
    for (const b of next.busters) {
      const d = dist(b.x, b.y, g.x, g.y);
      if (d <= RULES.VISION) {
        (detectedBy[g.id] ||= []).push({ x: b.x, y: b.y });
      }
    }
  }
  for (const g of next.ghosts) {
    const wasSeenLast = state.lastSeenTickForGhost[g.id] === state.tick - 1;
    const seenPrev = state.lastSeenByGhost[g.id] || [];
    if (wasSeenLast && seenPrev.length) {
      // collect distances to last seen positions
      let minD2 = Infinity;
      const dists: Array<{ p: { x: number; y: number }; d2: number }> = [];
      for (const p of seenPrev) {
        const d2v = dist2(p.x, p.y, g.x, g.y);
        dists.push({ p, d2: d2v });
        if (d2v < minD2) minD2 = d2v;
      }
      const tied = dists.filter(e => e.d2 === minD2);
      let awayFrom = { x: 0, y: 0 };
      if (tied.length > 1) {
        // barycenter of tied nearest
        awayFrom.x = Math.round(tied.reduce((s, e) => s + e.p.x, 0) / tied.length);
        awayFrom.y = Math.round(tied.reduce((s, e) => s + e.p.y, 0) / tied.length);
      } else {
        awayFrom = tied[0] ? { x: tied[0].p.x, y: tied[0].p.y } : { x: g.x, y: g.y };
      }
      const [nx, ny] = norm(g.x - awayFrom.x, g.y - awayFrom.y);
      g.x = clamp(roundi(g.x + nx * RULES.GHOST_FLEE), 0, next.width - 1);
      g.y = clamp(roundi(g.y + ny * RULES.GHOST_FLEE), 0, next.height - 1);
    }
    if (detectedBy[g.id]) {
      next.lastSeenTickForGhost[g.id] = state.tick;
      next.lastSeenByGhost[g.id] = detectedBy[g.id];
    }
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
