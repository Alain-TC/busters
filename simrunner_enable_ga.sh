#!/usr/bin/env bash
set -euo pipefail

say(){ printf "\033[1;32m==>\033[0m %s\n" "$*"; }

# Ensure sim-runner declares the agents dep (workspace link)
pnpm -C packages/sim-runner add '@busters/agents@workspace:*'

# -------- src/ga.ts --------
cat > packages/sim-runner/src/ga.ts <<'TS'
import fs from 'fs';
import { runEpisodes } from './runEpisodes';

// --- Simple heuristic genome ---
export type Genome = {
  radarTurn: number;   // use RADAR at/after this tick if no target
  stunRange: number;   // distance threshold for STUN
  releaseDist: number; // release when within this dist to base
};

export function randomGenome(): Genome {
  return {
    radarTurn: Math.floor(Math.random()*30)+10, // [10..39]
    stunRange: 1600 + Math.floor(Math.random()*300), // [1600..1899]
    releaseDist: 1400 + Math.floor(Math.random()*300) // [1400..1699]
  };
}
export function mutate(g: Genome): Genome {
  const jit = (v:number,s:number,lo:number,hi:number)=>Math.min(hi,Math.max(lo,Math.round(v + (Math.random()-0.5)*s)));
  return {
    radarTurn: jit(g.radarTurn, 8, 1, 80),
    stunRange: jit(g.stunRange, 120, 1000, 2000),
    releaseDist: jit(g.releaseDist, 120, 900, 1800),
  };
}
export function crossover(a: Genome, b: Genome): Genome {
  return {
    radarTurn: Math.random()<0.5 ? a.radarTurn : b.radarTurn,
    stunRange: Math.random()<0.5 ? a.stunRange : b.stunRange,
    releaseDist: Math.random()<0.5 ? a.releaseDist : b.releaseDist,
  };
}

// Turn genome into a JS "bot" with act(ctx,obs)
export function genomeToBot(genome: Genome) {
  return {
    meta: { name: 'GA-Bot', version: '0.1' },
    act(ctx: any, obs: any) {
      if (obs.self.carrying !== undefined) {
        const d = Math.hypot(obs.self.x-ctx.myBase.x, obs.self.y-ctx.myBase.y);
        if (d <= genome.releaseDist) return { type:'RELEASE' };
        return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
      }
      const e = obs.enemies[0];
      if (e && e.range <= genome.stunRange && obs.self.stunCd<=0) return { type:'STUN', busterId:e.id };
      const g = obs.ghostsVisible[0];
      if (g) return (g.range>=900&&g.range<=1760) ? { type:'BUST', ghostId:g.id } : { type:'MOVE', x:g.x, y:g.y };
      if (!obs.self.radarUsed && obs.tick >= genome.radarTurn) return { type:'RADAR' };
      return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
    }
  };
}

// Evaluate genome against an opponent across multiple episodes/seeds
export async function evalGenome(g: Genome, opts: {
  episodes: number, seed: number, bpp: number, ghosts: number, opponent: any
}) {
  const botA = genomeToBot(g);
  const res = await runEpisodes({
    seed: opts.seed,
    episodes: opts.episodes,
    bustersPerPlayer: opts.bpp,
    ghostCount: opts.ghosts,
    botA,
    botB: opts.opponent
  });
  return res.scoreA - res.scoreB; // fitness
}

// Train loop (μ+λ GA)
export async function trainGA(params: {
  pop: number, gens: number, elite: number, episodes: number, seed: number, bpp: number, ghosts: number
}) {
  const opponent = await import('@busters/agents/greedy-buster.js');
  let pop: Genome[] = Array.from({length: params.pop}, randomGenome);
  let best = pop[0], bestF = -Infinity;

  for (let gen=0; gen<params.gens; gen++) {
    const fits = await Promise.all(pop.map(g => evalGenome(g, {
      episodes: params.episodes, seed: params.seed + gen*1000, bpp: params.bpp, ghosts: params.ghosts, opponent
    })));
    const ranked = pop.map((g,i)=>({g, f: fits[i]})).sort((a,b)=>b.f-a.f);
    if (ranked[0].f > bestF) { bestF = ranked[0].f; best = ranked[0].g; }
    console.log(`Gen ${gen}: best=${ranked[0].f.toFixed(2)} avg=${(fits.reduce((a,b)=>a+b,0)/fits.length).toFixed(2)}  bestGenome=`, ranked[0].g);

    // next population
    const next: Genome[] = ranked.slice(0, params.elite).map(x=>x.g);
    while (next.length < params.pop) {
      const a = ranked[Math.floor(Math.random()*Math.min(5, ranked.length))].g;
      const b = ranked[Math.floor(Math.random()*Math.min(5, ranked.length))].g;
      next.push(mutate(crossover(a,b)));
    }
    pop = next;
  }

  // Save best
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/simrunner_best_genome.json', JSON.stringify(best, null, 2));
  console.log('Saved best genome -> artifacts/simrunner_best_genome.json (fitness:', bestF.toFixed(2), ')');
  return best;
}

