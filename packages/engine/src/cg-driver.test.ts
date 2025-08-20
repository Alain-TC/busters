import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame, step, ActionsByTeam } from './engine';
import { TEAM0_BASE, RULES, MAX_TICKS } from '@busters/shared';
import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { readLines } from './cg-driver';

test('loop ends when all ghosts are scored', () => {
  let state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters[0];
  const ghost = state.ghosts[0];
  b.x = TEAM0_BASE.x; b.y = TEAM0_BASE.y;
  ghost.x = b.x + RULES.BUST_MIN; ghost.y = b.y; ghost.endurance = 1;
  // emulate driver loop
  while (state.tick < MAX_TICKS) {
    const actions: ActionsByTeam = state.tick === 0
      ? { 0: [{ type: 'BUST', ghostId: ghost.id }], 1: [] } as any
      : { 0: [{ type: 'RELEASE' }], 1: [] } as any;
    state = step(state, actions);
    if (state.scores[0] + state.scores[1] >= state.ghostCount) {
      break;
    }
  }
  assert.equal(state.scores[0], 1);
});

test('driver proceeds when a bot exceeds the time limit', async () => {
  const s0 = new PassThrough();
  const s1 = new PassThrough();
  const rl0 = readline.createInterface({ input: s0 });
  const rl1 = readline.createInterface({ input: s1 });

  const p0 = readLines(rl0, 2);
  const p1 = readLines(rl1, 2);
  const start = Date.now();

  s0.write('MOVE 1 2\n');
  s0.write('BUST 3\n');

  const [lines0, lines1] = await Promise.all([p0, p1]);
  rl0.close(); rl1.close(); s0.end(); s1.end();

  assert.deepEqual(lines0, ['MOVE 1 2', 'BUST 3']);
  assert.deepEqual(lines1, ['WAIT', 'WAIT']);
  const elapsed = Date.now() - start;
  assert(elapsed >= 100 && elapsed < 1000);
});
