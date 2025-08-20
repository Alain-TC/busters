import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame, step, ActionsByTeam } from './engine';
import { MAP_W, MAP_H, TEAM0_BASE, TEAM1_BASE, RULES, dist } from '@busters/shared';

test('initGame sets up teams and ghosts within bounds', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 2, ghostCount: 3 });
  assert.equal(state.busters.length, 4);
  assert.equal(state.ghosts.length, 3);

  for (const b of state.busters) {
    if (b.teamId === 0) {
      assert.equal(b.x, TEAM0_BASE.x);
      assert.equal(b.y, TEAM0_BASE.y);
    } else {
      assert.equal(b.x, TEAM1_BASE.x);
      assert.equal(b.y, TEAM1_BASE.y);
    }
  }

  for (const g of state.ghosts) {
    assert.ok(g.x >= 0 && g.x < MAP_W);
    assert.ok(g.y >= 0 && g.y < MAP_H);
    const d0 = dist(g.x, g.y, TEAM0_BASE.x, TEAM0_BASE.y);
    const d1 = dist(g.x, g.y, TEAM1_BASE.x, TEAM1_BASE.y);
    assert.ok(d0 > RULES.BASE_RADIUS);
    assert.ok(d1 > RULES.BASE_RADIUS);
  }
});

test('lone ghost spawns outside base radius', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const g = state.ghosts[0];
  const d0 = dist(g.x, g.y, TEAM0_BASE.x, TEAM0_BASE.y);
  const d1 = dist(g.x, g.y, TEAM1_BASE.x, TEAM1_BASE.y);
  assert.ok(d0 > RULES.BASE_RADIUS);
  assert.ok(d1 > RULES.BASE_RADIUS);
});

test('ghost stamina follows official distribution', () => {
  const total = 1000;
  const state = initGame({ seed: 123, bustersPerPlayer: 0, ghostCount: total });
  const counts: Record<number, number> = { 3: 0, 15: 0, 40: 0 };
  for (const g of state.ghosts) counts[g.endurance]++;
  const pct3 = counts[3] / total;
  const pct15 = counts[15] / total;
  const pct40 = counts[40] / total;
  assert.ok(Math.abs(pct3 - 0.2) < 0.05);
  assert.ok(Math.abs(pct15 - 0.6) < 0.05);
  assert.ok(Math.abs(pct40 - 0.2) < 0.05);
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
    assert.equal(g0.endurance, g1.endurance);
  }
});

