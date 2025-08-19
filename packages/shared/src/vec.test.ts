import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clamp, dist, dist2, norm, roundi } from './vec';

test('clamp limits value within range', () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test('dist and dist2 compute distances correctly', () => {
  assert.equal(dist2(0, 0, 3, 4), 25);
  assert.equal(dist(0, 0, 3, 4), 5);
});

test('norm returns a unit vector and handles zero length', () => {
  const [x, y] = norm(3, 4);
  assert.ok(Math.abs(x - 0.6) < 1e-9);
  assert.ok(Math.abs(y - 0.8) < 1e-9);
  const [zx, zy] = norm(0, 0);
  assert.equal(zx, 0);
  assert.equal(zy, 0);
});

test('roundi rounds to nearest integer', () => {
  assert.equal(roundi(3.2), 3);
  assert.equal(roundi(3.5), 4);
});
