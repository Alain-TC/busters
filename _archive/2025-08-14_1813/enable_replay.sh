#!/usr/bin/env bash
set -e

echo ">>> 1) Adding onTick support to runEpisodes.ts..."
cat > packages/sim-runner/src/runEpisodes.ts <<'EOF'
import { initGame, step, observationsForTeam } from '@busters/engine';
import type { Action } from '@busters/shared';

export interface RunOpts {
  seed: number;
  episodes: number;
  bustersPerPlayer: number;
  ghostCount: number;
  botA: any;
  botB: any;
  onTick?: (state: any) => void; // NEW
}

export async function runEpisodes(opts: RunOpts) {
  let totalScoreA = 0, totalScoreB = 0;
  for (let ep = 0; ep < opts.episodes; ep++) {
    let state = initGame({
      seed: opts.seed + ep,
      bustersPerPlayer: opts.bustersPerPlayer,
      ghostCount: opts.ghostCount
    });
    const ctxA = { teamId: 0, mapW: state.width, mapH: state.height };
    const ctxB = { teamId: 1, mapW: state.width, mapH: state.height };

    while (true) {
      const obsA = observationsForTeam(state, 0);
      const obsB = observationsForTeam(state, 1);
      const actsA: Action[] = obsA.map(o => opts.botA.act(ctxA, o));
      const actsB: Action[] = obsB.map(o => opts.botB.act(ctxB, o));

      state = step(state, { 0: actsA, 1: actsB } as any);

      opts.onTick?.(state); // NEW HOOK

      if (state.tick >= 250 || state.ghosts.length === 0) break;
    }
    totalScoreA += state.scores[0];
    totalScoreB += state.scores[1];
  }
  return { scoreA: totalScoreA, scoreB: totalScoreB };
}
EOF

echo ">>> 2) Updating cli.ts to handle --replay flag..."
cat > packages/sim-runner/src/cli.ts <<'EOF'
import { runEpisodes } from './runEpisodes';
import * as fs from 'fs';
import * as path from 'path';

function arg(name: string) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 ? process.argv[idx + 1] : null;
}

async function main() {
  const mode = process.argv[2];
  if (mode === 'sim') {
    const botAPath = process.argv[3];
    const botBPath = process.argv[4];
    const replayPath = arg('--replay');

    const botA = await import(path.resolve(botAPath));
    const botB = await import(path.resolve(botBPath));

    let frames: any[] = [];
    const res = await runEpisodes({
      seed: 42,
      episodes: 1,
      bustersPerPlayer: 3,
      ghostCount: 12,
      botA,
      botB,
      onTick: replayPath
        ? (s) =>
            frames.push({
              tick: s.tick,
              width: s.width,
              height: s.height,
              busters: s.busters,
              ghosts: s.ghosts,
              scores: s.scores
            })
        : undefined
    });

    console.log(`A(${path.basename(botAPath)}) vs B(${path.basename(botBPath)}) ->`, res);

    if (replayPath) {
      fs.mkdirSync(path.dirname(replayPath), { recursive: true });
      fs.writeFileSync(replayPath, JSON.stringify({ frames }, null, 0));
      console.log('Replay saved to', replayPath);
    }
  }

  if (mode === 'train') {
    console.log('Training mode not modified here.');
  }

  if (mode === 'compile') {
    console.log('Compile mode not modified here.');
  }
}

main();
EOF

echo ">>> 3) Done! You can now run sim with --replay to save a JSON replay."
echo "Example:"
echo "pnpm -C packages/sim-runner start sim ../../agents/evolved-bot.js ../../agents/greedy-buster.js --replay ../../viewer/public/replays/evolved-vs-greedy.json"

