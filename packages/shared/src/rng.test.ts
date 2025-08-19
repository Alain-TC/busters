import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XorShift32 } from './rng';

test('XorShift32 generates a deterministic sequence', () => {
  const rng = new XorShift32(1);
  assert.equal(rng.int(), 270369);
  assert.equal(rng.int(), 67634689);
});

test('XorShift32 float output is within [0, 1)', () => {
  const rng = new XorShift32(123);
  for (let i = 0; i < 5; i++) {
    const v = rng.float();
    assert.ok(v >= 0 && v < 1);
  }
});
