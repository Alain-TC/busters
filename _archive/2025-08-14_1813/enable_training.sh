#!/usr/bin/env bash
set -euo pipefail

say(){ printf "\033[1;32m==>\033[0m %s\n" "$*"; }

# Ensure pnpm-workspace
[ -f pnpm-workspace.yaml ] || { printf 'packages:\n  - "packages/*"\n' > pnpm-workspace.yaml; say "pnpm-workspace.yaml created"; }

# Root package.json scripts
say "Updating root package.json scripts"
node - <<'NODE'
const fs=require('fs');
const p='package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.private=true;
j.workspaces=["packages/*"];
j.scripts=j.scripts||{};
j.scripts.dev="pnpm -C packages/viewer dev";
j.scripts.build="pnpm -r build";
j.scripts.test="pnpm -r test";
j.scripts.sim="pnpm -C packages/sim-runner start";
j.scripts.train="pnpm -C packages/evolve start";
j.scripts['compile-bot']="pnpm -C packages/evolve compile";
fs.writeFileSync(p, JSON.stringify(j,null,2));
NODE

# --- shared is assumed present ---

# --- engine workspace dep fix (if exists) ---
if [ -f packages/engine/package.json ]; then
  say "Ensuring engine depends on workspace:@busters/shared"
  node - <<'NODE'
const fs=require('fs'), p='packages/engine/package.json';
const j=JSON.parse(fs.readFileSync(p,'utf8'));
j.dependencies=j.dependencies||{};
j.dependencies['@busters/shared']="workspace:*";
fs.writeFileSync(p, JSON.stringify(j,null,2));
NODE
fi

# --- agents package (ensure exists) ---
mkdir -p packages/agents
if [ ! -f packages/agents/package.json ]; then
  say "Creating packages/agents"
  cat > packages/agents/package.json <<'JSON'
{
  "name": "@busters/agents",
  "version": "0.1.0",
  "type": "module",
  "main": "random-bot.js",
  "exports": {
    "./random": "./random-bot.js",
    "./greedy": "./greedy-buster.js"
  }
}
JSON
  cat > packages/agents/random-bot.js <<'JS'
export function act(ctx, obs) {
  if (obs.self.carrying !== undefined) return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  const g = obs.ghostsVisible[0];
  if (g) return (g.range>=900&&g.range<=1760) ? {type:'BUST', ghostId:g.id} : {type:'MOVE', x:g.x, y:g.y};
  return { type:'MOVE', x: Math.floor(Math.random()*ctx.mapW), y: Math.floor(Math.random()*ctx.mapH) };
}
export const meta = { name:'RandomBot', version:'0.1.0' };
JS
  cat > packages/agents/greedy-buster.js <<'JS'
export function act(ctx, obs) {
  if (obs.self.carrying !== undefined) {
    const d = Math.hypot(obs.self.x-ctx.myBase.x, obs.self.y-ctx.myBase.y);
    if (d<=1500) return {type:'RELEASE'};
    return {type:'MOVE', x:ctx.myBase.x, y:ctx.myBase.y};
  }
  const e = obs.enemies[0];
  if (e && e.range<=1760 && obs.self.stunCd<=0) return {type:'STUN', busterId:e.id};
  const g = obs.ghostsVisible[0];
  if (g) return (g.range>=900&&g.range<=1760) ? {type:'BUST', ghostId:g.id} : {type:'MOVE', x:g.x, y:g.y};
  if (!obs.self.radarUsed) return {type:'RADAR'};
  return {type:'MOVE', x:ctx.myBase.x, y:ctx.myBase.y};
}
export const meta = { name:'GreedyBuster', version:'0.1.0' };
JS
fi

# --- sim-runner package ---
say "Writing packages/sim-runner"
mkdir -p packages/sim-runner/src
cat > packages/sim-runner/package.json <<'JSON'
{
  "name": "@busters/sim-runner",
  "version": "0.1.0",
  "type": "module",
  "main": "src/cli.ts",
  "bin": { "busters-sim": "src/cli.ts" },
  "dependencies": {
    "@busters/engine": "workspace:*",
    "@busters/shared": "workspace:*"
  },
  "devDependencies": { "tsx": "^4.16.2" },
  "scripts": { "start": "tsx src/cli.ts" }
}
JSON

cat > packages/sim-runner/src/runEpisodes.ts <<'TS'
import { initGame, step } from '@busters/engine';
import { observationsForTeam } from '@busters/engine';
import { TEAM0_BASE, TEAM1_BASE } from '@busters/shared';
import type { Action, AgentContext } from '@busters/shared';

export type RunOpts = { seed: number; episodes: number; bustersPerPlayer: number; ghostCount: number; botA: any; botB: any };

export async function runEpisodes(opts: RunOpts) {
  let totalA = 0, totalB = 0;
  for (let e = 0; e < opts.episodes; e++) {
    let state = initGame({ seed: opts.seed + e, bustersPerPlayer: opts.bustersPerPlayer, ghostCount: opts.ghostCount });
    const ctxA: AgentContext = { teamId: 0, mapW: state.width, mapH: state.height, myBase: TEAM0_BASE };
    const ctxB: AgentContext = { teamId: 1, mapW: state.width, mapH: state.height, myBase: TEAM1_BASE };
    while (state.tick < 250 && state.ghosts.length > 0) {
      const obsA = observationsForTeam(state, 0);
      const obsB = observationsForTeam(state, 1);
      const actsA: Action[] = obsA.map(o => opts.botA.act(ctxA, o));
      const actsB: Action[] = obsB.map(o => opts.botB.act(ctxB, o));
      state = step(state, { 0: actsA, 1: actsB } as any);
    }
    totalA += state.scores[0];
    totalB += state.scores[1];
  }
  return { scoreA: totalA, scoreB: totalB };
}
TS

