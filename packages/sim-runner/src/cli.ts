// packages/sim-runner/src/cli.ts
import fs from 'fs';
import path from 'path';
import { loadBotModule } from './loadBots';
import { runEpisodes } from './runEpisodes';
import { runRoundRobin } from './tournament';
import { trainCEM } from './ga';

// Hybrid subject (EVOL2)
import {
  ORDER,
  baselineVec,
  twFromVec,
  defaultSigmas,
  makeHybridBotFromTW,
} from './subjects';

import { selectOpponentsPFSP } from './pfsp';
import { loadEloTable, saveEloTable, updateElo } from './elo';

/* --------------------- CLI helpers --------------------- */
function getFlag(args: string[], name: string, def?: any) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i+1] ?? true;
  return def;
}
function getBool(args: string[], name: string, def=false) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? true : def;
}

/* ---------------- RNG & math ---------------- */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function gaussian(rng: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }

/* ---------------- Opponent pool ---------------- */
async function resolveOppPool(specList: string[]): Promise<Array<{name: string, bot: any}>> {
  const mapNameToSpec = (n: string) => {
    const k = n.trim();
    if (k === 'greedy')  return '@busters/agents/greedy';
    if (k === 'random')  return '@busters/agents/random';
    if (k === 'stunner') return '@busters/agents/stunner';
    if (k === 'camper')  return '@busters/agents/camper';
    if (k === 'hybrid')  return '@busters/agents/hybrid';
    if (k === 'hof')     return '@busters/agents/hof';
    return k; // assume direct spec
  };
  const out: Array<{name: string, bot: any}> = [];
  for (const n of specList) {
    const spec = mapNameToSpec(n);
    const bot = await loadBotModule(spec);
    out.push({ name: n, bot });
  }
  return out;
}

/* ---------------- CEM for Hybrid ---------------- */
type CemCfg = {
  pop: number;
  gens: number;
  elitePct: number;
  seedsPer: number;
  episodesPerSeed: number;
  seed: number;
  jobs: number;
  oppNames: string[];          // base pool names
  pfsp?: boolean;              // if true, sub-select via PFSP each seed
  pfspCount?: number;          // how many opps to select each seed (default 3)
  artifactsDir: string;
  logBest?: boolean;
};

async function evalHybridVector(
  vec: number[],
  oppsAll: Array<{name: string, bot: any}>,
  seedsPer: number,
  episodesPerSeed: number,
  baseSeed: number,
  usePFSP: boolean,
  pfspCount: number
) {
  const tw = twFromVec(vec);
  const botA = makeHybridBotFromTW(tw);

  let games = 0, wins = 0, draws = 0, losses = 0;
  let diffSum = 0;

  for (let si = 0; si < seedsPer; si++) {
    const s = baseSeed + si * 1013;

    // PFSP sub-selection (by id) or full pool
    let opps: Array<{name: string, bot: any}> = oppsAll;
    if (usePFSP) {
      const picked = selectOpponentsPFSP({
        meId: 'hybrid',
        candidates: oppsAll.map(o => o.name),
        n: pfspCount,
      }).map(p => p.id);
      const set = new Set(picked);
      opps = oppsAll.filter(o => set.has(o.name));
      if (opps.length === 0) opps = oppsAll;
    }

    for (const opp of opps) {
      const res = await runEpisodes({
        seed: s,
        episodes: episodesPerSeed,
        bustersPerPlayer: 3,
        ghostCount: 12,
        botA,
        botB: opp.bot,
      });
      const da = Number(res.scoreA) || 0;
      const db = Number(res.scoreB) || 0;
      diffSum += (da - db);
      games += 1;
      if (da > db) wins++; else if (da === db) draws++; else losses++;
    }
  }
  const wr = (wins + 0.5 * draws) / Math.max(1, games);
  const avgDiff = diffSum / Math.max(1, games);
  const fit = 100 * wr + avgDiff;
  return { fit, wr, avgDiff, tw };
}

