import test from 'node:test';
import assert from 'node:assert/strict';
import { ORDER } from './subjects/hybrid';
import { TUNE, WEIGHTS } from '@busters/agents/hybrid-params';

test('ORDER covers all TUNE and WEIGHTS keys', () => {
  const expected = [
    ...Object.keys(TUNE).map(k => `TUNE.${k}`),
    ...Object.keys(WEIGHTS).map(k => `WEIGHTS.${k}`),
  ].sort();
  const actual = [...ORDER].sort();
  assert.deepEqual(actual, expected);
});
