#!/usr/bin/env bash
set -euo pipefail

echo ">> Overwriting packages/sim-runner/src/ga.ts (CEM + CRNs + league)"
cat > packages/sim-runner/src/ga.ts <<'TS'
import fs from 'fs';
import path from 'path';
import { runEpisodes } from './runEpisodes';
import { loadBotModule } from './loadBots';

// ---- Genome & policy -------------------------------------------------
export type Genome = { radarTurn:number; stunRange:number; releaseDist:number };

export function genomeToBot(g: Genome) {
  return {
    meta: { name:'EvoBot', version:'cem-1' },
    act(ctx: any, obs: any) {
      // Carrying? go home & release if close enough
      if (obs.self.carrying !== undefined) {
        const dHome = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);
        if (dHome <= g.releaseDist) return { type: 'RELEASE' };
        return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
      }
      // Opportunistic stun
      const e = obs.enemies[0];
      if (e && e.range <= g.stunRange && obs.self.stunCd <= 0) return { type: 'STUN', busterId: e.id };
      // Chase/bust nearest ghost
      const ghost = obs.ghostsVisible[0];
      if (ghost) {
        if (ghost.range >= 900 && ghost.range <= 1760) return { type: 'BUST', ghostId: ghost.id };
        return { type: 'MOVE', x: ghost.x, y: ghost.y };
      }
      // RADAR once after tick threshold
      if (!obs.self.radarUsed && obs.tick >= g.radarTurn) return { type: 'RADAR' };
      // Fallback = regroup at base
      return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
    }
  };
}

function clampGenome(g: Genome): Genome {
  return {
    radarTurn: Math.max(1, Math.round(g.radarTurn)),
    stunRange: Math.max(900, Math.min(1760, Math.round(g.stunRange))),
    releaseDist: Math.max(800, Math.min(2000, Math.round(g.releaseDist))),
  };
}

// ---- Opponent pool / HoF ---------------------------------------------
type Opp = { name: string, bot: any };
export async function buildBaseOppPool(): Promise<Opp[]> {
  const greedy = await loadBotModule('@busters/agents/greedy');
  const random = await loadBotModule('@busters/agents/random');
  return [
    { name: 'greedy', bot: greedy },
    { name: 'random', bot: random },
  ];
}

// ---- Evaluation with CRNs (common random numbers) --------------------
export async function evalGenomeMedian(g: Genome, seeds: number[], oppPool: Opp[], episodesPerSeed = 3) {
  const botA = genomeToBot(g);
  const diffs: number[] = [];
  for (const seed of seeds) {
    // deterministic opponent choice from seed
    const opp = oppPool[Math.abs(seed) % oppPool.length];
    const res = await runEpisodes({
      seed,
      episodes: episodesPerSeed,
      bustersPerPlayer: 3,
      ghostCount: 12,
      botA, botB: opp.bot
    });
    diffs.push(res.scoreA - res.scoreB);
  }
  diffs.sort((a,b)=>a-b);
  return diffs[Math.floor(diffs.length/2)]; // median
}

// ---- CEM trainer -----------------------------------------------------
type CEMOpts = {
  gens: number;
  pop: number;
  elitePct: number;
  seedsPer: number;
  episodesPerSeed: number;
  oppPool: Opp[];
  hofSize: number;
  seed: number;
  artifactsDir: string;
};

