import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cem-artifacts-'));

  const res = await trainCemWeights({
    gens: 2,
    pop: 32,
    elitePct: 0.25,
    seed: 123,
    oppPool: ['greedy', 'random', 'base-camper', 'aggressive-stunner'],
    evaluate: evalFn,
    artifactsDir: tmpDir,
  });

  assert.equal(res.mean.length, base.length);
  const baseDist = dist2(base, target);
  const newDist = dist2(res.mean, target);
  assert.ok(newDist < baseDist, 'mean should move toward target');

  const bestPath = path.join(tmpDir, 'simrunner_best_genome.json');
  assert.ok(fs.existsSync(bestPath), 'should persist best genome');
  const hist = fs.readdirSync(tmpDir).filter(f => f.startsWith('genome_') && f.endsWith('.json'));
  assert.ok(hist.length >= 1, 'should write timestamped genome artifact');
});

test('trainCemWeights parallel evaluation matches sequential', async () => {
  const base = weightsToVec(DEFAULT_WEIGHTS);
  const target = base.map((v) => v + 1);

  const baseEval = (w: any) => {
    const vec = weightsToVec(w);
    return -dist2(vec, target);
  };

  // Sequential evaluator: ensures one eval resolves at a time
  let chain = Promise.resolve();
  const seqEval = (w: any, _opp: string) => {
    chain = chain.then(() => Promise.resolve(baseEval(w)));
    return chain;
  };

  // Parallel evaluator with deterministic staggered delays
  let call = 0;
  const parEval = async (w: any, _opp: string) => {
    const delay = (call++ % 5) * 5;
    await new Promise((r) => setTimeout(r, delay));
    return baseEval(w);
  };

  const opts = {
    gens: 1,
    pop: 12,
    elitePct: 0.5,
    seed: 42,
    oppPool: ['greedy', 'random'],
    evaluate: seqEval,
  } as const;

  const seqRes = await trainCemWeights(opts);
  const parRes = await trainCemWeights({ ...opts, evaluate: parEval });

  assert.deepEqual(parRes.mean, seqRes.mean);
  assert.deepEqual(parRes.cov, seqRes.cov);
});
