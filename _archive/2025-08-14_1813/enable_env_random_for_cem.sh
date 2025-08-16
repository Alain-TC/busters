set -euo pipefail

# 1) Replace evalGenomeSerial in ga.ts to sample (2..4 bpp, 8..28 ghosts)
#    with a deterministic LCG from (seed + si)
perl -0777 -i -pe '
  s@async function evalGenomeSerial\([^\)]*\)\s*\{.*?\}@
async function evalGenomeSerial(g: Genome, opts: CEMOpts) {
  // Deterministic per-seed sampler (LCG) -> env params
  function lcg(seed:number){ let s=(seed>>>0)||1; return ()=>{ s = (1664525*s + 1013904223)>>>0; return s/4294967296; }; }
  function pickInt(r:()=>number, lo:number, hi:number){ return Math.floor(lo + r()*(hi-lo+1)); }
  function sampleEnv(seed:number){ const r=lcg(seed); return { bpp: pickInt(r,2,4), ghosts: pickInt(r,8,28) /* stamina bucket is handled inside engine */ }; }

  let total = 0;
  for (let si = 0; si < opts.seedsPer; si++) {
    const seed = opts.seed + si;
    const env  = sampleEnv(seed);
    const opp  = opts.oppPool[si % opts.oppPool.length].bot;
    const me   = genomeToBot(g);
    const res  = await runEpisodes({
      seed,
      episodes: opts.episodesPerSeed,
      bustersPerPlayer: env.bpp,
      ghostCount: env.ghosts,
      botA: me,
      botB: opp
    } as any);
    total += (res.scoreA - res.scoreB);
  }
  return total / opts.seedsPer;
}
@gs' packages/sim-runner/src/ga.ts

# 2) Overwrite workerEval.ts to use the same sampler (keeps workers future-proof)
cat > packages/sim-runner/src/workerEval.ts <<'TS'
import { parentPort } from 'worker_threads';
import { runEpisodes } from './runEpisodes';
import { loadBotModule } from './loadBots';

type Genome = { radarTurn:number; stunRange:number; releaseDist:number; };

function genomeToBot(genome: Genome) {
  return {
    meta: { name: 'EvolvedBot', version: 'ga' },
    act(ctx: any, obs: any) {
      if (obs.self.carrying !== undefined) {
        const dHome = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);
        if (dHome <= genome.releaseDist) return { type: 'RELEASE' };
        return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
      }
      const enemy = obs.enemies?.[0];
      if (enemy && enemy.range <= genome.stunRange && obs.self.stunCd <= 0) return { type: 'STUN', busterId: enemy.id };
      const g = obs.ghostsVisible?.[0];
      if (g) {
        if (g.range >= 900 && g.range <= 1760) return { type: 'BUST', ghostId: g.id };
        return { type: 'MOVE', x: g.x, y: g.y };
      }
      if (!obs.self.radarUsed && obs.tick >= genome.radarTurn) return { type: 'RADAR' };
      return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
    }
  };
}

// Same deterministic sampler as serial path
function lcg(seed:number){ let s=(seed>>>0)||1; return ()=>{ s = (1664525*s + 1013904223)>>>0; return s/4294967296; }; }
function pickInt(r:()=>number, lo:number, hi:number){ return Math.floor(lo + r()*(hi-lo+1)); }
function sampleEnv(seed:number){ const r=lcg(seed); return { bpp: pickInt(r,2,4), ghosts: pickInt(r,8,28) }; }

if (!parentPort) throw new Error('No parentPort in worker');

parentPort.on('message', async (msg: any) => {
  try {
    const env = sampleEnv(msg.seed);
    const me  = genomeToBot(msg.genome as Genome);
    const opp = await loadBotModule(msg.opponent as string);

    const res = await runEpisodes({
      seed: msg.seed,
      episodes: msg.episodes,
      bustersPerPlayer: env.bpp,
      ghostCount: env.ghosts,
      botA: me,
      botB: opp
    } as any);

    parentPort!.postMessage({ ok: true, diff: res.scoreA - res.scoreB });
  } catch (err: any) {
    parentPort!.postMessage({ ok: false, error: String(err?.stack || err) });
  }
});
TS

echo "✅ Environment randomization enabled for CEM (serial & worker)."