export async function trainCEM(opts: CEMOpts) {
  const d = 3;
  const λ = opts.pop;
  const μ = Math.max(1, Math.round(opts.elitePct * λ));
  const hof: Genome[] = [];
  const artifactsDir = path.resolve(opts.artifactsDir);
  fs.mkdirSync(artifactsDir, { recursive: true });

  // mean & std (diag)
  let m = [15, 1700, 1550];
  let s = [8, 120, 120];

  function decode(v: number[]): Genome { return clampGenome({ radarTurn:v[0], stunRange:v[1], releaseDist:v[2] }); }
  function mean(M: number[][]) { return M[0].map((_,j)=> M.reduce((acc,row)=> acc+row[j],0)/M.length); }
  function stdDiag(M: number[][], m: number[]) {
    return M[0].map((_,j)=> {
      const v = M.reduce((acc,row)=> acc + (row[j]-m[j])**2, 0)/M.length;
      return Math.max(1e-3, Math.sqrt(v));
    });
  }
  function gauss() { // Box-Muller
    const u = Math.random(); const v = Math.random();
    return Math.sqrt(-2*Math.log(u||1e-9)) * Math.cos(2*Math.PI*v);
  }

  for (let gen=0; gen<opts.gens; gen++) {
    // CRNs: same seed set for all genomes in this generation
    const crnSeeds = Array.from({length: opts.seedsPer}, (_,i)=> opts.seed + gen*1000 + i);

    // opponent pool = base + HoF snapshots (if any)
    const oppPool: Opp[] = [...opts.oppPool];
    for (let i=0; i<Math.min(hof.length, opts.hofSize); i++) {
      const h = genomeToBot(hof[i]);
      oppPool.push({ name:`hof${i}`, bot: h });
    }

    // mirrored sampling
    const half = Math.ceil(λ/2);
    const zHalf = Array.from({length: half}, () => Array.from({length: d}, () => gauss()));
    const zAll = zHalf.concat(zHalf.map(v => v.map(x => -x))).slice(0, λ);

    const popVec = zAll.map(z => z.map((zi,i)=> m[i] + s[i]*zi ));
    const popGenomes = popVec.map(decode);

    const fit = await Promise.all(popGenomes.map(g => evalGenomeMedian(g, crnSeeds, oppPool, opts.episodesPerSeed)));

    // rank & refit to elites
    const idx = fit.map((f,i)=>[f,i]).sort((a,b)=> b[0]-a[0]).map(x=>x[1]);
    const bestIdx = idx[0], bestFit = fit[bestIdx], bestG = popGenomes[bestIdx];

    const eliteVec = idx.slice(0, μ).map(i => popVec[i]);
    const alpha = 0.7;
    const newM = mean(eliteVec);
    const newS = stdDiag(eliteVec, newM);
    m = m.map((mi,i)=> alpha*mi + (1-alpha)*newM[i]);
    s = s.map((si,i)=> alpha*si + (1-alpha)*newS[i]);

    // keep HoF
    hof.unshift(bestG);
    if (hof.length > opts.hofSize) hof.length = opts.hofSize;

    console.log(`CEM gen ${gen}: best=${bestFit.toFixed(2)} m=${JSON.stringify(m.map(n=>Math.round(n)))}`);

    // save artifact (rolling best)
    fs.writeFileSync(path.join(artifactsDir, 'simrunner_best_genome.json'), JSON.stringify(bestG, null, 2));
  }

  // final best (from last saved file)
  const best = JSON.parse(fs.readFileSync(path.join(artifactsDir, 'simrunner_best_genome.json'), 'utf8')) as Genome;
  return best;
}

// ---- Compile genome to a single-file JS bot (workspace) --------------
export function compileGenomeToJS(inPath: string, outPath: string) {
  const g = JSON.parse(fs.readFileSync(path.resolve(inPath),'utf8')) as Genome;
  const gg = clampGenome(g);
  const code = `// Auto-generated single-file bot (workspace style)
export const meta = { name: 'EvolvedBot', version: '1.0' };
export function act(ctx, obs) {
  const radarTurn = ${gg.radarTurn};
  const stunRange = ${gg.stunRange};
  const releaseDist = ${gg.releaseDist};
  if (obs.self.carrying !== undefined) {
    const d = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);
    if (d <= releaseDist) return { type: 'RELEASE' };
    return { type: 'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }
  const e = obs.enemies[0];
  if (e && e.range <= stunRange && obs.self.stunCd <= 0) return { type: 'STUN', busterId: e.id };
  const g = obs.ghostsVisible[0];
  if (g) {
    if (g.range >= 900 && g.range <= 1760) return { type: 'BUST', ghostId: g.id };
    return { type: 'MOVE', x: g.x, y: g.y };
  }
  if (!obs.self.radarUsed && obs.tick >= radarTurn) return { type: 'RADAR' };
  return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
}
`;
  fs.writeFileSync(path.resolve(outPath), code);
  console.log(`Wrote single-file bot -> ${path.resolve(outPath)}`);
}
TS

echo ">> Overwriting packages/sim-runner/src/cli.ts (adds --algo cem, --seeds-per, --opp-pool)"
cat > packages/sim-runner/src/cli.ts <<'TS'
import fs from 'fs';
import path from 'path';
import { loadBotModule } from './loadBots';
import { runEpisodes } from './runEpisodes';
import { trainCEM, compileGenomeToJS, buildBaseOppPool } from './ga';

