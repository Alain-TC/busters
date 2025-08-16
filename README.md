# Busters — CEM-trained Codingame bot (monorepo)

This repo evolves a **Codingame “Busters”** bot using the **Cross-Entropy Method (CEM)**, evaluates it against a pool of opponents, and exports a **single-file** Codingame-legal bot (`readline()` loop).

> **Current state (last successful run):**
> - Serial sanity ✅
> - Parallel training ✅
> - Best genome example: `{ "radarTurn": 23, "stunRange": 1766, "releaseDist": 1600 }`
> - Fitness ≈ 2.28
> - Exporter writes `my_cg_bot.js`
> - Tournament works (`greedy`, `random`, `evolved` resolved correctly)

---

## Monorepo layout

packages/
agents/ # baseline & evolved adapters (greedy-buster.js, random-bot.js, evolved-bot.js)
engine/ # core sim (state, step, perception, scoring)
shared/ # constants, RNG, types, vec helpers
sim-runner/ # training + tournaments (CEM, PFSP/Elo, workers, artifacts)
viewer/ # Vite replay viewer (reads JSON from public/replays/)
scripts/
export-cg-bot.ts # exports Codingame bot -> my_cg_bot.js



Key control flow:
- `packages/sim-runner/src/cli.ts`  
  - `train` → `ga.ts::trainCEM`  
  - `tourney` → round-robin, saves replays + standings  
- `ga.ts`  
  - CEM sampling + EMA smoothing  
  - PFSP opponent pick + Elo updates  
  - Serial and parallel eval (workers)  
  - Writes: `artifacts/simrunner_best_genome.json`, `league_elo.json`  
- Export: `scripts/export-cg-bot.ts` → `my_cg_bot.js` (CG `readline()` format)

---

## Quick start

### Install
```bash
pnpm install
pnpm add -w -D tsx

### Smoke train

pnpm -C packages/sim-runner start train \
  --algo cem --pop 8 --gens 2 \
  --seeds-per 2 --eps-per-seed 1 \
  --jobs 1 --seed 42 \
  --opp-pool greedy,random \
  --hof 3

### Parallel train

pnpm -C packages/sim-runner start train \
  --algo cem --pop 24 --gens 8 \
  --seeds-per 5 --eps-per-seed 2 \
  --jobs 8 --seed 42 \
  --opp-pool greedy,random \
  --hof 5

## Export a Codingame bot

Generates my_cg_bot.js (no imports; uses readline() + console.log()):

pnpm make:cg

The exporter reads packages/sim-runner/artifacts/simrunner_best_genome.json (or artifacts/simrunner_best_genome.json fallback).
If not found, it falls back to a known good genome.

Paste the resulting my_cg_bot.js into the Codingame IDE.

## Run tournaments (local)

Short names greedy,random,evolved are resolved by the loader to absolute file paths.


pnpm -C packages/sim-runner start tourney \
  --bots greedy,random,evolved \
  --seeds 50 \
  --save-dir ../../viewer/public/replays/tourney

Artifacts:

packages/sim-runner/artifacts/tournament_standings.json

Replays in packages/viewer/public/replays/...


## View replays 

pnpm -C packages/viewer dev
# open http://localhost:5173


# Troubleshooting

tsx: command not found
Install at workspace root:

pnpm add -w -D tsx

Tourney: Cannot find package 'packages' imported from .../loadBots.ts
Ensure the loader maps short names to absolute file paths (already fixed here).

CG bot runs locally but not in IDE
Check that the export is a single file, uses readline()/console.log(), and prints exactly one action per buster each turn.



## Roadmap

Enrich opponent pool with disruptors (base camper, aggressive stunner).

Add HoF export & automatic pool refresh.

Add telemetry in replays (action tags).

Exporter variants (patrol heuristics).

CI: smoke train + tourney on PRs.