async function trainHybridCEM(cfg: CemCfg) {
  const {
    pop, gens, elitePct, seedsPer, episodesPerSeed, seed,
    oppNames, artifactsDir, pfsp = false, pfspCount = 3, logBest = false
  } = cfg;

  const DIM = ORDER.length;
  const rng = mulberry32(seed >>> 0);

  const oppsAll = await resolveOppPool(oppNames);
  if (oppsAll.length === 0) throw new Error('No opponents resolved for training.');

  let m = baselineVec();
  let sig = defaultSigmas();
  const eliteCount = Math.max(1, Math.floor(pop * elitePct));

  fs.mkdirSync(path.resolve(artifactsDir), { recursive: true });
  const logPath = path.resolve(artifactsDir, 'hybrid_cem_log.jsonl');
  const outPath = path.resolve(artifactsDir, 'best_hybrid.json');

  console.log(`Training CEM (subject=hybrid): dim=${DIM} pop=${pop} gens=${gens} seedsPer=${seedsPer} oppPool=${oppNames.join('+')}${pfsp ? ' [PFSP]' : ''}`);

  let best = { fit: -Infinity, wr: 0, avgDiff: 0, tw: twFromVec(m) };

  for (let g = 0; g < gens; g++) {
    // Sample population
    const popVecs: number[][] = [];
    for (let i = 0; i < pop; i++) {
      const v: number[] = [];
      for (let d = 0; d < DIM; d++) {
        const z = gaussian(rng);
        v.push(m[d] + z * sig[d]);
      }
      popVecs.push(v);
    }

    // Evaluate
    const evals = [];
    for (let i = 0; i < pop; i++) {
      const r = await evalHybridVector(popVecs[i], oppsAll, seedsPer, episodesPerSeed, seed + g * 10007 + i * 37, pfsp, pfspCount);
      evals.push({ idx: i, ...r });
    }
    evals.sort((a, b) => b.fit - a.fit);

    const head = evals[0];
    if (head.fit > best.fit) best = head;
    console.log(`CEM gen ${g}: bestFit=${head.fit.toFixed(2)} wr=${(head.wr*100).toFixed(1)}% m=[${Math.round(best.tw.TUNE.RELEASE_DIST)},${Math.round(best.tw.TUNE.STUN_RANGE)},${Math.round(best.tw.TUNE.RADAR1_TURN)}]`);
    fs.appendFileSync(logPath, JSON.stringify({ gen: g, bestFit: head.fit, bestWR: head.wr, bestAvgDiff: head.avgDiff }) + "\n");
    if (logBest) {
      const bestTs = path.resolve(artifactsDir, `hybrid-params.gen${g}.ts`);
      const ts = `export const TUNE = ${JSON.stringify(best.tw.TUNE, null, 2)} as const;\nexport const WEIGHTS = ${JSON.stringify(best.tw.WEIGHTS, null, 2)} as const;\nexport default { TUNE, WEIGHTS };\n`;
      fs.writeFileSync(bestTs, ts);
    }

    // Update mean & sigma from elites
    const elites = evals.slice(0, eliteCount);
    for (let d = 0; d < DIM; d++) {
      let sum = 0;
      for (const e of elites) sum += popVecs[e.idx][d];
      const newMean = sum / eliteCount;
      m[d] = newMean;
      let varSum = 0;
      for (const e of elites) {
        const dv = popVecs[e.idx][d] - newMean;
        varSum += dv * dv;
      }
      const newStd = Math.sqrt(varSum / Math.max(1, eliteCount - 1));
      sig[d] = clamp(0.5 * sig[d] + 0.5 * newStd, 1e-6, 1e6);
    }
  }

  fs.writeFileSync(outPath, JSON.stringify({ TUNE: best.tw.TUNE, WEIGHTS: best.tw.WEIGHTS }, null, 2));
  console.log(`Wrote best hybrid params -> ${outPath}`);

  const outTs = path.resolve(artifactsDir, 'hybrid-params.best.ts');
  const ts = `/** Auto-generated from CEM best_hybrid.json — do not edit by hand */\n` +
             `export const TUNE = ${JSON.stringify(best.tw.TUNE, null, 2)} as const;\n\n` +
             `export const WEIGHTS = ${JSON.stringify(best.tw.WEIGHTS, null, 2)} as const;\n` +
             `export default { TUNE, WEIGHTS };\n`;
  fs.writeFileSync(outTs, ts);
  console.log(`Wrote -> ${outTs}`);

  return best;
}

