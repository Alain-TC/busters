import fs from 'fs';
import path from 'path';
import { Worker } from 'worker_threads';
import { runEpisodes } from './runEpisodes';
import { loadBotModule } from './loadBots';
import { loadElo, saveElo, pickOpponentPFSP, ensureOpponentId, recordMatch, PFSPCandidate } from './elo';
import { selectOpponentsPFSP } from "./pfsp";

// ===== Genome & simple policy =====
export type Genome = {
  radarTurn: number;
  stunRange: number;
  releaseDist: number;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

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

// One global Hall of Fame (best of gen each generation)
const HOF: Genome[] = [];

// Bot from genome
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
      if (enemy && enemy.range <= genome.stunRange && obs.self.stunCd <= 0) {
        return { type: 'STUN', busterId: enemy.id };
      }
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

// ==== Opponent pool ====
export async function buildBaseOppPool() {
  const greedy = await loadBotModule('@busters/agents/greedy');
  const random = await loadBotModule('@busters/agents/random');
  return [
    { name: 'greedy', bot: greedy, spec: '@busters/agents/greedy' },
    { name: 'random', bot: random, spec: '@busters/agents/random' },
  ];
}

// ==== CEM opts ====
type CEMOpts = {
  gens: number;
  pop: number;
  elitePct: number;
  seedsPer: number;
  episodesPerSeed: number;
  oppPool: Array<{ name: string; bot: any; spec?: string }>;
  hofSize: number;
  seed: number;
  artifactsDir: string;
  jobs?: number;
};

// Deterministic env params from (baseSeed+si)
function envFromSeed(s: number) {
  // simple LCG
  let r = (s * 1103515245 + 12345) >>> 0;
  const bpp = 2 + (r % 3);   r = (r * 1103515245 + 12345) >>> 0; // 2..4
  const ghosts = 8 + (r % 21);                                   // 8..28
  return { bpp, ghosts };
}

// ===== Serial evaluator with PFSP + Elo updates =====
async function evalGenomeSerial(g: Genome, opts: CEMOpts, elo: Record<string, number>) {
  let total = 0;

  // build PFSP candidates once per serial eval
  const cands: PFSPCandidate[] = [];
  for (const o of opts.oppPool) {
    cands.push({ type:'module', spec:o.spec!, id:o.spec! });
  }
  for (let i=0; i<HOF.length; i++) {
    const tag = `hof:${HOF[i].radarTurn},${HOF[i].stunRange},${HOF[i].releaseDist}`;
    cands.push({ type:'genome', tag, genome:HOF[i], id:tag });
  }
  if (cands.length === 0) { // fallback
    cands.push({ type:'module', spec: opts.oppPool[0].spec!, id: opts.oppPool[0].spec! });
  }

  for (let si = 0; si < opts.seedsPer; si++) {
          const seed = opts.seed + si;
const baseSeed = opts.seed + si;
    const { bpp, ghosts } = envFromSeed(baseSeed);

    // PFSP pick opponent (closer to 50/50 vs baseline)
    const picked = pickOpponentPFSP(elo, cands);
    const oppId = picked.id;

    let opp: any;
    if (picked.type === 'module') {
      opp = opts.oppPool.find(o => o.spec === picked.spec)!.bot;
    } else {
      opp = genomeToBot(picked.genome as Genome);
    }

    const me  = genomeToBot(g);
    const res = await runEpisodes({
      seed: baseSeed,
      episodes: opts.episodesPerSeed,
      bustersPerPlayer: bpp,
      ghostCount: ghosts,
      botA: me,
      botB: opp
    });

    const diff = (res.scoreA - res.scoreB);
    total += diff;

    // Update Elo for the opponent (vs baseline 1200 trainee)
    (() => { const scoreA = diff>0 ? 1 : (diff<0 ? 0 : 0.5); recordMatch(elo, "evolved", oppId, scoreA); })();
  }
  return total / opts.seedsPer;
}

// ===== Parallel evaluator (PFSP + Elo updates per task) =====
async function evalGenomeParallel(pop: Genome[], opts: CEMOpts, elo: Record<string, number>) {
  const jobs = Math.max(1, Math.floor(opts.jobs || 1));
  const workerUrl = new URL("./worker-bootstrap.cjs", import.meta.url);

  type Task = { jid: number; gi: number; seed: number; opponent: any; role: "A"|"B"; bpp: number; ghosts: number; oppId: string };
  const tasks: Task[] = [];
  let jid = 1;

  // PFSP candidate set once per generation
  const cands: PFSPCandidate[] = [];
  for (const o of opts.oppPool) cands.push({ type: "module", spec: o.spec!, id: o.spec! });
  for (let i = 0; i < HOF.length; i++) {
    const tag = `hof:${HOF[i].radarTurn},${HOF[i].stunRange},${HOF[i].releaseDist}`;
    cands.push({ type: "genome", tag, genome: HOF[i], id: tag });
  }
  if (cands.length === 0) {
    const spec = opts.oppPool[0].spec!;
    cands.push({ type: "module", spec, id: spec });
  }

  for (let gi = 0; gi < pop.length; gi++) {
    for (let si = 0; si < opts.seedsPer; si++) {
      const baseSeed = opts.seed + si;
      const { bpp, ghosts } = envFromSeed(baseSeed);

      const picked = pickOpponentPFSP(elo, cands);
      const oppId = picked.id;
      const opponent = picked.type === "module"
        ? { type: "module", spec: (picked as any).spec }
        : { type: "genome", genome: (picked as any).genome, tag: (picked as any).tag };

      const seedA = (baseSeed * 2) >>> 0;
      const seedB = (baseSeed * 2 + 1) >>> 0;

      tasks.push({ jid: jid++, gi, seed: seedA, opponent, role: "A", bpp, ghosts, oppId });
      tasks.push({ jid: jid++, gi, seed: seedB, opponent, role: "B", bpp, ghosts, oppId });
    }
  }

  const sums = new Array(pop.length).fill(0);
  const queue = tasks.slice();
  let running = 0;

  await new Promise<void>((resolve, reject) => {
    const spawn = () => {
      while (running < jobs && queue.length) {
        const t = queue.shift()!;
        running++;
        const w = new Worker(workerUrl, { type: "classic" });

        w.on("message", (msg: any) => {
          if (!msg.ok) {
            w.terminate();
            reject(new Error("Worker error on jid=" + t.jid + ": " + msg.error));
            return;
          }
          sums[t.gi] += msg.diff;
          (() => { const scoreA = msg.diff>0 ? 1 : (msg.diff<0 ? 0 : 0.5); recordMatch(elo, "evolved", t.oppId, scoreA, 8); })();

          w.terminate();
          running--;
          if (queue.length) spawn();
          else if (running === 0) resolve();
        });
        w.on("error", (e) => { w.terminate(); reject(e); });

        w.postMessage({
          id: t.jid,
          genome: pop[t.gi],
          seed: t.seed,
          episodes: opts.episodesPerSeed,
          opponent: t.opponent,
          bpp: t.bpp,
          ghosts: t.ghosts,
          role: t.role,
        });
      }
    };
    spawn();
  });

  return sums.map(s => s / (opts.seedsPer * 2));
}

// ===== CEM trainer with Elo+PFSP + EMA smoothing =====
export async function trainCEM(opts: CEMOpts) {
  const elitePct = opts.elitePct ?? 0.2;
  const artDir = path.resolve(process.cwd(), opts.artifactsDir);
  fs.mkdirSync(artDir, { recursive: true });

  // reset HoF for this run
  HOF.length = 0;

  // load Elo table (persisted across runs)
  const elo = loadElo();

  let m = [15, 1700, 1500];
  let s = [6, 120, 120];
  let bestEverFit = -Infinity;
  let bestEver: Genome | null = null;

  // EMA (smoothed) fitness for selection
  const ema: (number|null)[] = [];
  const emaAlpha = 0.6;

  for (let gen = 0; gen < opts.gens; gen++) {
    const pop: Genome[] = Array.from({ length: opts.pop }, () => sampleGenome(m, s));
    if (ema.length !== pop.length) {
      for (let i=ema.length; i<pop.length; i++) ema.push(null);
    }

    const jobs = Math.max(1, Math.floor(opts.jobs || 1));
    const fits = jobs <= 1
      ? await (async () => { const arr:number[] = []; for (let i=0;i<pop.length;i++) arr.push(await evalGenomeSerial(pop[i], opts, elo)); return arr; })()
      : await evalGenomeParallel(pop, opts, elo);

    // Update EMA and use it for selection
    const smoothed = fits.map((f, i) => {
      const prev = ema[i];
      const v = (prev === null) ? f : (emaAlpha * f + (1 - emaAlpha) * prev);
      ema[i] = v;
      return v;
    });

    const idx = Array.from(pop.keys()).sort((a,b) => smoothed[b] - smoothed[a]);
    const bestIdx = idx[0];
    const genBest = pop[bestIdx];
    const genBestFit = fits[bestIdx];
    const genBestEMA = smoothed[bestIdx];

    fs.writeFileSync(path.join(artDir, 'last_gen_best_genome.json'), JSON.stringify(genBest, null, 2));

    if (genBestFit > bestEverFit || !bestEver) {
      bestEverFit = genBestFit;
      bestEver = genBest;
      fs.writeFileSync(path.join(artDir, 'simrunner_best_genome.json'), JSON.stringify(bestEver, null, 2));
    }

    // Hall of fame maintenance
    HOF.push(genBest);
    while (HOF.length > opts.hofSize) HOF.shift();

    // Refit from elite EMA
    const elitesCount = Math.max(1, Math.round(opts.pop * elitePct));
    const eliteVecs = idx.slice(0, elitesCount).map(i => {
      const g = pop[i]; return [g.radarTurn, g.stunRange, g.releaseDist];
    });
    const mNew = vecMean(eliteVecs);
    const sNew = vecStd(eliteVecs, mNew);

    const alpha = 0.7;
    m = m.map((mv, i) => alpha * mNew[i] + (1 - alpha) * mv);
    s = s.map((sv, i) => clamp(alpha * sNew[i] + (1 - alpha) * sv, 1, 200));

    console.log(`CEM gen ${gen}: bestRaw=${genBestFit.toFixed(2)} bestEMA=${genBestEMA.toFixed(2)} m=[${m.map(x=>Math.round(x)).join(',')}] (jobs=${jobs}) env=CRN(bpp 2-4, ghosts 8-28)`);
  }

  // Write a workspace bot from the best genome
  if (bestEver) {
    const outBot = path.resolve(process.cwd(), '../../agents/evolved-bot.js');
    try { compileGenomeToJS(path.join(artDir, 'simrunner_best_genome.json'), outBot); } catch {}
  }

  // Persist Elo table
  saveElo(elo);

  return { best: bestEver!, fitness: bestEverFit };
}

// ===== Exporter (writes single-file JS bot) =====
export function compileGenomeToJS(inPath: string, outPath: string) {
  const absIn = path.resolve(process.cwd(), inPath);
  if (!fs.existsSync(absIn)) throw new Error(`Genome JSON not found: ${absIn}`);
  const g = JSON.parse(fs.readFileSync(absIn, 'utf-8')) as Genome;

  const lines = [
    "/** Auto-generated single-file bot from genome */",
    "export const meta = { name: \"EvolvedBot\", version: \"ga\" };",
    "export function act(ctx, obs) {",
    "  if (obs.self.carrying !== undefined) {",
    "    const d = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);",
    `    if (d <= ${g.releaseDist}) return { type: "RELEASE" };`,
    "    return { type: \"MOVE\", x: ctx.myBase.x, y: ctx.myBase.y };",
    "  }",
    `  const enemy = obs.enemies?.[0];`,
    `  if (enemy && enemy.range <= ${g.stunRange} && obs.self.stunCd <= 0) return { type: "STUN", busterId: enemy.id };`,
    "  const ghost = obs.ghostsVisible?.[0];",
    "  if (ghost) {",
    "    if (ghost.range >= 900 && ghost.range <= 1760) return { type: \"BUST\", ghostId: ghost.id };",
    "    return { type: \"MOVE\", x: ghost.x, y: ghost.y };",
    "  }",
    `  if (!obs.self.radarUsed && obs.tick >= ${g.radarTurn}) return { type: "RADAR" };`,
    "  return { type: \"MOVE\", x: ctx.myBase.x, y: ctx.myBase.y };",
    "}"
  ];
  const code = lines.join('\n');

  const absOut = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, code);
  console.log('Wrote single-file bot -> ' + absOut);
}
