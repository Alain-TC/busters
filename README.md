# Busters — CEM-Trained CodinGame Bot (Monorepo)

Evolves a [CodinGame "Busters"](https://www.codingame.com/multiplayer/bot-programming/busters) bot using the **Cross-Entropy Method (CEM)**. Trains against a pool of opponents and exports a single-file bot (`readline()` loop) compatible with the CodinGame IDE.

## Table of Contents
- [Current Status](#current-status)
- [Repository Structure](#repository-structure)
- [Quick Start](#quick-start)
- [Export a CodinGame Bot](#export-a-codingame-bot)
- [Run Local Tournaments](#run-local-tournaments)
- [View Replays](#view-replays)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
 - [EVOL2 Milestones](docs/EVOL2.md#milestones-at-a-glance)
- [Game Rules (FR)](#game-rules-fr)

## Current Status
- Serial sanity ✅
- Parallel training ✅
- Best genome example: `{ "radarTurn": 23, "stunRange": 1766, "releaseDist": 1600 }`
- Fitness ≈ 2.28
- Exporter writes `agents/codingame-bot.js`
- Tournament works (`greedy`, `random`, `evolved` resolved correctly)

## Repository Structure
```
packages/
agents/           # baseline & evolved adapters
engine/           # core simulation: state, step, perception, scoring
shared/           # constants, RNG, types, vector helpers
sim-runner/       # training + tournaments (CEM, PFSP/Elo, workers, artifacts)
viewer/           # Vite replay viewer (reads JSON from public/replays/)
scripts/          # export helpers & reports
```

## Quick Start

### Install
```bash
pnpm install
```

### Smoke Train
```bash
pnpm -C packages/sim-runner start train \
  --algo cem --pop 8 --gens 2 \
  --seeds-per 2 --eps-per-seed 1 \
  --jobs 1 --seed 42 \
    --opp-pool greedy,random,stunner,camper,defender,scout,base-camper,aggressive-stunner \
  --hof 3
# optional:
#   --hof-refresh 5      # refresh HOF every 5 generations
#   --elo-out path/to/elo.json  # write Elo ratings after each gen
```

### Parallel Train
```bash
pnpm -C packages/sim-runner start train \
  --algo cem --pop 24 --gens 8 \
  --seeds-per 5 --eps-per-seed 2 \
  --jobs 8 --seed 42 \
    --opp-pool greedy,random,stunner,camper,defender,scout,base-camper,aggressive-stunner \
  --hof 5
# optional flags as above
```

## Export a CodinGame Bot
Follow these steps to bundle the latest tuned genome into a single-file bot:

1. Ensure training has produced a genome JSON in `artifacts/` or `packages/sim-runner/artifacts/`.
2. Run the exporter (auto-detects the most recent genome):
   ```bash
   pnpm cg:export:genome
   ```
   This writes `agents/codingame-bot.js` with a version tag for traceability.
3. Copy `agents/codingame-bot.js` into the CodinGame IDE.

Other variants:
```bash
pnpm cg:export:hybrid   # baseline hybrid bot
pnpm cg:export:champ    # champion from tournament standings
```

For long training runs, `scripts/train_long.sh` invokes the exporter automatically and writes `agents/evolved-bot.cg.js`.

See the [EVOL2 milestones](docs/EVOL2.md#milestones-at-a-glance) for project progress.

## Run Local Tournaments
Short names `greedy`, `random`, `evolved` are resolved by the loader to absolute file paths.

```bash
pnpm -C packages/sim-runner start tourney \
  --bots greedy,random,evolved \
  --seeds 50 \
  --save-dir ../../viewer/public/replays/tourney
```

Artifacts:
- `packages/sim-runner/artifacts/tournament_standings.json`
- Replays in `packages/viewer/public/replays/...`

## View Replays
```bash
pnpm -C packages/viewer dev
# open http://localhost:5173
```

## Troubleshooting

- **`tsx: command not found`**
  Ensure dependencies are installed:
  ```bash
  pnpm install
  ```
- **Tourney: Cannot find package 'packages' imported from .../loadBots.ts**
  Ensure the loader maps short names to absolute file paths (already fixed here).
- **CG bot runs locally but not in IDE**
  Check that the export is a single file, uses `readline()`/`console.log()`, and prints exactly one action per buster each turn.

## Roadmap
- Enrich opponent pool with disruptors (base camper, aggressive stunner).
- Add HoF export & automatic pool refresh.
- Add telemetry in replays (action tags).
- Exporter variants (patrol heuristics).
- CI: smoke train + tourney on PRs.

## Game Rules (FR)
Consultez la documentation détaillée : [docs/rules-fr.md](docs/rules-fr.md).