/* ---------------- CMA-ES for Hybrid ---------------- */
type CmaCfg = {
  pop: number;
  gens: number;
  seedsPer: number;
  episodesPerSeed: number;
  seed: number;
  oppNames: string[];
  artifactsDir: string;
  pfsp?: boolean;
  pfspCount?: number;
  logBest?: boolean;
};

async function trainHybridCMA(cfg: CmaCfg) {
  const {
    pop, gens, seedsPer, episodesPerSeed, seed,
    oppNames, artifactsDir, pfsp = false, pfspCount = 3, logBest = false,
  } = cfg;

  const DIM = ORDER.length;
  const rng = mulberry32(seed >>> 0);
  const oppsAll = await resolveOppPool(oppNames);
  if (oppsAll.length === 0) throw new Error('No opponents resolved for training.');

  let mean = baselineVec();
  let sigma = defaultSigmas();

  const mu = Math.max(1, Math.floor(pop / 2));
  const weights = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wSum = weights.reduce((a, b) => a + b, 0);
  const wNorm = weights.map(w => w / wSum);

  fs.mkdirSync(path.resolve(artifactsDir), { recursive: true });
  const logPath = path.resolve(artifactsDir, 'hybrid_cma_log.jsonl');
  const outPath = path.resolve(artifactsDir, 'best_hybrid.json');

  console.log(`Training CMA-ES (subject=hybrid): dim=${DIM} pop=${pop} gens=${gens} seedsPer=${seedsPer} oppPool=${oppNames.join(',')}${pfsp ? ' [PFSP]' : ''}`);

  let best = { fit: -Infinity, wr: 0, avgDiff: 0, tw: twFromVec(mean) };

  for (let g = 0; g < gens; g++) {
    const popVecs: number[][] = [];
    for (let i = 0; i < pop; i++) {
      const v: number[] = [];
      for (let d = 0; d < DIM; d++) {
        const z = gaussian(rng);
        v.push(mean[d] + z * sigma[d]);
      }
      popVecs.push(v);
    }

    const evals = [];
    for (let i = 0; i < pop; i++) {
      const r = await evalHybridVector(popVecs[i], oppsAll, seedsPer, episodesPerSeed, seed + g * 10007 + i * 37, pfsp, pfspCount);
      evals.push({ idx: i, ...r });
    }
    evals.sort((a, b) => b.fit - a.fit);

    const eliteIdx = evals.slice(0, mu).map(e => e.idx);
    const head = evals[0];
    if (head.fit > best.fit) best = head;

    const newMean = new Array(DIM).fill(0);
    for (let d = 0; d < DIM; d++) {
      for (let j = 0; j < mu; j++) {
        newMean[d] += wNorm[j] * popVecs[eliteIdx[j]][d];
      }
    }
    mean = newMean;

    const newSigma = new Array(DIM).fill(0);
    for (let d = 0; d < DIM; d++) {
      let vSum = 0;
      for (let j = 0; j < mu; j++) {
        const idx = eliteIdx[j];
        const dv = popVecs[idx][d] - mean[d];
        vSum += wNorm[j] * dv * dv;
      }
      newSigma[d] = Math.sqrt(vSum) || sigma[d];
    }
    sigma = newSigma;

    console.log(`CMA-ES gen ${g}: bestFit=${head.fit.toFixed(2)} wr=${(head.wr*100).toFixed(1)}%`);
    fs.appendFileSync(logPath, JSON.stringify({ gen: g, bestFit: head.fit, bestWR: head.wr, bestAvgDiff: head.avgDiff }) + "\n");
    if (logBest) {
      const bestTs = path.resolve(artifactsDir, `hybrid-params.gen${g}.ts`);
      const ts = `export const TUNE = ${JSON.stringify(head.tw.TUNE, null, 2)} as const;\nexport const WEIGHTS = ${JSON.stringify(head.tw.WEIGHTS, null, 2)} as const;\nexport default { TUNE, WEIGHTS };\n`;
      fs.writeFileSync(bestTs, ts);
    }
  }

  fs.writeFileSync(outPath, JSON.stringify({ TUNE: best.tw.TUNE, WEIGHTS: best.tw.WEIGHTS }, null, 2));
  console.log(`Wrote best hybrid params -> ${outPath}`);

  const outTs = path.resolve(artifactsDir, 'hybrid-params.best.ts');
  const ts = `/** Auto-generated from CMA-ES best_hybrid.json — do not edit by hand */\n` +
             `export const TUNE = ${JSON.stringify(best.tw.TUNE, null, 2)} as const;\n\n` +
             `export const WEIGHTS = ${JSON.stringify(best.tw.WEIGHTS, null, 2)} as const;\n` +
             `export default { TUNE, WEIGHTS };\n`;
  fs.writeFileSync(outTs, ts);
  console.log(`Wrote -> ${outTs}`);

  return best;
}

