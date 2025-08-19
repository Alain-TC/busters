/** CEM over the Weights genome (number[]).  Scaffold only.  Wire in after validation.
 *  Expected usage (once CLI supports --algo cem-weights):
 *  - sample vectors, map to weights via vecToWeights, run PFSP eval producing fitness,
 *    update mean/cov, repeat.
 */
import { vecToWeights, weightsToVec } from "../genomes/weightsGenome";
import { DEFAULT_WEIGHTS, type Weights } from "../../../agents/weights";
import { selectOpponentsPFSP } from "../pfsp";
import { gaussian, mulberry32, vecMean, vecVar } from "./cem-utils";

// Dimension of the flat weight vector
const DIM = weightsToVec(DEFAULT_WEIGHTS).length;

export type TrainOpts = {
  gens: number;
  pop: number;
  elitePct: number;
  seed: number;
  oppPool: string[];
  evaluate: (w: Weights, oppId: string) => Promise<number>;
};

/** Train weights using a simple diagonal-covariance CEM loop. */
export async function trainCemWeights(opts: TrainOpts) {
  const { gens, pop, elitePct, seed, oppPool, evaluate } = opts;
  const rng = mulberry32(seed >>> 0);

  let mean = weightsToVec(DEFAULT_WEIGHTS);
  let cov = new Array(DIM).fill(1);
  const eliteCount = Math.max(1, Math.floor(pop * elitePct));

  for (let g = 0; g < gens; g++) {
    // --- Sample population ---
    const popVecs: number[][] = [];
    for (let i = 0; i < pop; i++) {
      const v: number[] = [];
      for (let d = 0; d < DIM; d++) {
        v[d] = mean[d] + Math.sqrt(cov[d]) * gaussian(rng);
      }
      popVecs.push(v);
    }

    // --- Evaluate via PFSP-opponent sampling ---
    const evals: { idx: number; fit: number }[] = [];
    for (let i = 0; i < pop; i++) {
      const w = vecToWeights(popVecs[i]);
      const opp = selectOpponentsPFSP({ meId: "weights", candidates: oppPool, n: 1 })[0].id;
      const fit = await evaluate(w, opp);
      evals.push({ idx: i, fit });
    }
    evals.sort((a, b) => b.fit - a.fit);

    // --- Update mean & covariance from elites ---
    const elites = evals.slice(0, eliteCount).map((e) => popVecs[e.idx]);
    mean = vecMean(elites);
    cov = vecVar(elites, mean);
  }

  return { mean, cov };
}
