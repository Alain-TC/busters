import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame } from './engine';
import { MAP_W, MAP_H, TEAM0_BASE, TEAM1_BASE } from '@busters/shared';

test('initGame sets up teams and ghosts within bounds', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 2, ghostCount: 3 });
  assert.equal(state.busters.length, 4);
  assert.equal(state.ghosts.length, 3);

  for (const b of state.busters) {
    if (b.teamId === 0) {
      const dx = Math.abs(b.x - TEAM0_BASE.x);
      const dy = Math.abs(b.y - TEAM0_BASE.y);
      assert.ok(dx <= 200 && dy <= 200);
    } else {
      const dx = Math.abs(b.x - TEAM1_BASE.x);
      const dy = Math.abs(b.y - TEAM1_BASE.y);
      assert.ok(dx <= 200 && dy <= 200);
    }
  }

  for (const g of state.ghosts) {
    assert.ok(g.x >= 500 && g.x <= MAP_W - 500);
    assert.ok(g.y >= 500 && g.y <= MAP_H - 500);
  }
});
