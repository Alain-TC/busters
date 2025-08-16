import { runEpisodes } from '@busters/sim-runner/src/runEpisodes';
import { genomeToBot, randomGenome, mutate, crossover, type Genome } from './policy';

async function evalGenome(g: Genome) {
  const bot = genomeToBot(g);
  const opp = (await import('@busters/agents/greedy-buster.js')); // baseline opponent
  const res = await runEpisodes({ seed: 123, episodes: 4, bustersPerPlayer: 3, ghostCount: 12, botA: bot, botB: opp });
  return res.scoreA - res.scoreB;
}

async function main() {
  const POP = 16, GEN = 8, ELITE = 2;
  let pop: Genome[] = Array.from({length: POP}, randomGenome);
  let best = pop[0], bestF = -Infinity;

  for (let gen = 0; gen < GEN; gen++) {
    const fit = await Promise.all(pop.map(evalGenome));
    const ranked = pop.map((g,i)=>({g,f:fit[i]})).sort((a,b)=>b.f-a.f);
    if (ranked[0].f > bestF) { bestF = ranked[0].f; best = ranked[0].g; }
    console.log(`Gen ${gen}: best=${ranked[0].f.toFixed(2)}   genome=`, ranked[0].g);

    const next: Genome[] = ranked.slice(0, ELITE).map(x=>x.g);
    while (next.length < POP) {
      const a = ranked[Math.floor(Math.random()*4)].g;
      const b = ranked[Math.floor(Math.random()*4)].g;
      next.push(mutate(crossover(a,b)));
    }
    pop = next;
  }

  // Save best genome to disk for compilation step
  const fs = await import('fs');
  fs.writeFileSync('artifacts', '', {flag:'a'}); // ensure parent
  fs.mkdirSync('artifacts', { recursive: true });
  fs.writeFileSync('artifacts/best_genome.json', JSON.stringify(best, null, 2));
  console.log('Saved best genome to artifacts/best_genome.json');
}
main();
