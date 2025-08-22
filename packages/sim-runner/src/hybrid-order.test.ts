import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER, baselineVec, twFromVec, vecFromTW } from './subjects/hybrid';
import { TUNE, WEIGHTS } from '@busters/agents/hybrid-params';

test('ORDER covers all TUNE and WEIGHTS keys', () => {
  const expected = [
    ...Object.keys(TUNE).map(k => `TUNE.${k}`),
    ...Object.keys(WEIGHTS).map(k => `WEIGHTS.${k}`),
  ].sort();
  const actual = [...ORDER].sort();
  assert.deepEqual(actual, expected);
});

test('baseline vector round-trips through twFromVec and vecFromTW', () => {
  const base = baselineVec();
  const round = vecFromTW(twFromVec(base));
  assert.deepEqual(round, base);
});
