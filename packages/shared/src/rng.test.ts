import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CodinGameRandom } from './rng';

test('CodinGameRandom generates a deterministic sequence', () => {
  const rng = new CodinGameRandom(1);
  assert.equal(rng.int(), 3139097971);
  assert.equal(rng.int(), 431529176);
});

test('CodinGameRandom float output is within [0, 1) and matches known value', () => {
  const rng = new CodinGameRandom(1);
  const v = rng.float();
  assert.ok(v >= 0 && v < 1);
  assert.equal(v, 0.7308781907032909);
});

test('CodinGameRandom intBetween stays within bounds', () => {
  const rng = new CodinGameRandom(123);
  for (let i = 0; i < 1000; i++) {
    const v = rng.intBetween(5);
    assert.ok(v >= 0 && v < 5);
  }
});
