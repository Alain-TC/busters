import { GameState, Observation, TeamId } from '@busters/shared';
import { RULES, TEAM0_BASE, TEAM1_BASE } from '@busters/shared';
import { dist2 } from '@busters/shared';

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
