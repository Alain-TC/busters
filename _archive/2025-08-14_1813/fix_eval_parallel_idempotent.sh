set -euo pipefail
F="packages/sim-runner/src/ga.ts"
START='// ==== Worker pool evaluator (parallel) ===='
END='// ==== CEM trainer with GLOBAL-BEST + parallel ===='

# 1) Extract head (through the START marker line)
awk -v s="$START" '
  {print}
  $0 ~ s { exit }
' "$F" > "$F.head"

# 2) Extract tail (from the END marker line to EOF)
awk -v e="$END" '
  found { print }
  $0 ~ e { found=1; print }
' "$F" > "$F.tail"

# 3) Write the new function block
cat > "$F.block" <<'TS'
async function evalGenomeParallel(pop: Genome[], opts: CEMOpts) {
  const jobs = Math.max(1, Math.floor(opts.jobs || 1));
  const sums = new Array(pop.length).fill(0);

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

  const queue = tasks.slice();
  let running = 0;

  await new Promise<void>((resolve, reject) => {
    const spawn = () => {
      while (running < jobs && queue.length) {
        const t = queue.shift()!;
        // ESM worker; preload tsx via --import (Node >= 20)
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

  return sums.map(s => s / opts.seedsPer);
}
TS

# 4) Stitch head + START marker + block + tail
# Ensure we end with exactly one START marker line in the output
# (head already includes it)
cat "$F.head" "$F.block" "$F.tail" > "$F.new"
mv "$F.new" "$F"

rm -f "$F.head" "$F.block" "$F.tail"

# 5) Just in case: remove any deprecated loader flags lingering elsewhere
grep -RIl -- '--experimental-loader\|--loader ' packages/sim-runner 2>/dev/null | \
  xargs -I{} sed -i.bak -E 's/--experimental-loader[^"]*//g; s/--loader[^"]*//g' {} || true

echo "✅ Replaced evalGenomeParallel and cleaned old loader flags."
