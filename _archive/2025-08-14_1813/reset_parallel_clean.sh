set -euo pipefail

# 1) Clean worker that runs 1 genome vs 1 opponent (TypeScript, ESM)
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

# 2) Hard-reset ga.ts (keeps public API: trainCEM, compileGenomeToJS)
cat > packages/sim-runner/src/ga.ts <<'TS'
import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { runEpisodes } from './runEpisodes';
import { loadBotModule } from './loadBots';

export type Genome = { radarTurn: number; stunRange: number; releaseDist: number };
export function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

export function genomeToBot(genome: Genome) {
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

export async function buildBaseOppPool() {
  const greedy = await loadBotModule('@busters/agents/greedy');
  const random = await loadBotModule('@busters/agents/random');
  return [
    { name: 'greedy', bot: greedy, spec: '@busters/agents/greedy' },
    { name: 'random', bot: random, spec: '@busters/agents/random' },
  ];
}

type CEMOpts = {
  gens: number; pop: number; elitePct: number;
  seedsPer: number; episodesPerSeed: number;
  oppPool: Array<{ name: string; bot: any; spec?: string }>;
  hofSize: number; seed: number; artifactsDir: string;
  jobs?: number;
};

function randn() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function sampleGenome(m: number[], s: number[]): Genome {
  const g = {
    radarTurn: Math.round(m[0] + s[0] * randn()),
    stunRange: Math.round(m[1] + s[1] * randn()),
    releaseDist: Math.round(m[2] + s[2] * randn()),
  };
  g.radarTurn   = clamp(g.radarTurn, 1, 40);
  g.stunRange   = clamp(g.stunRange, 1200, 1850);
  g.releaseDist = clamp(g.releaseDist, 800, 1600);
  return g;
}
function vecMean(vs: number[][]) {
  const n = vs.length, d = vs[0].length;
  const out = new Array(d).fill(0);
  for (const v of vs) for (let i=0;i<d;i++) out[i]+=v[i];
  for (let i=0;i<d;i++) out[i]/=n;
  return out;
}
function vecStd(vs: number[][], m: number[]) {
  const n = vs.length, d = vs[0].length;
  const out = new Array(d).fill(0);
  for (const v of vs) for (let i=0;i<d;i++) { const dlt=v[i]-m[i]; out[i]+=dlt*dlt; }
  for (let i=0;i<d;i++) out[i]=Math.sqrt(out[i]/Math.max(1,n-1));
  return out;
}

// ---- Serial evaluator (fallback)
async function evalGenomeSerial(g: Genome, opts: CEMOpts) {
  let total = 0;
  for (let si = 0; si < opts.seedsPer; si++) {
    const seed = opts.seed + si;
    const opp = opts.oppPool[si % opts.oppPool.length].bot;
    const me  = genomeToBot(g);
    const res = await runEpisodes({
      seed,
      episodes: opts.episodesPerSeed,
      bustersPerPlayer: 3,
      ghostCount: 12,
      botA: me,
      botB: opp
    } as any);
    total += (res.scoreA - res.scoreB);
  }
  return total / opts.seedsPer;
}

// ---- Parallel evaluator (clean, Node 20 --import)
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

// ---- CEM trainer
export async function trainCEM(opts: CEMOpts) {
  let m = [15, 1700, 1500];
  let s = [6, 120, 120];
  const elitesCount = Math.max(1, Math.round(opts.pop * opts.elitePct));
  const artDir = path.resolve(process.cwd(), opts.artifactsDir);
  fs.mkdirSync(artDir, { recursive: true });

  let bestEverFit = -Infinity;
  let bestEver: Genome | null = null;
  const hof: Genome[] = [];

  for (let gen = 0; gen < opts.gens; gen++) {
    const pop: Genome[] = Array.from({ length: opts.pop }, () => sampleGenome(m, s));

    let fits: number[];
    const jobs = Math.max(1, Math.floor(opts.jobs || 1));
    if (jobs <= 1) {
      fits = [];
      for (let i = 0; i < pop.length; i++) fits.push(await evalGenomeSerial(pop[i], opts));
    } else {
      fits = await evalGenomeParallel(pop, opts);
    }

    const idx = Array.from(pop.keys()).sort((a, b) => fits[b] - fits[a]);
    const bestIdx = idx[0];
    const genBest = pop[bestIdx];
    const genBestFit = fits[bestIdx];

    fs.writeFileSync(path.join(artDir, 'last_gen_best_genome.json'), JSON.stringify(genBest, null, 2));

    if (genBestFit > bestEverFit || !bestEver) {
      bestEverFit = genBestFit; bestEver = genBest;
      fs.writeFileSync(path.join(artDir, 'simrunner_best_genome.json'), JSON.stringify(bestEver, null, 2));
    }

    hof.push(genBest);
    while (hof.length > opts.hofSize) hof.shift();

    const eliteVecs = idx.slice(0, elitesCount).map(i => {
      const g = pop[i];
      return [g.radarTurn, g.stunRange, g.releaseDist];
    });
    const mNew = vecMean(eliteVecs);
    const sNew = vecStd(eliteVecs, mNew);

    const alpha = 0.7;
    m = m.map((mv, i) => alpha * mNew[i] + (1 - alpha) * mv);
    s = s.map((sv, i) => clamp(alpha * sNew[i] + (1 - alpha) * sv, 1, 200));

    console.log(\`CEM gen \${gen}: best=\${genBestFit.toFixed(2)} m=[\${m.map(x=>Math.round(x)).join(',')}] (jobs=\${jobs})\`);
  }

  return { best: bestEver!, fitness: bestEverFit };
}

// ---- Exporter (single-file JS bot)
export function compileGenomeToJS(inPath: string, outPath: string) {
  const absIn = path.resolve(process.cwd(), inPath);
  if (!fs.existsSync(absIn)) throw new Error(\`Genome JSON not found: \${absIn}\`);
  const g = JSON.parse(fs.readFileSync(absIn, 'utf-8')) as Genome;
  const code = \`/** Auto-generated single-file bot from genome */
export const meta = { name: "EvolvedBot", version: "ga" };
export function act(ctx, obs) {
  if (obs.self.carrying !== undefined) {
    const d = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);
    if (d <= \${g.releaseDist}) return { type: 'RELEASE' };
    return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }
  const enemy = obs.enemies?.[0];
  if (enemy && enemy.range <= \${g.stunRange} && obs.self.stunCd <= 0) return { type: 'STUN', busterId: enemy.id };
  const ghost = obs.ghostsVisible?.[0];
  if (ghost) {
    if (ghost.range >= 900 && ghost.range <= 1760) return { type: 'BUST', ghostId: ghost.id };
    return { type: 'MOVE', x: ghost.x, y: ghost.y };
  }
  if (!obs.self.radarUsed && obs.tick >= \${g.radarTurn}) return { type: 'RADAR' };
  return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
}
\`;
  const absOut = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, code);
  console.log(\`Wrote single-file bot -> \${absOut}\`);
}
TS

echo "✅ Reset workerEval.ts and ga.ts"
