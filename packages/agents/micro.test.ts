import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contestedBustDelta, duelStunDelta, releaseBlockDelta, twoTurnContestDelta } from './micro';

// Verify contested bust uses projected positions
const STUN = 1760;
const BUST_MIN = 900;
const BUST_MAX = 1760;

test('contested bust projects one turn ahead', () => {
  const me = { id: 1, x: 2000, y: 0 };
  const ghost = { x: 0, y: 0 };
  // entering ring next turn grants positive delta
  const alone = contestedBustDelta({
    me,
    ghost,
    enemies: [],
    bustMin: BUST_MIN,
    bustMax: BUST_MAX,
    stunRange: STUN,
    canStunMe: true,
  });
  assert.ok(alone > 0);
  // enemy becomes nearby after one move -> negative delta
  const enemy = { id: 2, x: 2600, y: 0 };
  const contested = contestedBustDelta({
    me,
    ghost,
    enemies: [enemy],
    bustMin: BUST_MIN,
    bustMax: BUST_MAX,
    stunRange: STUN,
    canStunMe: true,
  });
  assert.ok(contested < 0);
});

test('duel stun projects closing distance', () => {
  const me = { id: 1, x: 0, y: 0 };
  const enemy = { id: 2, x: 2500, y: 0 };
  const delta = duelStunDelta({
    me,
    enemy,
    canStunMe: true,
    canStunEnemy: false,
    stunRange: STUN,
  });
  assert.ok(delta > 0);
});

test('two-turn duel catches distant threat', () => {
  const me = { id: 1, x: 0, y: 0 };
  const enemy = { id: 2, x: 4000, y: 0 };
  const first = duelStunDelta({
    me,
    enemy,
    canStunMe: true,
    canStunEnemy: false,
    stunRange: STUN,
  });
  const second = twoTurnContestDelta({
    me,
    enemy,
    bustMin: BUST_MIN,
    bustMax: BUST_MAX,
    stunRange: STUN,
    canStunMe: true,
    canStunEnemy: false,
  });
  assert.equal(first, 0);
  assert.ok(second > 0);
});

test('two-turn bust penalizes incoming enemy stunner', () => {
  const me = { id: 1, x: 2000, y: 0 };
  const enemy = { id: 2, x: 3300, y: 0 };
  const ghost = { x: 0, y: 0 };
  const first = contestedBustDelta({
    me,
    ghost,
    enemies: [enemy],
    bustMin: BUST_MIN,
    bustMax: BUST_MAX,
    stunRange: STUN,
    canStunMe: false,
  });
  const second = twoTurnContestDelta({
    me,
    enemy,
    ghost,
    bustMin: BUST_MIN,
    bustMax: BUST_MAX,
    stunRange: STUN,
    canStunMe: false,
    canStunEnemy: true,
  });
  assert.ok(first > 0);
  assert.ok(second < 0);
});

test('release block projects carrier path', () => {
  const blocker = { id: 1, x: 3200, y: 0 };
  const carrier = { id: 2, x: 2600, y: 0 };
  const myBase = { x: 0, y: 0 };
  const delta = releaseBlockDelta({ blocker, carrier, myBase, stunRange: STUN });
  assert.ok(delta > 0);
});