test('odd ghost placement depends on seed', () => {
  const s1 = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const s2 = initGame({ seed: 2, bustersPerPlayer: 1, ghostCount: 1 });
  const g1 = s1.ghosts[0];
  const g2 = s2.ghosts[0];
  assert.ok(g1.x >= 0 && g1.x < MAP_W);
  assert.ok(g1.y >= 0 && g1.y < MAP_H);
  assert.ok(g1.x !== g2.x || g1.y !== g2.y);
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

test('stun attempt consumes cooldown even if invalid or out of range', () => {
  // Out of range scenario
  let state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  const attacker = state.busters.find(b => b.teamId === 0)!;
  const victim = state.busters.find(b => b.teamId === 1)!;
  attacker.x = 1000; attacker.y = 1000;
  victim.x = attacker.x + RULES.STUN_RANGE + 1; victim.y = attacker.y;
  let next = step(state, { 0: [{ type: 'STUN', busterId: victim.id }], 1: [] } as any);
  const postAttacker = next.busters.find(b => b.id === attacker.id)!;
  const postVictim = next.busters.find(b => b.id === victim.id)!;
  assert.equal(postAttacker.stunCd, RULES.STUN_COOLDOWN - 1);
  assert.equal(postVictim.state, 0);

  // Invalid target scenario
  state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  const attacker2 = state.busters.find(b => b.teamId === 0)!;
  next = step(state, { 0: [{ type: 'STUN', busterId: 999 }], 1: [] } as any);
  const postAttacker2 = next.busters.find(b => b.id === attacker2.id)!;
  assert.equal(postAttacker2.stunCd, RULES.STUN_COOLDOWN - 1);
});

test('mutual stuns drop carried ghosts and stun both busters', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 2 });
  const b0 = state.busters.find(b => b.teamId === 0)!;
  const b1 = state.busters.find(b => b.teamId === 1)!;

  // place within stun range, far from bases
  b0.x = 5000; b0.y = 5000;
  b1.x = b0.x + RULES.STUN_RANGE - 1; b1.y = b0.y;

  // both carrying a ghost
  const g0 = state.ghosts[0];
  const g1 = state.ghosts[1];
  state.ghosts = [];
  b0.state = 1; b0.value = g0.id;
  b1.state = 1; b1.value = g1.id;

  const actions: ActionsByTeam = {
    0: [{ type: 'STUN', busterId: b1.id }],
    1: [{ type: 'STUN', busterId: b0.id }],
  } as any;

  const next = step(state, actions);
  const nb0 = next.busters.find(b => b.id === b0.id)!;
  const nb1 = next.busters.find(b => b.id === b1.id)!;

  assert.equal(nb0.state, 2);
  assert.equal(nb1.state, 2);
  assert.equal(nb0.value, RULES.STUN_DURATION - 1);
  assert.equal(nb1.value, RULES.STUN_DURATION - 1);
  assert.equal(nb0.stunCd, RULES.STUN_COOLDOWN - 1);
  assert.equal(nb1.stunCd, RULES.STUN_COOLDOWN - 1);

  assert.equal(next.ghosts.length, 2);
  const dg0 = next.ghosts.find(g => g.id === g0.id)!;
  const dg1 = next.ghosts.find(g => g.id === g1.id)!;
  assert.equal(dg0.x, b0.x); assert.equal(dg0.y, b0.y);
  assert.equal(dg1.x, b1.x); assert.equal(dg1.y, b1.y);
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

test('stunned buster cannot complete BUST action', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const attacker = state.busters.find(b => b.teamId === 0)!;
  const victim = state.busters.find(b => b.teamId === 1)!;
  const ghost = state.ghosts[0];

  attacker.x = 1000; attacker.y = 1000;
  victim.x = attacker.x + RULES.STUN_RANGE - 1; victim.y = attacker.y;
  ghost.x = victim.x; ghost.y = victim.y; ghost.endurance = 10;

  const actions: ActionsByTeam = {
    0: [{ type: 'STUN', busterId: victim.id }],
    1: [{ type: 'BUST', ghostId: ghost.id }],
  } as any;

  const next = step(state, actions);

  const gNext = next.ghosts[0];
  assert.equal(gNext.endurance, 10);
  assert.equal(gNext.engagedBy, 0);
  const stunned = next.busters.find(b => b.id === victim.id)!;
  assert.equal(stunned.state, 2);
});

test('stunned buster cannot use RADAR', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  const attacker = state.busters.find(b => b.teamId === 0)!;
  const victim = state.busters.find(b => b.teamId === 1)!;

  attacker.x = 1000; attacker.y = 1000;
  victim.x = attacker.x + RULES.STUN_RANGE - 1; victim.y = attacker.y;

  const actions: ActionsByTeam = {
    0: [{ type: 'STUN', busterId: victim.id }],
    1: [{ type: 'RADAR' }],
  } as any;

  const next = step(state, actions);
  assert.ok(!(victim.id in next.radarNextVision));
});

test('busting state persists into next turn until another action', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters[0];
  const ghost = state.ghosts[0];
  b.x = 1000; b.y = 1000;
  ghost.x = b.x + RULES.BUST_MIN; ghost.y = b.y; ghost.endurance = 2;

  const bust: ActionsByTeam = { 0: [{ type: 'BUST', ghostId: ghost.id }], 1: [] } as any;
  const mid = step(state, bust);
  const bMid = mid.busters[0];
  assert.equal(bMid.state, 3);

  const end = step(mid, { 0: [], 1: [] } as any);
  const bEnd = end.busters[0];
  assert.equal(bEnd.state, 0);
});

test('ghost flees 400 units after detection', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const b = state.busters.find(bs => bs.teamId === 0)!;
  b.x = 1000; b.y = 1000;
  const ghost = state.ghosts[0];
  ghost.x = 1500; ghost.y = 1000;

  const mid = step(state, { 0: [], 1: [] } as any);
  mid.lastSeenTickForGhost[ghost.id] = mid.tick - 1;
  const end = step(mid, { 0: [], 1: [] } as any);
  const gEnd = end.ghosts[0];
  assert.equal(gEnd.x, 1900);
  assert.equal(gEnd.y, 1000);
});

