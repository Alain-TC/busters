import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame, step, ActionsByTeam } from './engine';
import { parseAction, readLines } from './cg-driver';
import { TEAM0_BASE, RULES, MAX_TICKS } from '@busters/shared';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';

test('parseAction parses WAIT as explicit action', () => {
  assert.deepEqual(parseAction('WAIT'), { type: 'WAIT' });
});

test('parseAction throws on malformed inputs', () => {
  assert.throws(() => parseAction('MOVE 1000'));
  assert.throws(() => parseAction('BUST notanid'));
});

test('loop ends when no ghosts remain and none are carried', () => {
  let state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters[0];
  const ghost = state.ghosts[0];
  b.x = TEAM0_BASE.x; b.y = TEAM0_BASE.y;
  ghost.x = b.x + RULES.BUST_MIN + 1; ghost.y = b.y; ghost.endurance = 1;
  // emulate driver loop
  while (state.tick < MAX_TICKS) {
    const actions: ActionsByTeam = state.tick === 0
      ? { 0: [{ type: 'BUST', ghostId: ghost.id }], 1: [] } as any
      : { 0: [{ type: 'RELEASE' }], 1: [] } as any;
    state = step(state, actions);
    if (state.ghosts.length === 0 && !state.busters.some(b => b.state === 1)) {
      break;
    }
  }
  assert.equal(state.scores[0], 1);
});

test('readLines rejects when a bot exceeds the time limit', async () => {
  const s = new PassThrough();
  const rl = readline.createInterface({ input: s });
  const start = Date.now();

  const promise = readLines(rl, 2);
  s.write('MOVE 1 2\n');

  await assert.rejects(promise);
  rl.close(); s.end();

  const elapsed = Date.now() - start;
  assert(elapsed >= 100 && elapsed < 1000);
});
