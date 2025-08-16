set -euo pipefail

# 1) Rewrite packages/sim-runner/src/workerEval.ts
cat > packages/sim-runner/src/workerEval.ts <<'TS'
import { parentPort } from 'worker_threads';
import { runEpisodes } from './runEpisodes';
import { loadBotModule } from './loadBots';

type Genome = { radarTurn: number; stunRange: number; releaseDist: number };

function genomeToBot(genome: Genome) {
  return {
    meta: { name: 'EvoChild', version: 'worker' },
    act(ctx: any, obs: any) {
      if (obs.self.carrying !== undefined) {
        const d = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);
        if (d <= genome.releaseDist) return { type: 'RELEASE' };
        return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
      }
      const enemy = obs.enemies?.[0];
      if (enemy && enemy.range <= genome.stunRange && obs.self.stunCd <= 0) return { type: 'STUN', busterId: enemy.id };
      const ghost = obs.ghostsVisible?.[0];
      if (ghost) {
        if (ghost.range >= 900 && ghost.range <= 1760) return { type: 'BUST', ghostId: ghost.id };
        return { type: 'MOVE', x: ghost.x, y: ghost.y };
      }
      if (!obs.self.radarUsed && obs.tick >= genome.radarTurn) return { type: 'RADAR' };
      return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
    }
  };
}

parentPort!.on('message', async (msg: any) => {
  try {
    const { id, genome, seed, episodes, opponent } = msg;
    const me = genomeToBot(genome as Genome);
    const opp = await loadBotModule(opponent as string);
    const res = await runEpisodes({
      seed,
      episodes,
      bustersPerPlayer: 3,
      ghostCount: 12,
      botA: me,
      botB: opp
    } as any);
    parentPort!.postMessage({ ok: true, id, diff: res.scoreA - res.scoreB });
  } catch (e: any) {
    parentPort!.postMessage({ ok: false, id: msg?.id, error: String(e?.stack || e) });
  }
});
TS

# 2) Rebuild the whole evalGenomeParallel block in packages/sim-runner/src/ga.ts
#    We only replace the function between our known markers.
F="packages/sim-runner/src/ga.ts"
START='// ==== Worker pool evaluator (parallel) ===='
END='// ==== CEM trainer with GLOBAL-BEST + parallel ===='

# Extract head (through START line)
awk -v s="$START" '{ print; if ($0 ~ s) exit }' "$F" > "$F.head"

# Extract tail (from END line to EOF)
awk -v e="$END" 'f{print} $0 ~ e {f=1; print}' "$F" > "$F.tail"

# New function
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
        // ESM TS worker: preload tsx via --import (Node 20+)
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

# Stitch and replace
cat "$F.head" "$F.block" "$F.tail" > "$F.new"
mv "$F.new" "$F"
rm -f "$F.head" "$F.block" "$F.tail"

echo "✅ Reset workerEval.ts and replaced evalGenomeParallel in ga.ts"
