import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame, step, ActionsByTeam } from './engine';
import { MAP_W, MAP_H, TEAM0_BASE, TEAM1_BASE, RULES } from '@busters/shared';

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

test('step moves buster with speed limit', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  const b = state.busters[0];
  b.x = 1000; b.y = 1000;
  const actions: ActionsByTeam = { 0: [{ type: 'MOVE', x: b.x + 2000, y: b.y }], 1: [] } as any;
  const next = step(state, actions);
  const moved = next.busters[0];
  assert.equal(moved.x, b.x + RULES.MOVE_SPEED);
  assert.equal(moved.y, b.y);
});

test('step captures ghost when endurance drops to zero', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters.find(bs => bs.teamId === 0)!;
  b.x = 1000; b.y = 1000;
  const ghost = state.ghosts[0];
  ghost.x = b.x + RULES.BUST_MIN; ghost.y = b.y; ghost.endurance = 1;
  const actions: ActionsByTeam = { 0: [{ type: 'BUST', ghostId: ghost.id }], 1: [] } as any;
  const next = step(state, actions);
  const carrier = next.busters[0];
  assert.equal(next.ghosts.length, 0);
  assert.equal(carrier.state, 1);
  assert.equal(carrier.value, ghost.id);
});

test('step scores when releasing carried ghost in base', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters[0];
  b.x = TEAM0_BASE.x; b.y = TEAM0_BASE.y;
  const ghost = state.ghosts[0];
  ghost.x = b.x + RULES.BUST_MIN; ghost.y = b.y; ghost.endurance = 1;

  const capture: ActionsByTeam = { 0: [{ type: 'BUST', ghostId: ghost.id }], 1: [] } as any;
  const mid = step(state, capture);

  const release: ActionsByTeam = { 0: [{ type: 'RELEASE' }], 1: [] } as any;
  const end = step(mid, release);
  const bEnd = end.busters[0];
  assert.equal(end.scores[0], 1);
  assert.equal(bEnd.state, 0);
  assert.equal(bEnd.value, 0);
});

