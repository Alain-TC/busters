import { GameState, Observation, TeamId } from '@busters/shared';
import { RULES, TEAM0_BASE, TEAM1_BASE } from '@busters/shared';
import { dist } from '@busters/shared';

export function observationsForTeam(state: GameState, teamId: TeamId): Observation[] {
  const res: Observation[] = [];
  const base = teamId === 0 ? TEAM0_BASE : TEAM1_BASE;
  const my = state.busters.filter(b => b.teamId === teamId);
  const opp = state.busters.filter(b => b.teamId !== teamId);

  for (const me of my) {
    const hasRadarVision = !!state.radarNextVision[me.id];
    const vision = hasRadarVision ? RULES.RADAR_VISION : RULES.VISION;
    const ghosts = state.ghosts
      .filter(g => dist(me.x, me.y, g.x, g.y) <= vision)
      .map(g => ({ id: g.id, x: g.x, y: g.y, range: dist(me.x, me.y, g.x, g.y), endurance: g.endurance }))
      .sort((a, b) => a.range - b.range);

    const allies = my
      .filter(b => b.id !== me.id && dist(me.x, me.y, b.x, b.y) <= vision)
      .map(b => ({ id: b.id, x: b.x, y: b.y, range: dist(me.x, me.y, b.x, b.y), stunnedFor: b.state === 2 ? (b.value as number) : 0, carrying: b.state === 1 ? (b.value as number) : undefined }))
      .sort((a, b) => a.range - b.range);

    const enemies = opp
      .filter(b => dist(me.x, me.y, b.x, b.y) <= vision)
      .map(b => ({ id: b.id, x: b.x, y: b.y, range: dist(me.x, me.y, b.x, b.y), stunnedFor: b.state === 2 ? (b.value as number) : 0, carrying: b.state === 1 ? (b.value as number) : undefined }))
      .sort((a, b) => a.range - b.range);

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
