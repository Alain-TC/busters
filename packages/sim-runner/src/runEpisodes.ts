import { initGame, step } from '@busters/engine';
import { observationsForTeam } from '@busters/engine';
import { TEAM0_BASE, TEAM1_BASE } from '@busters/shared';
import type { Action, AgentContext } from '@busters/shared';
import { XorShift32 } from '@busters/shared';

type DebugEvent = {
  side: 'A' | 'B';
  busterId: number;
  tag: string;
  reason?: string;
  data?: any;
  action?: any;
};

export interface RunOpts {
  seed: number;
  episodes: number;
  bustersPerPlayer: number;  // default when no sampler provided
  ghostCount: number;        // default when no sampler provided
  botA: any;
  botB: any;
  onTick?: (state: any) => void;
  /**
   * Optional sampler to vary params per episode while keeping determinism.
   * If provided, it overrides bustersPerPlayer/ghostCount/seed for that episode.
   */
  sampler?: (epIndex: number, rng: XorShift32) => {
    bustersPerPlayer: number;
    ghostCount: number;
    seedOffset?: number; // added to base seed to create the episode seed
  };
}

export async function runEpisodes(opts: RunOpts) {
  let totalScoreA = 0, totalScoreB = 0;
  const masterRng = new XorShift32(opts.seed ^ 0x9e3779b1);

  for (let ep = 0; ep < opts.episodes; ep++) {
    const s = opts.sampler?.(ep, masterRng);
    const bpp   = s?.bustersPerPlayer ?? opts.bustersPerPlayer;
    const ghosts= s?.ghostCount ?? opts.ghostCount;
    const epSeed = opts.seed + ep + (s?.seedOffset ?? 0);

    let state = initGame({
      seed: epSeed,
      bustersPerPlayer: bpp,
      ghostCount: ghosts
    });

    const ctxA: AgentContext = { teamId: 0, mapW: state.width, mapH: state.height, myBase: TEAM0_BASE };
    const ctxB: AgentContext = { teamId: 1, mapW: state.width, mapH: state.height, myBase: TEAM1_BASE };

    while (true) {
      const obsA = observationsForTeam(state, 0);
      const obsB = observationsForTeam(state, 1);

      const actsA: Action[] = obsA.map(o => (opts.botA.act ? opts.botA.act(ctxA, o) : opts.botA.default?.act(ctxA, o)));
      const actsB: Action[] = obsB.map(o => (opts.botB.act ? opts.botB.act(ctxB, o) : opts.botB.default?.act(ctxB, o)));

      state = step(state, { 0: actsA, 1: actsB } );

      opts.onTick?.(state);

      if (state.gameOver) break;
    }

    totalScoreA += state.scores[0];
    totalScoreB += state.scores[1];
  }

  return { scoreA: totalScoreA, scoreB: totalScoreB };
}
