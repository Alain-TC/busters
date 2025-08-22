import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Fog } from './fog';

test('constructor seeds heat at spawn points', () => {
  const f = new Fog([{ x: 0, y: 0 }]);
  const idx = (f as any).idxOf(0, 0);
  const h = (f as any).heat[idx];
  assert.ok(h > 0);
});

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

test('bumpCorridor increases corridor probability and decays', () => {
  const f = new Fog();
  const path = [
    { x: 0, y: 0 },
    { x: 8000, y: 4500 },
    { x: 16000, y: 9000 }
  ];
  f.bumpCorridor(path);
  const idx = (f as any).idxOf(8000, 4500);
  const c0 = (f as any).corridor[idx];
  assert.ok(c0 > 0);
  f.beginTick(1);
  const c1 = (f as any).corridor[idx];
  assert.ok(c1 < c0);
});
