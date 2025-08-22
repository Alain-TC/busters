import { runEpisodes } from "../runEpisodes";
import { DEFAULT_HYBRID_PARAMS, HYBRID_ORDER, HYBRID_BOUNDS, fromVector } from "@busters/agents/hybrid-params";
import { setHybridParams } from "@busters/agents/hybrid-bot";
import { defaultSigmas } from "../subjects";

function clampVec(vec: number[]) {
  return vec.map((v, i) => {
    const k = HYBRID_ORDER[i];
    const b = HYBRID_BOUNDS[k];
    let x = Math.max(b.lo, Math.min(b.hi, v));
    if (b.round) x = Math.round(x);
    return x;
  });
}

export const HYBRID_DIM   = HYBRID_ORDER.length;
export const HYBRID_MEAN  = HYBRID_ORDER.map(k => DEFAULT_HYBRID_PARAMS[k]);
export const HYBRID_SIGMA = defaultSigmas();
export const HYBRID_CLIP  = {
  lo: HYBRID_ORDER.map(k => HYBRID_BOUNDS[k].lo),
  hi: HYBRID_ORDER.map(k => HYBRID_BOUNDS[k].hi),
};

// Minimal type to match your train code
export type EvalOpts = {
  oppPool: string[];      // e.g. ["greedy","stunner","camper","random","base-camper","aggressive-stunner","hybrid"]
  seeds: number[];
  epsPerSeed: number;
};

export async function evaluateHybrid(vec: number[], opts: EvalOpts): Promise<number> {
  // 1) apply params to our agent
  setHybridParams(fromVector(clampVec(vec)));

  // 2) run episodes vs pool (we are always A)
  const myBot = { type: "module", spec: "@busters/agents/hybrid" };
  let wins = 0, draws = 0, losses = 0;
  let marginSum = 0;

  for (const tag of opts.oppPool) {
    const spec = tag.startsWith("@") ? tag : `@busters/agents/${tag}`;
    const opp = { type: "module", spec };

    for (const seed of opts.seeds) {
      const res = await runEpisodes({
        botA: myBot,
        botB: opp,
        seed,
        episodes: opts.epsPerSeed ?? 1,
        saveReplays: false,
        logPfsp: true, // keep your pfsp_log.jsonl behavior
      });

      const scoreA = (res as any).scoreA ?? 0;
      const scoreB = (res as any).scoreB ?? 0;
      marginSum += (scoreA - scoreB);

      if (scoreA > scoreB) wins++;
      else if (scoreA < scoreB) losses++;
      else draws++;
    }
  }

  const total = wins + draws + losses || 1;
  const wr = (wins + 0.5 * draws) / total; // 0..1
  const margin = marginSum / total;
  return wr * 100 + margin * 0.1; // scalar fitness
}

export function vectorToArtifact(vec: number[]) {
  return { type: "hybrid-params", params: fromVector(clampVec(vec)) };
}

