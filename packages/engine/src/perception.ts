import { GameState, Observation, TeamId } from '@busters/shared';
import { RULES, TEAM0_BASE, TEAM1_BASE } from '@busters/shared';
import { dist2 } from '@busters/shared';

export type EntityView = {
  id: number;
  x: number;
  y: number;
  entityType: number; // -1 for ghost, team id for busters
  state: number;
  value: number;
};

export function observationsForTeam(state: GameState, teamId: TeamId): Observation[] {
  const res: Observation[] = [];
  const base = teamId === 0 ? TEAM0_BASE : TEAM1_BASE;
  const my = state.busters.filter(b => b.teamId === teamId);
  const opp = state.busters.filter(b => b.teamId !== teamId);

  for (const me of my) {
    const hasRadarVision = !!state.radarNextVision[me.id];
    const vision = hasRadarVision ? RULES.RADAR_VISION : RULES.VISION;
    const vision2 = vision * vision;

    const ghosts: { id: number; x: number; y: number; range: number; endurance: number }[] = [];
    for (const g of state.ghosts) {
      const d2 = dist2(me.x, me.y, g.x, g.y);
      if (d2 <= vision2) {
        ghosts.push({ id: g.id, x: g.x, y: g.y, range: Math.sqrt(d2), endurance: g.endurance });
      }
    }
    ghosts.sort((a, b) => a.range - b.range);

    const allies: { id: number; x: number; y: number; range: number; stunnedFor: number; carrying?: number }[] = [];
    for (const b of my) {
      if (b.id === me.id) continue;
      const d2 = dist2(me.x, me.y, b.x, b.y);
      if (d2 <= vision2) {
        allies.push({ id: b.id, x: b.x, y: b.y, range: Math.sqrt(d2), stunnedFor: b.state === 2 ? (b.value as number) : 0, carrying: b.state === 1 ? (b.value as number) : undefined });
      }
    }
    allies.sort((a, b) => a.range - b.range);

    const enemies: { id: number; x: number; y: number; range: number; stunnedFor: number; carrying?: number }[] = [];
    for (const b of opp) {
      const d2 = dist2(me.x, me.y, b.x, b.y);
      if (d2 <= vision2) {
        enemies.push({ id: b.id, x: b.x, y: b.y, range: Math.sqrt(d2), stunnedFor: b.state === 2 ? (b.value as number) : 0, carrying: b.state === 1 ? (b.value as number) : undefined });
      }
    }
    enemies.sort((a, b) => a.range - b.range);

    res.push({
      tick: state.tick,
      self: { id: me.id, x: me.x, y: me.y, stunnedFor: me.state === 2 ? (me.value as number) : 0, carrying: me.state === 1 ? (me.value as number) : undefined, stunCd: me.stunCd, radarUsed: me.radarUsed },
      myBase: base,
      ghostsVisible: ghosts,
      allies,
      enemies
    });
  }
  return res;
}

// CodinGame-style entity list for one team (union of vision of its busters)
export function entitiesForTeam(state: GameState, teamId: TeamId): EntityView[] {
  const my = state.busters.filter(b => b.teamId === teamId);
  const opp = state.busters.filter(b => b.teamId !== teamId);

  const visibleEnemies = new Map<number, typeof opp[number]>();
  const visibleGhosts = new Map<number, typeof state.ghosts[number]>();

  for (const me of my) {
    const hasRadar = !!state.radarNextVision[me.id];
    const vision = hasRadar ? RULES.RADAR_VISION : RULES.VISION;
    const vision2 = vision * vision;

    for (const g of state.ghosts) {
      if (visibleGhosts.has(g.id)) continue;
      if (dist2(me.x, me.y, g.x, g.y) <= vision2) {
        visibleGhosts.set(g.id, g);
      }
    }

    for (const e of opp) {
      if (visibleEnemies.has(e.id)) continue; // already visible
      if (dist2(me.x, me.y, e.x, e.y) <= vision2) {
        visibleEnemies.set(e.id, e);
      }
    }
  }

  // Collect all entities then sort globally by id to mirror CodinGame ordering
  const own = my.map(b => ({
    id: b.id,
    x: b.x,
    y: b.y,
    entityType: teamId,
    state: b.state,
    value: b.state === 1 || b.state === 2 || b.state === 3 ? b.value : b.stunCd
  }));

  const enemies = Array.from(visibleEnemies.values())
    .filter(b => b.teamId !== teamId)
    .map(b => ({
      id: b.id,
      x: b.x,
      y: b.y,
      entityType: b.teamId,
      state: b.state,
      value: b.state === 1 || b.state === 2 || b.state === 3 ? b.value : 0
    }));

  const ghosts = Array.from(visibleGhosts.values()).map(g => ({
    id: g.id,
    x: g.x,
    y: g.y,
    entityType: -1,
    state: g.endurance,
    value: g.engagedBy
  }));

  const res: EntityView[] = [...own, ...enemies, ...ghosts];
  res.sort((a, b) => a.id - b.id);
  return res;
}
