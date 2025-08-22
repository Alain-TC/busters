import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { contestedBustDelta, duelStunDelta, releaseBlockDelta, twoTurnContestDelta, ejectDelta, interceptDelta, twoTurnInterceptDelta, twoTurnEjectDelta, resetMicroPerf, microPerf, microOverBudget, MICRO_BUDGET_MS } from './micro';
import { RULES } from '../shared/src/constants.ts';
import { STUN_CHECK_RADIUS } from './hybrid/planner';

// Verify contested bust uses projected positions
const STUN = RULES.STUN_RANGE;
const BUST_MIN = RULES.BUST_MIN;
const BUST_MAX = RULES.BUST_MAX;

beforeEach(() => resetMicroPerf());

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
  const enemy = { id: 2, x: STUN_CHECK_RADIUS, y: 0 };
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

test('ejectDelta favors progress and ally handoff', () => {
  const me = { id: 1, x: 4000, y: 4000 };
  const target = { x: 3500, y: 3500 };
  const myBase = { x: 0, y: 0 };
  const ally = { id: 2, x: 3300, y: 3300 };
  const delta = ejectDelta({ me, target, myBase, ally });
  assert.ok(delta > 0);
});

test('interceptDelta rewards beating enemy to intercept', () => {
  const me = { id: 1, x: 3000, y: 0 };
  const enemy = { id: 2, x: 6000, y: 0 };
  const myBase = { x: 0, y: 0 };
  const delta = interceptDelta({ me, enemy, myBase });
  assert.ok(delta > 0);
  const second = twoTurnInterceptDelta({
    me,
    enemy,
    myBase,
    stunRange: STUN,
    canStunMe: true,
    canStunEnemy: false,
  });
  assert.ok(second > delta);
});

test('twoTurnEjectDelta penalizes enemy near landing', () => {
  const me = { id: 1, x: 4000, y: 4000 };
  const target = { x: 3500, y: 3500 };
  const myBase = { x: 0, y: 0 };
  const farEnemy = { id: 2, x: 7000, y: 7000 };
  const nearEnemy = { id: 3, x: 3600, y: 3600 };
  const safe = twoTurnEjectDelta({
    me,
    enemy: farEnemy,
    target,
    myBase,
    stunRange: STUN,
    canStunEnemy: true,
  });
  const risky = twoTurnEjectDelta({
    me,
    enemy: nearEnemy,
    target,
    myBase,
    stunRange: STUN,
    canStunEnemy: true,
  });
  assert.ok(risky < safe);
});

test('micro rollouts cache and stay under budget', () => {
  const me = { id: 1, x: 0, y: 0 };
  const enemy = { id: 2, x: 3000, y: 0 };
  const ghost = { x: 1000, y: 0 };
  const myBase = { x: 0, y: 0 };
  const baseContest = {
    me,
    enemy,
    ghost,
    bustMin: BUST_MIN,
    bustMax: BUST_MAX,
    stunRange: STUN,
    canStunMe: true,
    canStunEnemy: true,
  } as const;
  const firstC = twoTurnContestDelta({ ...baseContest, me: { ...me }, enemy: { ...enemy }, ghost: { ...ghost } });
  const contestMs = microPerf.twoTurnMs;
  for (let i = 0; i < 5; i++) {
    const opts = { ...baseContest, me: { ...me }, enemy: { ...enemy }, ghost: { ...ghost } };
    assert.equal(twoTurnContestDelta(opts), firstC);
  }
  assert.equal(microPerf.twoTurnMs, contestMs);

  const baseIntercept = {
    me,
    enemy,
    myBase,
    stunRange: STUN,
    canStunMe: true,
    canStunEnemy: true,
  } as const;
  const firstI = twoTurnInterceptDelta({ ...baseIntercept, me: { ...me }, enemy: { ...enemy }, myBase: { ...myBase } });
  const interceptMs = microPerf.interceptMs;
  for (let i = 0; i < 5; i++) {
    const opts = { ...baseIntercept, me: { ...me }, enemy: { ...enemy }, myBase: { ...myBase } };
    assert.equal(twoTurnInterceptDelta(opts), firstI);
  }
  assert.equal(microPerf.interceptMs, interceptMs);

  const baseEject = {
    me,
    enemy,
    target: { x: 800, y: 0 },
    myBase,
    stunRange: STUN,
    canStunEnemy: true,
  } as const;
  const firstE = twoTurnEjectDelta({
    ...baseEject,
    me: { ...me },
    enemy: { ...enemy },
    target: { x: 800, y: 0 },
    myBase: { ...myBase },
  });
  const ejectMs = microPerf.ejectMs;
  for (let i = 0; i < 5; i++) {
    const opts = {
      ...baseEject,
      me: { ...me },
      enemy: { ...enemy },
      target: { x: 800, y: 0 },
      myBase: { ...myBase },
    };
    assert.equal(twoTurnEjectDelta(opts), firstE);
  }
  assert.equal(microPerf.ejectMs, ejectMs);

  assert.ok(!microOverBudget());
});

test('micro rollouts stop when over budget', () => {
  const me = { id: 1, x: 0, y: 0 };
  const enemy = { id: 2, x: 3000, y: 0 };
  const ghost = { x: 1000, y: 0 };
  const myBase = { x: 0, y: 0 };
  microPerf.twoTurnMs = MICRO_BUDGET_MS;
  assert.equal(
    twoTurnContestDelta({
      me,
      enemy,
      ghost,
      bustMin: BUST_MIN,
      bustMax: BUST_MAX,
      stunRange: STUN,
      canStunMe: true,
      canStunEnemy: true,
    }),
    0
  );
  assert.equal(
    twoTurnInterceptDelta({
      me,
      enemy,
      myBase,
      stunRange: STUN,
      canStunMe: true,
      canStunEnemy: true,
    }),
    0
  );
  assert.equal(
    twoTurnEjectDelta({
      me,
      enemy,
      target: { x: 800, y: 0 },
      myBase,
      stunRange: STUN,
      canStunEnemy: true,
    }),
    0
  );
});
