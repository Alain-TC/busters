import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame, step, ActionsByTeam } from './engine';
import { TEAM0_BASE, RULES, MAX_TICKS } from '@busters/shared';

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
