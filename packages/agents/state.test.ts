import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HybridState, predictEnemyPath, type EnemySeen } from './lib/state';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

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

test('bestFrontier combines visits with ghost and corridor probabilities', () => {
  const st = new HybridState({ w: 16000, h: 9000 }, 2, 1);

  // More visited cell should still be chosen if ghost weight is high enough
  st.visits[0] = 2;
  st.visits[1] = 0;
  st.ghostProb[0] = 1;
  st.ghostProb[1] = 0;
  st.normalizeGhosts();
  st.normalizeCorridors();
  let p = st.bestFrontier(2, 0); // emphasize ghost probability
  assert.deepEqual(p, { x: 4000, y: 4500 });

  // Corridor probability influences selection when visits are equal
  st.visits[0] = 0;
  st.visits[1] = 0;
  st.ghostProb[0] = 0;
  st.ghostProb[1] = 0;
  st.corridorProb[0] = 0;
  st.corridorProb[1] = 1;
  st.normalizeGhosts();
  st.normalizeCorridors();
  p = st.bestFrontier();
  assert.deepEqual(p, { x: 12000, y: 4500 });
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const botFile = path.join(root, 'codingame_bot.js');

test('codingame bot sends carrier home', () => {
  const code = fs.readFileSync(botFile, 'utf8');
  const cases: [number, string, string][] = [
    [0, '0 3000 3000 0 1 0', 'MOVE 0 0'],
    [1, '0 13000 6000 1 1 0', 'MOVE 16000 9000']
  ];

  for (const [teamId, entityLine, expected] of cases) {
    const inputs = [
      '1', // busters per player
      '0', // ghost count
      String(teamId),
      '1', // one visible entity
      entityLine
    ];
    const outputs: string[] = [];
    const sandbox = {
      readline: () => inputs.shift(),
      console: {
        log: (s: string) => {
          outputs.push(String(s));
          throw new Error('stop');
        }
      }
    };
    try {
      vm.runInNewContext(code, sandbox);
    } catch {
      // Expected stop after first output
    }
    assert.ok(outputs[0].startsWith(expected), `team ${teamId} should output ${expected}`);
  }
});