function getFlag(args: string[], name: string, def?: any) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i+1] ?? true;
  return def;
}
function getBool(args: string[], name: string, def=false) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? true : def;
}
async function main() {
  const [,, mode, ...rest] = process.argv;

  if (mode === 'sim') {
    const botAPath = rest[0] || '@busters/agents/random';
    const botBPath = rest[1] || '@busters/agents/greedy';
    const episodes = Number(getFlag(rest, 'episodes', 3));
    const seed = Number(getFlag(rest, 'seed', 42));
    const replayPath = getFlag(rest, 'replay', null);

    const botA = await loadBotModule(botAPath);
    const botB = await loadBotModule(botBPath);

    const frames: any[] = [];
    const onTick = replayPath ? (st: any) => { frames.push({
      tick: st.tick, width: st.width, height: st.height,
      busters: st.busters, ghosts: st.ghosts, scores: st.scores
    }); } : undefined;

    const res = await runEpisodes({ seed, episodes, bustersPerPlayer: 3, ghostCount: 12, botA, botB, onTick } as any);
    console.log(`A(${botA.meta?.name||'A'}) vs B(${botB.meta?.name||'B'}) ->`, res);

    if (replayPath) {
      fs.mkdirSync(path.dirname(path.resolve(replayPath)), { recursive: true });
      fs.writeFileSync(path.resolve(replayPath), JSON.stringify({ frames }, null, 2));
      console.log(`Saved replay -> ${path.resolve(replayPath)}`);
    }
    return;
  }

  if (mode === 'train') {
    const pop = Number(getFlag(rest, 'pop', 24));
    const gens = Number(getFlag(rest, 'gens', 12));
    const episodes = Number(getFlag(rest, 'episodes', 60)); // used inside eval per seed
    const seed = Number(getFlag(rest, 'seed', 42));
    const algo = String(getFlag(rest, 'algo', 'cem'));
    const seedsPer = Number(getFlag(rest, 'seeds-per', 7));
    const episodesPerSeed = Number(getFlag(rest, 'eps-per-seed', 3));
    const oppPoolArg = String(getFlag(rest, 'opp-pool', 'greedy,random'));
    const hofSize = Number(getFlag(rest, 'hof', 5));

    const baseOpps = await buildBaseOppPool();
    const chosen: any[] = [];
    const names = oppPoolArg.split(',').map(s=>s.trim()).filter(Boolean);
    for (const n of names) {
      const b = baseOpps.find(o => o.name === n);
      if (b) chosen.push(b);
      // 'hof' is handled dynamically inside trainer
    }
    if (chosen.length === 0) chosen.push(...baseOpps);

    console.log(`Training ${algo.toUpperCase()}: pop=${pop} gens=${gens} seedsPer=${seedsPer} oppPool=${names.join('+')||'greedy+random'}`);

    if (algo === 'cem') {
      const best = await trainCEM({
        gens, pop,
        elitePct: 0.2,
        seedsPer,
        episodesPerSeed,
        oppPool: chosen,
        hofSize,
        seed,
        artifactsDir: 'packages/sim-runner/artifacts'
      });
      // write evolved workspace bot too
      compileGenomeToJS('packages/sim-runner/artifacts/simrunner_best_genome.json', 'packages/agents/evolved-bot.js');
      console.log('Best genome:', best);
      return;
    }

    console.log(`Unknown algo: ${algo}. Try --algo cem`);
    return;
  }

  if (mode === 'compile') {
    const inPath = String(getFlag(rest, 'in', 'packages/sim-runner/artifacts/simrunner_best_genome.json'));
    const outPath = String(getFlag(rest, 'out', 'packages/agents/evolved-bot.js'));
    compileGenomeToJS(inPath, outPath);
    return;
  }

  if (mode === 'sample') {
    const episodes = Number(getFlag(rest, 'episodes', 8));
    const seed = Number(getFlag(rest, 'seed', 123));
    // rely on runEpisodes' internal sampler logs if any; otherwise produce synthetic pairs:
    const pairs: Array<[number, number]> = [];
    for (let i=0;i<episodes;i++) {
      const bpp = 2 + ((seed+i) % 3); // 2..4
      const ghosts = 8 + ((seed*7+i*5) % 21); // 8..28
      pairs.push([bpp, ghosts]);
    }
    console.log(JSON.stringify(pairs, null, 2));
    return;
  }

  console.log(`Usage:
  tsx src/cli.ts train --algo cem --pop 24 --gens 12 --seeds-per 7 --seed 42 [--opp-pool greedy,random,hof]
  tsx src/cli.ts sim <botA> <botB> [--episodes 3] [--seed 42] [--replay path.json]
  tsx src/cli.ts compile --in <genome.json> --out <bot.js>
  tsx src/cli.ts sample --episodes 10 --seed 123
`);
}
main();
TS

echo ">> Done."
