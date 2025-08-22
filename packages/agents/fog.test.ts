import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fog } from './fog';

test('bumpGhost raises heat and beginTick decays it', () => {
  const f = new Fog();
  f.bumpGhost(8000, 4500);
  const idx = (f as any).idxOf(8000, 4500);
  const h0 = (f as any).heat[idx];
  assert.ok(h0 > 0);
  f.beginTick(1);
  const h1 = (f as any).heat[idx];
  f.beginTick(2);
  const h2 = (f as any).heat[idx];
  assert.ok(h1 < h0);
  assert.ok(h2 < h1);
});

test('markVisited halves heat and records tick', () => {
  const f = new Fog();
  f.bumpGhost(8000, 4500);
  f.beginTick(1);
  const idx = (f as any).idxOf(8000, 4500);
  const before = (f as any).heat[idx];
  f.markVisited({ x: 8000, y: 4500 });
  const after = (f as any).heat[idx];
  assert.ok(after < before);
  assert.equal((f as any).last[idx], 1);
});

test('clearCircle suppresses heat in a radius', () => {
  const f = new Fog();
  f.bumpGhost(8000, 4500);
  f.beginTick(1);
  const idx = (f as any).idxOf(8000, 4500);
  const before = (f as any).heat[idx];
  f.clearCircle({ x: 8000, y: 4500 }, 400);
  const after = (f as any).heat[idx];
  assert.ok(after < before);
  assert.equal((f as any).last[idx], 1);
});

test('pickFrontierTarget favors hot unvisited cells', () => {
  const f = new Fog();
  // mark entire map as visited
  f.clearCircle({ x: 8000, y: 4500 }, 20000);
  const idx = (f as any).idxOf(8000, 4500);
  // treat center as unvisited again
  (f as any).last[idx] = -1;
  f.bumpGhost(8000, 4500);
  f.beginTick(1);
  const target = f.pickFrontierTarget({ x: 0, y: 0 });
  assert.ok(Math.abs(target.x - 8200) < 400);
  assert.ok(Math.abs(target.y - 4600) < 400);
});
