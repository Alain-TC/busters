import type { Observation } from '@busters/shared';

export type Genome = {
  radarTurn: number;
  stunRange: number;
  releaseDist: number;
};

export function randomGenome(): Genome {
  return { radarTurn: Math.floor(Math.random()*30)+10, stunRange: 1700, releaseDist: 1500 };
}
export function mutate(g: Genome): Genome {
  const jitter = (v: number, s: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v + (Math.random()-0.5)*s)));
  return {
    radarTurn: jitter(g.radarTurn, 8, 1, 80),
    stunRange: jitter(g.stunRange, 150, 1000, 2000),
    releaseDist: jitter(g.releaseDist, 150, 900, 1800)
  };
}
export function crossover(a: Genome, b: Genome): Genome {
  return {
    radarTurn: Math.random()<0.5?a.radarTurn:b.radarTurn,
    stunRange: Math.random()<0.5?a.stunRange:b.stunRange,
    releaseDist: Math.random()<0.5?a.releaseDist:b.releaseDist
  };
}

export function genomeToBot(genome: Genome) {
  return {
    meta: { name: 'GA-Bot', version: '0.1' },
    act(ctx: any, obs: Observation) {
      if (obs.self.carrying !== undefined) {
        const d = Math.hypot(obs.self.x-ctx.myBase.x, obs.self.y-ctx.myBase.y);
        if (d <= genome.releaseDist) return { type:'RELEASE' };
        return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
      }
      const e = obs.enemies[0];
      if (e && e.range <= genome.stunRange && obs.self.stunCd<=0) return { type:'STUN', busterId:e.id };
      const g = obs.ghostsVisible[0];
      if (g) return (g.range>=900 && g.range<=1760) ? { type:'BUST', ghostId:g.id } : { type:'MOVE', x:g.x, y:g.y };
      if (!obs.self.radarUsed && obs.tick >= genome.radarTurn) return { type:'RADAR' };
      return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
    }
  };
}
