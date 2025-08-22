import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HybridState, predictEnemyPath, type EnemySeen } from './lib/state';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { execSync } from 'node:child_process';

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
  assert.deepEqual(path[1], { x: 434, y: 434 });
});

test('predictEnemyPath reorients when velocity away from base', () => {
  const e: EnemySeen = {
    id: 1,
    last: { x: 1000, y: 1000 },
    vel: { x: 800, y: 0 },
    lastTick: 0,
    carrying: false,
    stunCd: undefined,
  };
  const base = { x: 0, y: 0 };
  const path = predictEnemyPath(e, base, 3);
  assert.deepEqual(path[0], { x: 1800, y: 1000 });
  assert.deepEqual(path[1], { x: 1101, y: 611 });
});

test('predictEnemyPath clamps to map bounds', () => {
  const base = { x: 8000, y: 4500 };
  const eLow: EnemySeen = {
    id: 1,
    last: { x: 100, y: 100 },
    vel: { x: -800, y: -800 },
    lastTick: 0,
    carrying: false,
    stunCd: undefined,
  };
  const eHigh: EnemySeen = {
    id: 2,
    last: { x: 15900, y: 8900 },
    vel: { x: 800, y: 800 },
    lastTick: 0,
    carrying: false,
    stunCd: undefined,
  };
  const low = predictEnemyPath(eLow, base, 2);
  const high = predictEnemyPath(eHigh, base, 2);
  assert.deepEqual(low[0], { x: 0, y: 0 });
  assert.deepEqual(high[0], { x: 16000, y: 9000 });
});

test('updateCorridors tracks unseen carrier path and decays', () => {
  const st = new HybridState();
  st.trackEnemies([{ id: 1, x: 2600, y: 1000, carrying: 1 }], 1);
  const e = st.enemies.get(1)!;
  const base = { x: 0, y: 0 };
  const path = predictEnemyPath(e, base, 10);
  st.updateCorridors(base);
  const p = path[0];
  const before = st.corridorProbAt(p);
  assert.ok(before > 0);
  st.decayCorridors();
  const after = st.corridorProbAt(p);
  assert.ok(after < before);
});

test('codingame bot does not RELEASE when outside base radius', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(__dirname, '..', '..');
  const botPath = path.join(root, 'codingame_bot.js');
  let code: string;
  try {
    code = fs.readFileSync(botPath, 'utf8');
  } catch {
    // file may be removed by other tests; fall back to staged blob
    code = execSync('git show :codingame_bot.js', { cwd: root, encoding: 'utf8' });
  }
  const inputs = [
    '1', // busters per player
    '0', // ghost count
    '0', // my team id
    '1', // number of entities
    // id x y team state value -> carrying ghost outside base radius
    `0 1601 0 0 1 0`
  ];
  const outputs: string[] = [];
  function readline() {
    if (inputs.length === 0) throw new Error('EOF');
    return inputs.shift() as string;
  }
  try {
    vm.runInNewContext(code, {
      readline,
      console: { log: (s: string) => outputs.push(String(s)) }
    });
  } catch {
    // expected to throw once inputs are exhausted to stop loop
  }
  assert.equal(outputs.length, 1);
  assert.ok(!outputs[0].startsWith('RELEASE'), 'should not release outside base');
});

