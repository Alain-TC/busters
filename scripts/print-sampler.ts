import { runEpisodes } from '../packages/sim-runner/src/runEpisodes.ts';
import * as Greedy from '../packages/agents/greedy-buster.js';
import * as Evo from '../packages/agents/evolved-bot.js';

// Collect the (bustersPerPlayer, ghostCount) used for first N episodes
const sampled: Array<{ep:number,bpp:number,ghosts:number}> = [];

await runEpisodes({
  seed: 123,
  episodes: 10,
  bustersPerPlayer: 3,   // defaults; sampler overrides per-episode
  ghostCount: 12,
  botA: Evo,
  botB: Greedy,
  sampler: (ep, rng: any) => {
    const bpp    = 2 + (Math.abs(rng.int?.() ?? (Math.random()*1e9|0)) % 3);   // 2..4
    const ghosts = 8 + (Math.abs(rng.int?.() ?? (Math.random()*1e9|0)) % 21);  // 8..28
    sampled.push({ ep, bpp, ghosts });
    return { bustersPerPlayer: bpp, ghostCount: ghosts, seedOffset: ep * 10007 };
  }
});

console.log(sampled);
