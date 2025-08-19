/** CEM over the Weights genome (number[]).  Scaffold only.  Wire in after validation.
 *  Expected usage (once CLI supports --algo cem-weights):
 *  - sample vectors, map to weights via vecToWeights, run PFSP eval producing fitness,
 *    update mean/cov, repeat.
 */
import { vecToWeights, weightsToVec } from "../genomes/weightsGenome";
// TODO: import your existing CEM utilities here and specialize for dimension = weightsToVec(DEFAULT).length

export async function trainCemWeights(/* params */){
  // TODO: integrate with your existing training loop
  return null;
}
