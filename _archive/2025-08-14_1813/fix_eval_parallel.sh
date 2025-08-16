set -euo pipefail
F="packages/sim-runner/src/ga.ts"

NEW_FUN=$(cat <<'EOF'
async function evalGenomeParallel(pop: Genome[], opts: CEMOpts) {
  const jobs = Math.max(1, Math.floor(opts.jobs || 1));
  // Results aggregated per genome
  const sums = new Array(pop.length).fill(0);

  // Build task queue: one job per (genome, seed)
  type Task = { jid: number; gi: number; seed: number; opponentSpec: string };
  const tasks: Task[] = [];
  let jid = 1;
  for (let gi = 0; gi < pop.length; gi++) {
    for (let si = 0; si < opts.seedsPer; si++) {
      const seed = opts.seed + si;
      const oppSpec = opts.oppPool[si % opts.oppPool.length].spec || '@busters/agents/greedy';
      tasks.push({ jid: jid++, gi, seed, opponentSpec: oppSpec });
    }
  }

  // Worker pool
  const queue = tasks.slice();
  let running = 0;

  await new Promise<void>((resolve, reject) => {
    const spawn = () => {
      while (running < jobs && queue.length) {
        const t = queue.shift()!;
        // ESM worker that preloads tsx via --import (Node >= 20)
        const w = new Worker(new URL('./workerEval.ts', import.meta.url), {
          type: 'module',
          execArgv: [
            '--import',
            'data:text/javascript,import { register } from "node:module"; import { pathToFileURL } from "node:url"; register("tsx", pathToFileURL("./"));'
          ]
        });
        running++;

        w.on('message', (msg: any) => {
          if (!msg.ok) {
            w.terminate();
            reject(new Error(`Worker error on jid=${t.jid}: ${msg.error}`));
            return;
          }
          sums[t.gi] += msg.diff;
          w.terminate();
          running--;
          if (queue.length) spawn();
          if (running === 0 && queue.length === 0) resolve();
        });

        w.on('error', (e) => {
          w.terminate();
          reject(e);
        });

        w.postMessage({
          id: t.jid,
          genome: pop[t.gi],
          seed: t.seed,
          episodes: opts.episodesPerSeed,
          opponent: t.opponentSpec
        });
      }
    };
    spawn();
  });

  // Average over seeds
  return sums.map(s => s / opts.seedsPer);
}
EOF
)

# Splice: keep everything up to the parallel header, insert NEW_FUN,
# then keep from the next header (CEM trainer) onward.
awk -v block="$NEW_FUN" '
  BEGIN{mode=0}
  /\/\/ ==== Worker pool evaluator \(parallel\) ====/ { print; print block; mode=1; next }
  /\/\/ ==== CEM trainer with GLOBAL-BEST \+ parallel ====/ { mode=0 }
  mode==0 { print }
' "$F" > "$F.tmp"

mv "$F.tmp" "$F"

# Nuke any leftover deprecated loader flags in the repo (belt & suspenders)
grep -RIl -- '--loader\|--experimental-loader' packages/sim-runner 2>/dev/null | xargs -I{} sed -i.bak -E 's/--experimental-loader[^"]*//g; s/--loader[^"]*//g' {} || true

echo "✅ evalGenomeParallel replaced and loader flags cleaned."
