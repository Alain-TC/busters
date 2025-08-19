import test from 'node:test';
import assert from 'node:assert/strict';
import { trainCemWeights } from './cem-weights';
import { weightsToVec } from '../genomes/weightsGenome';
import { DEFAULT_WEIGHTS } from '../../../agents/weights';

// simple helper
function dist2(a: number[], b: number[]) {
  let s = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    s += d * d;
  }
  return s;
}

test('trainCemWeights moves mean toward target', async () => {
  const base = weightsToVec(DEFAULT_WEIGHTS);
  const target = base.map((v) => v + 1); // arbitrary optimum

  const evalFn = async (w: any, _opp: string) => {
    const vec = weightsToVec(w);
    return -dist2(vec, target);
  };

  const res = await trainCemWeights({
    gens: 2,
    pop: 32,
    elitePct: 0.25,
    seed: 123,
    oppPool: ['greedy', 'random'],
    evaluate: evalFn,
  });

  assert.equal(res.mean.length, base.length);
  const baseDist = dist2(base, target);
  const newDist = dist2(res.mean, target);
  assert.ok(newDist < baseDist, 'mean should move toward target');
});
