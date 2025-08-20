#!/usr/bin/env bash
set -euo pipefail

echo ">> Patch runEpisodes.ts: add per-episode sampler"
cat > packages/sim-runner/src/runEpisodes.ts <<'TS'
import { initGame, step } from '@busters/engine';
import { observationsForTeam } from '@busters/engine';
import { TEAM0_BASE, TEAM1_BASE } from '@busters/shared';
import type { Action, AgentContext } from '@busters/shared';
import { CodinGameRandom } from '@busters/shared';

export interface RunOpts {
  seed: number;
  episodes: number;
  bustersPerPlayer: number;  // default when no sampler provided
  ghostCount: number;        // default when no sampler provided
  botA: any;
  botB: any;
  onTick?: (state: any) => void;
  /**
   * Optional sampler to vary params per episode while keeping determinism.
   * If provided, it overrides bustersPerPlayer/ghostCount/seed for that episode.
   */
  sampler?: (epIndex: number, rng: CodinGameRandom) => {
    bustersPerPlayer: number;
    ghostCount: number;
    seedOffset?: number; // added to base seed to create the episode seed
  };
}

export async function runEpisodes(opts: RunOpts) {
  let totalScoreA = 0, totalScoreB = 0;
  const masterRng = new CodinGameRandom(opts.seed ^ 0x9e3779b1);

  for (let ep = 0; ep < opts.episodes; ep++) {
    const s = opts.sampler?.(ep, masterRng);
    const bpp   = s?.bustersPerPlayer ?? opts.bustersPerPlayer;
    const ghosts= s?.ghostCount ?? opts.ghostCount;
    const epSeed = opts.seed + ep + (s?.seedOffset ?? 0);

    let state = initGame({
      seed: epSeed,
      bustersPerPlayer: bpp,
      ghostCount: ghosts
    });

    const ctxA: AgentContext = { teamId: 0, mapW: state.width, mapH: state.height, myBase: TEAM0_BASE };
    const ctxB: AgentContext = { teamId: 1, mapW: state.width, mapH: state.height, myBase: TEAM1_BASE };

    while (true) {
      const obsA = observationsForTeam(state, 0);
      const obsB = observationsForTeam(state, 1);

      const actsA: Action[] = obsA.map(o => (opts.botA.act ? opts.botA.act(ctxA, o) : opts.botA.default?.act(ctxA, o)));
      const actsB: Action[] = obsB.map(o => (opts.botB.act ? opts.botB.act(ctxB, o) : opts.botB.default?.act(ctxB, o)));

      state = step(state, { 0: actsA, 1: actsB } as any);

      opts.onTick?.(state);

      if (state.tick >= 250 || state.ghosts.length === 0) break;
    }

    totalScoreA += state.scores[0];
    totalScoreB += state.scores[1];
  }

  return { scoreA: totalScoreA, scoreB: totalScoreB };
}
TS

echo ">> Patch ga.ts: use sampler to randomize (2..4 busters, 8..28 ghosts) per episode"
# This patch assumes your ga.ts already exists from our earlier steps.
# We will replace the trainGA function body to pass a sampler.
awk '
  BEGIN{p=1}
  /export async function trainGA\(/ {p=0; print; print "{"
    print "  const opponent = await import(\"../../agents/greedy-buster.js\");"
    print "  let pop: Genome[] = Array.from({length: params.pop}, randomGenome);"
    print "  let best = pop[0], bestF = -Infinity;"
    print ""
    print "  // seeded sampler for per-episode randomness within constraints"
    print "  const sampler = (ep:number, rng:any) => {"
    print "    // sample integers: bpp in {2,3,4}, ghosts in [8..28]"
    print "    const bpp = 2 + (rng.int() % 3 + 3) % 3; // 2..4"
    print "    const ghosts = 8 + (rng.int() % 21 + 21) % 21; // 8..28"
    print "    return { bustersPerPlayer: bpp, ghostCount: ghosts, seedOffset: (ep*10007) };"
    print "  };"
    print ""
    print "  for (let gen=0; gen<params.gens; gen++) {"
    print "    const fits = await Promise.all(pop.map(async (g) => {"
    print "      const botA = genomeToBot(g);"
    print "      const res = await runEpisodes({"
    print "        seed: params.seed + gen*12345,"
    print "        episodes: params.episodes,"
    print "        bustersPerPlayer: params.bpp,"
    print "        ghostCount: params.ghosts,"
    print "        botA,"
    print "        botB: opponent,"
    print "        sampler"
    print "      });"
    print "      return res.scoreA - res.scoreB;"
    print "    }));"
    print "    const ranked = pop.map((g,i)=>({g, f: fits[i]})).sort((a,b)=>b.f-a.f);"
    print "    if (ranked[0].f > bestF) { bestF = ranked[0].f; best = ranked[0].g; }"
    print "    const avg = fits.reduce((a,b)=>a+b,0)/fits.length;"
    print "    console.log(`Gen ${gen}: best=${ranked[0].f.toFixed(2)} avg=${avg.toFixed(2)}  bestGenome=`, ranked[0].g);"
    print ""
    print "    const next: Genome[] = ranked.slice(0, params.elite).map(x=>x.g);"
    print "    while (next.length < params.pop) {"
    print "      const a = ranked[Math.floor(Math.random()*Math.min(5, ranked.length))].g;"
    print "      const b = ranked[Math.floor(Math.random()*Math.min(5, ranked.length))].g;"
    print "      next.push(mutate(crossover(a,b)));"
    print "    }"
    print "    pop = next;"
    print "  }"
    print ""
    print "  // Save best at sim-runner level (same as before)"
    print "  const fs = await import(\"fs\");"
    print "  fs.mkdirSync(\"artifacts\", { recursive: true });"
    print "  fs.writeFileSync(\"artifacts/simrunner_best_genome.json\", JSON.stringify(best, null, 2));"
    print "  console.log(\"Saved best genome -> artifacts/simrunner_best_genome.json (fitness:\", bestF.toFixed(2), \")\");"
    print "  return best;"
    print "}"
    next
  }
  { if(p) print }
' packages/sim-runner/src/ga.ts > /tmp/ga.ts.new

mv /tmp/ga.ts.new packages/sim-runner/src/ga.ts

echo ">> Done. Training will now randomize bustersPerPlayer (2..4) and ghostCount (8..28) per episode."
