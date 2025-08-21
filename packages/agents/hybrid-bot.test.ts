import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, __mem, __pMem, __runAuction, __scoreAssign } from './hybrid-bot';
import { HybridState } from './lib/state';
import { Fog } from './fog';
import { hungarian } from './hungarian';

test('mem resets on new match and repopulates', () => {
  // pre-populate with stale entry
  __mem.set(99, { stunReadyAt: 5, radarUsed: true, wp: 1 });

  const ctx: any = {};
  const baseObs: any = { tick: 0, self: { id: 1, x: 0, y: 0, state: 0 }, friends: [], enemies: [], ghostsVisible: [] };
  act(ctx, baseObs);
  assert.ok(!__mem.has(99));
  assert.ok(__mem.has(1));

  const nextObs: any = { tick: 2, self: { id: 2, x: 0, y: 0, state: 0 }, friends: [], enemies: [], ghostsVisible: [] };
  act(ctx, nextObs);
  assert.ok(__mem.has(1) && __mem.has(2));
});

test('patrol indices reset on new match', () => {
  // seed patrol memory with stale waypoint
  __pMem.set(1, { wp: 3 });
  __pMem.set(99, { wp: 2 });

  const ctx: any = {};
  const obs: any = { tick: 0, self: { id: 1, x: 0, y: 0, state: 0 }, friends: [], enemies: [], ghostsVisible: [] };
  act(ctx, obs);

  // old entries cleared and waypoint reset to zero
  assert.equal(__pMem.get(1)?.wp, 0);
  assert.ok(!__pMem.has(99));
});

test('ghost probability map normalizes, diffuses, and clears seen areas', () => {
  const spawns = [{ x: 100, y: 100 }];
  const st = new HybridState({ w: 400, h: 400 }, 2, 2, undefined, spawns, 1);

  st.diffuseGhosts();
  const sum1 = st.ghostProb.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum1 - 1) < 1e-6);
  // diffusion spreads mass to neighbors
  assert.ok(st.ghostProb.slice(1).some(v => v > 0));

  const before = st.ghostProb[0];
  st.subtractSeen({ x: 100, y: 100 }, 200);
  assert.ok(st.ghostProb[0] < before);
  const sum2 = st.ghostProb.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum2 - 1) < 1e-6);
});

test('fog heat diffuses, normalizes, and reduces when visited', () => {
  const f = new Fog();
  f.bumpGhost(8000, 4500);
  f.beginTick(1);
  const total = Array.from((f as any).heat).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1) < 1e-6);
  const idx = (f as any).idxOf(8000, 4500);
  const before = (f as any).heat[idx];
  f.markVisited({ x: 8000, y: 4500 });
  const after = (f as any).heat[idx];
  assert.ok(after < before);
});

test('runAuction aligns with Hungarian optimal assignment', () => {
  const team = [
    { id: 1, x: 0, y: 0 },
    { id: 2, x: 3000, y: 0 },
  ];
  const tasks = [
    { type: 'EXPLORE', target: { x: 1000, y: 0 }, baseScore: 4 },
    { type: 'EXPLORE', target: { x: 3500, y: 0 }, baseScore: 4 },
    { type: 'EXPLORE', target: { x: 2000, y: 0 }, baseScore: 4 },
  ];
  const enemies: any[] = [];
  const MY = { x: 0, y: 0 };
  const tick = 0;

  const cost = team.map(b => tasks.map(t => -__scoreAssign(b as any, t as any, enemies, MY, tick)));
  const expected = hungarian(cost);
  const assigned = __runAuction(team as any, tasks as any, enemies, MY, tick);
  for (let i = 0; i < team.length; i++) {
    const tIdx = expected[i];
    if (tIdx >= 0) {
      assert.strictEqual(assigned.get(team[i].id), tasks[tIdx]);
    } else {
      assert.ok(!assigned.has(team[i].id));
    }
  }
});

test('bot does not stun an already stunned enemy', () => {
  __mem.clear();
  const ctx: any = {};
  const self = { id: 1, x: 0, y: 0, state: 0 };
  let obs: any = { tick: 0, self, friends: [], enemies: [{ id: 2, x: 0, y: 0, state: 0, range: 0, stunnedFor: 0 }], ghostsVisible: [] };
  let action = act(ctx, obs);
  assert.equal(action.type, 'STUN');

  obs = { tick: 21, self, friends: [], enemies: [{ id: 2, x: 0, y: 0, state: 2, range: 0, stunnedFor: 5 }], ghostsVisible: [] };
  action = act(ctx, obs);
  assert.notEqual(action.type, 'STUN');

  obs = { tick: 22, self, friends: [], enemies: [{ id: 2, x: 0, y: 0, state: 0, range: 0, stunnedFor: 0 }], ghostsVisible: [] };
  action = act(ctx, obs);
  assert.equal(action.type, 'STUN');
});

test('scoreAssign rewards ready stuns for SUPPORT tasks', () => {
  __mem.clear();
  const b: any = { id: 1, x: 0, y: 0 };
  const task: any = { type: 'SUPPORT', target: { x: 0, y: 0 }, payload: { allyIds: [2] }, baseScore: 0 };
  const enemies: any[] = [{ id: 3, x: 0, y: 0 }];
  const MY = { x: 0, y: 0 };
  let s1 = __scoreAssign(b, task, enemies, MY, 0);
  __mem.get(1)!.stunReadyAt = 5;
  let s2 = __scoreAssign(b, task, enemies, MY, 0);
  assert.ok(s1 > s2);
});
