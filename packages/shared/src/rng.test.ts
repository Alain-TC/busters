import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XorShift32, mulberry32, gaussian } from './rng';

test('XorShift32 generates a deterministic sequence', () => {
  const rng = new XorShift32(1);
  assert.equal(rng.int(), 270369);
  assert.equal(rng.int(), 67634689);
});

test('XorShift32 float output is within [0, 1) and never equals 1', () => {
  const rng = new XorShift32(123);
  for (let i = 0; i < 1_000_000; i++) {
    const v = rng.float();
    assert.ok(v >= 0 && v < 1);
  }
});

test('XorShift32 float handles max int without returning 1', () => {
  // Seed computed to make the first int() call return 0xFFFFFFFF
  const rng = new XorShift32(1584200935);
  const v = rng.float();
  assert.ok(v < 1);
});

test('mulberry32 generates a deterministic sequence', () => {
  const rng = mulberry32(1);
  assert.ok(Math.abs(rng() - 0.6270739405881613) < 1e-9);
  assert.ok(Math.abs(rng() - 0.002735721180215478) < 1e-9);
});

test('gaussian draws using provided RNG and caches second value', () => {
  const vals = [0.1, 0.2];
  let i = 0;
  const rng = () => vals[i++];
  const g1 = gaussian(rng);
  const g2 = gaussian(rng);
  assert.ok(Math.abs(g1 - 0.6631399714746835) < 1e-9);
  assert.ok(Math.abs(g2 - 2.0409349730505) < 1e-9);
  assert.equal(i, 2); // rng consumed only once for both samples
});

test('gaussian distribution has ~0 mean and unit variance', () => {
  const rng = mulberry32(123456);
  const n = 100000;
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < n; i++) {
    const g = gaussian(rng);
    sum += g;
    sumSq += g * g;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  assert.ok(Math.abs(mean) < 0.05);
  assert.ok(Math.abs(variance - 1) < 0.05);
});