/* ---------------- Post-train utilities ---------------- */
function writeHybridParams(tw: { TUNE: any; WEIGHTS: any }) {
  const out = path.resolve('packages/agents/hybrid-params.ts');
  const content = `// packages/agents/hybrid-params.ts\n` +
    `// -----------------------------------------------------------------------------\n` +
    `// Hybrid parameters (auto-updated).\n` +
    `// -----------------------------------------------------------------------------\n\n` +
    `export type Tune = {\n` +
    `  RELEASE_DIST: number;\n  STUN_RANGE: number;\n  RADAR1_TURN: number;\n  RADAR2_TURN: number;\n` +
    `  SPACING: number;\n  SPACING_PUSH: number;\n  BLOCK_RING: number;\n  DEFEND_RADIUS: number;\n` +
    `  EXPLORE_STEP_REWARD: number;\n};\n\n` +
    `export type Weights = {\n` +
    `  BUST_BASE: number;\n  BUST_RING_BONUS: number;\n  BUST_ENEMY_NEAR_PEN: number;\n  INTERCEPT_BASE: number;\n` +
    `  INTERCEPT_DIST_PEN: number;\n  DEFEND_BASE: number;\n  DEFEND_NEAR_BONUS: number;\n  BLOCK_BASE: number;\n` +
    `  EXPLORE_BASE: number;\n  SUPPORT_BASE: number;\n  DIST_PEN: number;\n  CARRY_BASE: number;\n` +
    `  CARRY_ENEMY_NEAR_PEN: number;\n};\n\n` +
    `export const TUNE: Tune = ${JSON.stringify(tw.TUNE, null, 2)} as Tune;\n\n` +
    `export const WEIGHTS: Weights = ${JSON.stringify(tw.WEIGHTS, null, 2)} as Weights;\n\n` +
    `const HYBRID_PARAMS = { TUNE, WEIGHTS };\nexport default HYBRID_PARAMS;\n`;
  fs.writeFileSync(out, content);
  console.log(`Wrote -> ${out}`);
}

async function pfspEvalAndRefreshHOF(args: { tw: any; oppNames: string[]; seedsPer: number; episodesPerSeed: number; pfspCount: number; }) {
  const { tw, oppNames, seedsPer, episodesPerSeed, pfspCount } = args;
  const candNames = Array.from(new Set([...oppNames, 'hof']));
  const eloPath = path.resolve('packages/sim-runner/artifacts/elo.json');
  const championPath = path.resolve('packages/agents/champion-bot.js');
  const elo = loadEloTable(eloPath);

  const picks = selectOpponentsPFSP({ meId: 'hybrid', candidates: candNames, n: Math.min(pfspCount, candNames.length), elo }).map(p => p.id);
  const opps = await resolveOppPool(picks);
  const botA = makeHybridBotFromTW(tw);

  for (const opp of opps) {
    let scoreA = 0, scoreB = 0;
    for (let si = 0; si < seedsPer; si++) {
      const res = await runEpisodes({
        seed: 100 + si * 1013,
        episodes: episodesPerSeed,
        bustersPerPlayer: 3,
        ghostCount: 12,
        botA,
        botB: opp.bot,
      });
      scoreA += res.scoreA;
      scoreB += res.scoreB;
    }
    const diff = scoreA - scoreB;
    const resultA = diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
    updateElo(elo, 'hybrid', opp.name, resultA);
  }

  saveEloTable(elo, eloPath);

  const hybridElo = elo['hybrid'] || 1000;
  const hofElo = elo['hof'] || 1000;
  const champSpec = hybridElo >= hofElo ? './hybrid-bot.ts' : '@busters/agents/hof';
  const js = `import champ from '${champSpec}';\nexport const meta = champ.meta;\nexport const act = champ.act;\nexport default { meta, act };\n`;
  fs.writeFileSync(championPath, js);
  console.log(`Refreshed Elo & HOF -> ${championPath}`);
}