cat > packages/sim-runner/src/cli.ts <<'TS'
import { runEpisodes } from './runEpisodes';

async function main() {
  const a = process.argv[2] || '@busters/agents/random';
  const b = process.argv[3] || '@busters/agents/greedy';
  const botA = await import(a);
  const botB = await import(b);
  const res = await runEpisodes({ seed: 42, episodes: 3, bustersPerPlayer: 3, ghostCount: 12, botA, botB });
  console.log(`A(${botA.meta?.name||'A'}) vs B(${botB.meta?.name||'B'}) ->`, res);
}
main();
TS

# --- evolve package (GA + compiler) ---
say "Writing packages/evolve"
mkdir -p packages/evolve/src
cat > packages/evolve/package.json <<'JSON'
{
  "name": "@busters/evolve",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@busters/sim-runner": "workspace:*",
    "@busters/shared": "workspace:*"
  },
  "devDependencies": { "tsx": "^4.16.2" },
  "scripts": {
    "start": "tsx src/train.ts",
    "compile": "tsx src/compile_bot.ts"
  }
}
JSON

# Genome (simple heuristics)
cat > packages/evolve/src/policy.ts <<'TS'
import type { Observation } from '@busters/shared';

export type Genome = {
  radarTurn: number;
  stunRange: number;
  releaseDist: number;
};

export function randomGenome(): Genome {
  return { radarTurn: Math.floor(Math.random()*30)+10, stunRange: 1700, releaseDist: 1500 };
}
export function mutate(g: Genome): Genome {
  const jitter = (v: number, s: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(v + (Math.random()-0.5)*s)));
  return {
    radarTurn: jitter(g.radarTurn, 8, 1, 80),
    stunRange: jitter(g.stunRange, 150, 1000, 2000),
    releaseDist: jitter(g.releaseDist, 150, 900, 1800)
  };
}
export function crossover(a: Genome, b: Genome): Genome {
  return {
    radarTurn: Math.random()<0.5?a.radarTurn:b.radarTurn,
    stunRange: Math.random()<0.5?a.stunRange:b.stunRange,
    releaseDist: Math.random()<0.5?a.releaseDist:b.releaseDist
  };
}

export function genomeToBot(genome: Genome) {
  return {
    meta: { name: 'GA-Bot', version: '0.1' },
    act(ctx: any, obs: Observation) {
      if (obs.self.carrying !== undefined) {
        const d = Math.hypot(obs.self.x-ctx.myBase.x, obs.self.y-ctx.myBase.y);
        if (d <= genome.releaseDist) return { type:'RELEASE' };
        return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
      }
      const e = obs.enemies[0];
      if (e && e.range <= genome.stunRange && obs.self.stunCd<=0) return { type:'STUN', busterId:e.id };
      const g = obs.ghostsVisible[0];
      if (g) return (g.range>=900 && g.range<=1760) ? { type:'BUST', ghostId:g.id } : { type:'MOVE', x:g.x, y:g.y };
      if (!obs.self.radarUsed && obs.tick >= genome.radarTurn) return { type:'RADAR' };
      return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
    }
  };
}
TS

# Trainer
cat > packages/evolve/src/train.ts <<'TS'
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
TS

# Compiler → single-file JS bot
cat > packages/evolve/src/compile_bot.ts <<'TS'
import fs from 'fs';

const outPath = 'packages/agents/evolved-bot.js';
const genomePath = process.argv[2] || 'artifacts/best_genome.json';
if (!fs.existsSync(genomePath)) {
  console.error(`Genome file not found: ${genomePath}. Run "pnpm train" first.`);
  process.exit(1);
}
const g = JSON.parse(fs.readFileSync(genomePath,'utf8'));
const file = `// Auto-generated bot from genome
export const meta = { name: 'EvolvedBot', trained: '${new Date().toISOString()}' };

const G = ${JSON.stringify(g)};

export function act(ctx, obs) {
  // Heuristic policy compiled from genome
  if (obs.self.carrying !== undefined) {
    const d = Math.hypot(obs.self.x-ctx.myBase.x, obs.self.y-ctx.myBase.y);
    if (d <= G.releaseDist) return { type:'RELEASE' };
    return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }
  const e = obs.enemies && obs.enemies[0];
  if (e && e.range <= G.stunRange && obs.self.stunCd<=0) return { type:'STUN', busterId:e.id };
  const g = obs.ghostsVisible && obs.ghostsVisible[0];
  if (g) return (g.range>=900 && g.range<=1760) ? { type:'BUST', ghostId:g.id } : { type:'MOVE', x:g.x, y:g.y };
  if (!obs.self.radarUsed && obs.tick >= G.radarTurn) return { type:'RADAR' };
  return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
}
export default { act, meta };
`;
fs.writeFileSync(outPath, file);
console.log('Wrote single-file bot to', outPath);
TS

say "Cleaning lock/node_modules and installing"
rm -rf node_modules packages/*/node_modules pnpm-lock.yaml
pnpm install

say "All set."
echo "Commands:"
echo "  pnpm sim         # quick headless match"
echo "  pnpm train       # run GA, writes artifacts/best_genome.json"
echo "  pnpm compile-bot # emits packages/agents/evolved-bot.js"