// Compile saved genome to a single-file JS bot
export function compileGenomeToJS(inPath: string, outPath: string) {
  const g = JSON.parse(fs.readFileSync(inPath,'utf8'));
  const file = `// Auto-generated (sim-runner)
// Single-file evolved bot with no external deps.
export const meta = { name: 'EvolvedBot', trained: '${new Date().toISOString()}' };
const G = ${JSON.stringify(g)};
export function act(ctx, obs) {
  if (obs.self.carrying !== undefined) {
    const d = Math.hypot(obs.self.x-ctx.myBase.x, obs.self.y-ctx.myBase.y);
    if (d <= G.releaseDist) return { type:'RELEASE' };
    return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }
  const e = (obs.enemies && obs.enemies[0]);
  if (e && e.range <= G.stunRange && obs.self.stunCd<=0) return { type:'STUN', busterId:e.id };
  const got = (obs.ghostsVisible && obs.ghostsVisible[0]);
  if (got) return (got.range>=900 && got.range<=1760) ? { type:'BUST', ghostId:got.id } : { type:'MOVE', x:got.x, y:got.y };
  if (!obs.self.radarUsed && obs.tick >= G.radarTurn) return { type:'RADAR' };
  return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
}
export default { act, meta };
`;
  fs.writeFileSync(outPath, file);
  console.log('Wrote single-file bot ->', outPath);
}
TS

# -------- src/cli.ts (extend) --------
cat > packages/sim-runner/src/cli.ts <<'TS'
import { runEpisodes } from './runEpisodes';
import { trainGA, compileGenomeToJS } from './ga';

function arg(name: string, def?: string|number|boolean) {
  const k = process.argv.findIndex(a => a === name || a.startsWith(name+'='));
  if (k === -1) return def;
  const v = process.argv[k].includes('=') ? process.argv[k].split('=')[1] : process.argv[k+1];
  if (v === undefined) return true;
  const num = Number(v);
  return Number.isNaN(num) ? v : num;
}

async function main() {
  const mode = (process.argv[2] || 'sim').toString();

  if (mode === 'sim') {
    const a = process.argv[3] || '@busters/agents/random';
    const b = process.argv[4] || '@busters/agents/greedy';
    const botA = await import(a);
    const botB = await import(b);
    const episodes = Number(arg('--episodes', 3));
    const seed = Number(arg('--seed', 42));
    const bpp = Number(arg('--busters', 3));
    const ghosts = Number(arg('--ghosts', 12));
    const res = await runEpisodes({ seed, episodes, bustersPerPlayer: bpp, ghostCount: ghosts, botA, botB });
    console.log(`A(${botA.meta?.name||'A'}) vs B(${botB.meta?.name||'B'}) ->`, res);
    return;
  }

  if (mode === 'train') {
    const pop = Number(arg('--pop', 16));
    const gens = Number(arg('--gens', 12));
    const elite = Number(arg('--elite', 2));
    const episodes = Number(arg('--episodes', 4));
    const seed = Number(arg('--seed', 123));
    const bpp = Number(arg('--busters', 3));
    const ghosts = Number(arg('--ghosts', 12));

    console.log(`Training GA: pop=${pop} gens=${gens} elite=${elite} episodes=${episodes} seed=${seed} bpp=${bpp} ghosts=${ghosts}`);
    const best = await trainGA({ pop, gens, elite, episodes, seed, bpp, ghosts });

    // compile after training
    compileGenomeToJS('artifacts/simrunner_best_genome.json', 'packages/agents/evolved-bot.js');
    return;
  }

  if (mode === 'compile') {
    const inPath = (arg('--in','artifacts/simrunner_best_genome.json') as string);
    const outPath = (arg('--out','packages/agents/evolved-bot.js') as string);
    compileGenomeToJS(inPath, outPath);
    return;
  }

  console.error('Unknown mode. Use one of: sim | train | compile');
  process.exit(1);
}
main();
TS

# Reinstall to refresh links
pnpm install

say "Done. Commands:"
cat <<'MSG'
  # Quick sim (unchanged):
  pnpm sim

  # Train with GA inside sim-runner (then auto-compile to single-file bot)
  pnpm -C packages/sim-runner start train --pop 16 --gens 12 --episodes 4 --seed 123 --busters 3 --ghosts 12

  # After training, your single-file bot is at:
  # packages/agents/evolved-bot.js

  # Try it headless:
  pnpm -C packages/sim-runner start sim packages/agents/evolved-bot.js @busters/agents/greedy-buster.js

  # (Optional) Re-compile from a saved genome:
  pnpm -C packages/sim-runner start compile --in artifacts/simrunner_best_genome.json --out packages/agents/evolved-bot.js
MSG