/* ---------------- Tag helpers for SIM replays ---------------- */
function countTags(actions: any[]): Record<string, number> {
  const c: Record<string, number> = {};
  for (const a of actions || []) {
    const t = a && a.__dbg && a.__dbg.tag;
    if (!t) continue;
    c[t] = (c[t] || 0) + 1;
  }
  return c;
}
function mergeCounts(a: Record<string, number>, b: Record<string, number>) {
  const out: Record<string, number> = { ...a };
  for (const k of Object.keys(b)) out[k] = (out[k] || 0) + b[k];
  return out;
}

/* ---------------- Main CLI ---------------- */
async function main() {
  const [,, mode, ...rest] = process.argv;

  if (mode === 'sim') {
    const botAPath = rest[0] || '@busters/agents/random';
    const botBPath = rest[1] || '@busters/agents/greedy';
    const episodes = Number(getFlag(rest, 'episodes', 3));
    const seed = Number(getFlag(rest, 'seed', 42));
    const replayPath = getFlag(rest, 'replay', null);

    const baseA = await loadBotModule(botAPath);
    const baseB = await loadBotModule(botBPath);

    // --- RAW action capture per tick (preserves __dbg) ---
    const rawByTick = new Map<number, { A: any[]; B: any[] }>();
    function wrapBot(base: any, side: 'A' | 'B') {
      return {
        meta: base.meta,
        act(ctx: any, obs: any) {
          const a = base.act(ctx, obs);
          const slot = rawByTick.get(ctx.tick) || { A: [], B: [] };
          slot[side].push(a);
          rawByTick.set(ctx.tick, slot);
          return a;
        }
      };
    }
    const botA = wrapBot(baseA, 'A');
    const botB = wrapBot(baseB, 'B');

    const frames: any[] = [];
    const onTick = replayPath ? (st: any) => {
      const raw = rawByTick.get(st.tick) || { A: [], B: [] };
      const tagsA = countTags(raw.A);
      const tagsB = countTags(raw.B);
      const tagsCombined = mergeCounts(tagsA, tagsB);

      frames.push({
        tick: st.tick,
        width: st.width, height: st.height,
        busters: st.busters, ghosts: st.ghosts, scores: st.scores,
        actionsA: raw.A, actionsB: raw.B,
        tags: { A: tagsA, B: tagsB, combined: tagsCombined }
      });
    } : undefined;

    const res = await runEpisodes({ seed, episodes, bustersPerPlayer: 3, ghostCount: 12, botA, botB, onTick } );
    console.log(`A(${baseA.meta?.name||'A'}) vs B(${baseB.meta?.name||'B'}) ->`, res);

    if (replayPath) {
      const abs = path.resolve(replayPath);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, JSON.stringify({ frames }, null, 2));
      console.log(`Saved replay -> ${abs}`);
    }
    return;
  }

  if (mode === 'train') {
    const pop = Number(getFlag(rest, 'pop', 24));
    const gens = Number(getFlag(rest, 'gens', 12));
    const seed = Number(getFlag(rest, 'seed', 42));
    const algo = String(getFlag(rest, 'algo', 'cem'));
    const seedsPer = Number(getFlag(rest, 'seeds-per', 7));
    const episodesPerSeed = Number(getFlag(rest, 'eps-per-seed', 3));
    const jobs = Number(getFlag(rest, 'jobs', 1)); // reserved
    const oppPoolArg = String(getFlag(rest, 'opp-pool', 'greedy,random,stunner,camper,hof'));
    const subject = String(getFlag(rest, 'subject', '')).trim().toLowerCase();
    const pfsp = getBool(rest, 'pfsp', false);
    const pfspCount = Number(getFlag(rest, 'pfsp-count', 3));
    const logBest = getBool(rest, 'log-best', false);

    if (subject === 'hybrid') {
      const oppNames = oppPoolArg.split(',').map(s=>s.trim()).filter(Boolean);
      const artDir = path.resolve('packages/sim-runner/artifacts');

      if (algo === 'cma') {
        const best = await trainHybridCMA({
          pop, gens,
          seedsPer, episodesPerSeed,
          seed,
          oppNames,
          artifactsDir: artDir,
          pfsp, pfspCount,
          logBest,
        });
        writeHybridParams(best.tw);
        await pfspEvalAndRefreshHOF({ tw: best.tw, oppNames, seedsPer, episodesPerSeed, pfspCount });
        return;
      }

      if (algo === 'cem') {
        const best = await trainHybridCEM({
          pop, gens, elitePct: 0.2,
          seedsPer, episodesPerSeed,
          seed, jobs,
          oppNames,
          artifactsDir: artDir,
          pfsp, pfspCount,
          logBest,
        });
        writeHybridParams(best.tw);
        await pfspEvalAndRefreshHOF({ tw: best.tw, oppNames, seedsPer, episodesPerSeed, pfspCount });
        return;
      }

      console.log(`Hybrid currently supports --algo cem or cma.`);
      return;
    }

    console.log(`Unknown or empty --subject. Use: --subject hybrid`);
    console.log(`Example:\n  tsx src/cli.ts train --subject hybrid --algo cma --pop 16 --gens 4 --seeds-per 5 --eps-per-seed 2 --seed 99 --opp-pool greedy,stunner,camper,random,hof`);
    return;
  }

  if (mode === 'cem') {
    const gens = Number(getFlag(rest, 'gens', 20));
    const pop = Number(getFlag(rest, 'pop', 24));
    const seed = Number(getFlag(rest, 'seed', 42));
    const seedsPer = Number(getFlag(rest, 'seeds-per', 5));
    const episodesPerSeed = Number(getFlag(rest, 'eps-per-seed', 3));
    const hofSize = Number(getFlag(rest, 'hof-size', 3));
    const oppPoolArg = String(getFlag(rest, 'opp-pool', '@busters/agents/greedy,@busters/agents/random'));
    const jobs = Number(getFlag(rest, 'jobs', 1));
    const hofRefresh = Number(getFlag(rest, 'hof-refresh', 0));
    const rotateEvery = Number(getFlag(rest, 'rotate-opps', 0));
    const telemetry = String(getFlag(rest, 'telemetry', path.join('packages/sim-runner/artifacts', 'tag_telemetry.jsonl')));
    const eloOut = String(getFlag(rest, 'elo-out', path.join('packages/sim-runner/artifacts', 'elo.json')));
    const oppPool = oppPoolArg.split(',').map((s) => ({ id: s.trim() })).filter(o => o.id);
    await trainCEM({
      gens, pop, elitePct: 0.2, seedsPer, episodesPerSeed, oppPool, hofSize, seed,
      artifactsDir: 'packages/sim-runner/artifacts', jobs,
      hofRefreshInterval: hofRefresh || undefined,
      oppRotateInterval: rotateEvery || undefined,
      telemetryPath: telemetry,
      eloPath: eloOut,
    });
    return;
  }

  if (mode === 'compile') {
    const inPath = String(getFlag(rest, 'in', 'artifacts/simrunner_best_genome.json'));
    const outPath = String(getFlag(rest, 'out', '../agents/evolved-bot.js'));
    console.log(`'compile' is for legacy genome flows; Hybrid emits artifacts/hybrid-params.best.ts instead.`);
    return;
  }

  if (mode === 'tourney') {
    const botsArg = String(getFlag(rest, 'bots', '@busters/agents/greedy,@busters/agents/random,@busters/agents/hybrid'));
    const seed = Number(getFlag(rest, 'seed', 123));
    const seedsPerPair = Number(getFlag(rest, 'seeds', 5));
    const episodesPerSeed = Number(getFlag(rest, 'episodes', 3));
    const replayDir = getFlag(rest, 'replay-dir', null);
    const exportChamp = getFlag(rest, 'export-champ', null);
    const standingsOut = getFlag(rest, 'out', 'artifacts/tournament_standings.json');

    const bots = botsArg.split(',').map((s, idx) => {
      const spec = s.trim();
      const id = spec.replace(/[^A-Za-z0-9._-]/g, '_') || `bot${idx}`;
      return { id, spec };
    });

    console.log(`Tournament RR: bots=${bots.length} seedsPerPair=${seedsPerPair} episodesPerSeed=${episodesPerSeed}`);
    const standings = await runRoundRobin({
      bots, seed, seedsPerPair, episodesPerSeed,
      replayDir: replayDir ? String(replayDir) : null
    });

    const ranked = [...standings.bots].sort((a,b) => {
      const dp = (standings.points[b] - standings.points[a]);
      return dp !== 0 ? dp : (standings.elo[b] - standings.elo[a]);
    });

    const champ = ranked[0];
    console.log('\n=== Standings (points, W-D-L, Elo) ===');
    for (const id of ranked) {
      console.log(`${id.padEnd(28)}  ${String(standings.points[id]).padStart(4)}   ${String(standings.wins[id]).padStart(2)}-${String(standings.draws[id]).padStart(2)}-${String(standings.losses[id]).padStart(2)}   Elo ${Math.round(standings.elo[id])}`);
    }
    console.log(`\nChampion: ${champ}`);

    fs.mkdirSync(path.dirname(path.resolve(standingsOut)), { recursive: true });
    fs.writeFileSync(path.resolve(standingsOut), JSON.stringify({ ranked, ...standings }, null, 2));
    console.log(`Saved -> ${path.resolve(standingsOut)}`);

    if (exportChamp) {
      const champSpec = bots.find(b => b.id === champ)!.spec;
      const looksLikeFile = champSpec.startsWith('./') || champSpec.startsWith('../') || champSpec.startsWith('/') || champSpec.startsWith('file:');
      if (looksLikeFile && !champSpec.startsWith('file:')) {
        const abs = path.isAbsolute(champSpec) ? champSpec : path.resolve(process.cwd(), champSpec);
        fs.copyFileSync(abs, path.resolve(process.cwd(), String(exportChamp)));
        console.log(`Copied champion file -> ${path.resolve(process.cwd(), String(exportChamp))}`);
      } else {
        console.log(`Champion is a package export; skipping copy.`);
      }
    }
    return;
  }

  if (mode === 'sample') {
    const episodes = Number(getFlag(rest, 'episodes', 8));
    const seed = Number(getFlag(rest, 'seed', 123));
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
  # Train Hybrid (CEM)
  tsx src/cli.ts train --subject hybrid --algo cem --pop 24 --gens 12 --seeds-per 7 --seed 42 --opp-pool greedy,random,stunner,camper,hof [--pfsp]

  # Sim a single match (save replay with actions & tags)
  tsx src/cli.ts sim <botA> <botB> [--episodes 3] [--seed 42] [--replay path.json]

  # Round-robin tournament
  tsx src/cli.ts tourney --bots @busters/agents/greedy,@busters/agents/random,@busters/agents/hybrid \\
    --seed 123 --seeds 5 --episodes 3 \\
    [--replay-dir ../viewer/public/replays/tourney] \\
    [--out artifacts/tournament_standings.json]

  # CEM trainer with auto HOF refresh & opponent rotation
  tsx src/cli.ts cem --gens 20 --pop 24 --opp-pool @busters/agents/greedy,@busters/agents/random \\
    [--hof-refresh 5] [--rotate-opps 5] [--telemetry artifacts/tag_telemetry.jsonl]
`);
}
main();

