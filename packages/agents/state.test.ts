import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HybridState, predictEnemyPath } from './lib/state';

test('trackEnemies records velocity and last two positions', () => {
  const st = new HybridState();
  st.trackEnemies([{ id: 1, x: 2600, y: 1000, carrying: 1 }], 1);
  st.trackEnemies([{ id: 1, x: 1800, y: 1000, carrying: 1 }], 2);
  const e = st.enemies.get(1)!;
  assert.deepEqual(e.prev, { x: 2600, y: 1000 });
  assert.deepEqual(e.last, { x: 1800, y: 1000 });
  assert.ok(Math.abs((e.vel?.x ?? 0) + 800) < 1e-6);
});

test('predictEnemyPath extrapolates toward base', () => {
  const st = new HybridState();
  st.trackEnemies([{ id: 1, x: 2600, y: 1000, carrying: 1 }], 1);
  st.trackEnemies([{ id: 1, x: 1800, y: 1000, carrying: 1 }], 2);
  const e = st.enemies.get(1)!;
  const path = predictEnemyPath(e, { x: 0, y: 0 }, 2);
  assert.deepEqual(path[0], { x: 1000, y: 1000 });
  assert.deepEqual(path[1], { x: 200, y: 1000 });
});

