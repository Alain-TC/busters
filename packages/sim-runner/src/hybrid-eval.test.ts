import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateHybrid, HYBRID_MEAN } from './evalers/hybrid';

test('evaluateHybrid executes with default vector', async () => {
  const score = await evaluateHybrid(HYBRID_MEAN, { oppPool: [], seeds: [], epsPerSeed: 1 });
  assert.equal(typeof score, 'number');
});
