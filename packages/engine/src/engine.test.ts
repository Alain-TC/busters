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

test('initGame places busters and ghosts symmetrically', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 3, ghostCount: 4 });
  const team0 = state.busters.filter(b => b.teamId === 0);
  const team1 = state.busters.filter(b => b.teamId === 1);
  assert.equal(team0.length, team1.length);
  for (let i = 0; i < team0.length; i++) {
    const b0 = team0[i];
    const b1 = team1[i];
    assert.equal(b0.x + b1.x, MAP_W - 1);
    assert.equal(b0.y + b1.y, MAP_H - 1);
  }

  for (let i = 0; i < state.ghosts.length; i += 2) {
    const g0 = state.ghosts[i];
    const g1 = state.ghosts[i + 1];
    assert.equal(g0.x + g1.x, MAP_W - 1);
    assert.equal(g0.y + g1.y, MAP_H - 1);
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

test('release outside base decrements score', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters[0];
  // start outside base
  b.x = TEAM0_BASE.x + RULES.BASE_RADIUS + RULES.BUST_MIN + 10; b.y = TEAM0_BASE.y;
  const ghost = state.ghosts[0];
  ghost.x = b.x + RULES.BUST_MIN; ghost.y = b.y; ghost.endurance = 1;

  const capture: ActionsByTeam = { 0: [{ type: 'BUST', ghostId: ghost.id }], 1: [] } as any;
  const mid = step(state, capture);

  const release: ActionsByTeam = { 0: [{ type: 'RELEASE' }], 1: [] } as any;
  const end = step(mid, release);
  const bEnd = end.busters[0];
  assert.equal(end.scores[0], -1);
  assert.equal(bEnd.state, 0);
  assert.equal(bEnd.value, 0);
  assert.equal(end.ghosts.length, 1);
  const dropped = end.ghosts[0];
  assert.equal(dropped.id, ghost.id);
  assert.equal(dropped.x, b.x);
  assert.equal(dropped.y, b.y);
});

test('stun drops carried ghost and sets cooldown', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const attacker = state.busters.find(b => b.teamId === 0)!;
  const victim = state.busters.find(b => b.teamId === 1)!;
  // place within stun range
  attacker.x = 1000; attacker.y = 1000;
  victim.x = attacker.x + RULES.STUN_RANGE - 1; victim.y = attacker.y;

  // simulate victim carrying a ghost
  const ghost = state.ghosts[0];
  state.ghosts = [];
  victim.state = 1;
  victim.value = ghost.id;

  const actions: ActionsByTeam = { 0: [{ type: 'STUN', busterId: victim.id }], 1: [] } as any;
  const next = step(state, actions);

  const stunned = next.busters.find(b => b.id === victim.id)!;
  assert.equal(stunned.state, 2);
  assert.equal(stunned.value, RULES.STUN_DURATION - 1);

  const postAttacker = next.busters.find(b => b.id === attacker.id)!;
  assert.equal(postAttacker.stunCd, RULES.STUN_COOLDOWN - 1);

  assert.equal(next.ghosts.length, 1);
  assert.equal(next.ghosts[0].id, ghost.id);
  assert.equal(next.ghosts[0].x, victim.x);
  assert.equal(next.ghosts[0].y, victim.y);
});

test('re-stunning resets stun timer to full duration', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 2, ghostCount: 0 });
  const [attacker1, attacker2] = state.busters.filter(b => b.teamId === 0);
  const victim = state.busters.find(b => b.teamId === 1)!;

  attacker1.x = attacker2.x = 1000;
  attacker1.y = attacker2.y = 1000;
  victim.x = attacker1.x + RULES.STUN_RANGE - 1; victim.y = attacker1.y;

  // first stun
  const first: ActionsByTeam = { 0: [{ type: 'STUN', busterId: victim.id }], 1: [] } as any;
  const mid = step(state, first);
  const afterFirst = mid.busters.find(b => b.id === victim.id)!;
  assert.equal(afterFirst.value, RULES.STUN_DURATION - 1);

  // wait one turn to reduce timer
  const wait = step(mid, { 0: [], 1: [] } as any);
  const afterWait = wait.busters.find(b => b.id === victim.id)!;
  assert.equal(afterWait.value, RULES.STUN_DURATION - 2);

  // second stun from another attacker
  const second: ActionsByTeam = { 0: [undefined, { type: 'STUN', busterId: victim.id }], 1: [] } as any;
  const end = step(wait, second);
  const afterSecond = end.busters.find(b => b.id === victim.id)!;
  assert.equal(afterSecond.value, RULES.STUN_DURATION - 1);
});

test('attempting BUST while carrying causes ghost escape without scoring', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters.find(bs => bs.teamId === 0)!;
  const ghost = state.ghosts[0];

  // Capture the ghost first
  // start outside base to avoid incidental scoring on capture
  b.x = TEAM0_BASE.x + RULES.BASE_RADIUS + RULES.BUST_MIN + 10; b.y = TEAM0_BASE.y;
  ghost.x = b.x; ghost.y = b.y; ghost.endurance = 1;
  const capture: ActionsByTeam = { 0: [{ type: 'BUST', ghostId: ghost.id }], 1: [] } as any;
  const mid = step(state, capture);

  // Attempt to BUST while carrying; the ghost should escape at current position
  const escape: ActionsByTeam = { 0: [{ type: 'BUST', ghostId: ghost.id }], 1: [] } as any;
  const end = step(mid, escape);

  const bEnd = end.busters.find(bs => bs.teamId === 0)!;
  assert.equal(end.scores[0], 0); // no score awarded
  assert.equal(bEnd.state, 0);
  assert.equal(bEnd.value, 0);
  assert.equal(end.ghosts.length, 1);
  const escaped = end.ghosts[0];
  assert.equal(escaped.id, ghost.id);
  assert.equal(escaped.x, b.x);
  assert.equal(escaped.y, b.y);
});

test('eject moves ghost only up to max distance', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters[0];
  const ghost = state.ghosts[0];
  state.ghosts = [];
  b.state = 1;
  b.value = ghost.id;
  b.x = 1000;
  b.y = 1000;

  const targetX = b.x + 500;
  const targetY = b.y;
  const actions: ActionsByTeam = { 0: [{ type: 'EJECT', x: targetX, y: targetY }], 1: [] } as any;
  const next = step(state, actions);
  assert.equal(next.ghosts.length, 1);
  const ejected = next.ghosts[0];
  assert.equal(ejected.x, targetX);
  assert.equal(ejected.y, targetY);
});

test('eject clamps ghost position to map bounds', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters[0];
  const ghost = state.ghosts[0];
  state.ghosts = [];
  b.state = 1;
  b.value = ghost.id;
  b.x = 1000;
  b.y = 1000;

  const actions: ActionsByTeam = { 0: [{ type: 'EJECT', x: -1000, y: -1000 }], 1: [] } as any;
  const next = step(state, actions);
  assert.equal(next.ghosts.length, 1);
  const ejected = next.ghosts[0];
  assert.equal(ejected.x, 0);
  assert.equal(ejected.y, 0);
});

