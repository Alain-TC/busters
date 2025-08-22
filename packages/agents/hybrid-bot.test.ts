import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, __mem, __pMem, __runAuction, __scoreAssign, __buildTasks, __fog } from './hybrid-bot';
import { HybridState } from './lib/state';
import { Fog } from './fog';
import { hungarian } from './hungarian';

test('mem resets on new match and repopulates', () => {
  // pre-populate with stale entry
  __mem.set(99, { stunReadyAt: 5, radarUsed: true });

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

test('explore task score increases with fog heat', () => {
  __fog.reset();
  __fog.beginTick(10);
  const ctx: any = { tick: 10, myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } };
  const self: any = { id: 1, x: 0, y: 0, state: 0 };
  const obs: any = { tick: 10, self, friends: [], enemies: [], ghostsVisible: [] };
  const st = new HybridState();
  st.updateRoles([self]);
  let tasks = __buildTasks(ctx, obs, st, ctx.myBase, ctx.enemyBase);
  const t1 = tasks.find(t => t.type === 'EXPLORE' && t.payload?.id === 1)!;
  const base1 = t1.baseScore;
  __fog.bumpGhost(t1.target.x, t1.target.y);
  tasks = __buildTasks(ctx, obs, st, ctx.myBase, ctx.enemyBase);
  const t2 = tasks.find(t => t.type === 'EXPLORE' && t.payload?.id === 1)!;
  const base2 = t2.baseScore;
  assert.ok(base2 > base1);
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

  const st = new HybridState();
  st.updateRoles(team as any);
  const cost = team.map(b => tasks.map(t => -__scoreAssign(b as any, t as any, enemies, MY, tick, st)));
  const expected = hungarian(cost);
  const assigned = __runAuction(team as any, tasks as any, enemies, MY, tick, st);
  for (let i = 0; i < team.length; i++) {
    const tIdx = expected[i];
    if (tIdx >= 0) {
      assert.strictEqual(assigned.get(team[i].id), tasks[tIdx]);
    } else {
      assert.ok(!assigned.has(team[i].id));
    }
  }
});

test('runAuction uses greedy assignment when combinations exceed 100', () => {
  const team = Array.from({ length: 11 }, (_, i) => ({ id: i + 1, x: i * 100, y: 0 }));
  const tasks = Array.from({ length: 10 }, (_, i) => ({ type: 'EXPLORE', target: { x: i * 100, y: 0 }, baseScore: 100 }));
  const enemies: any[] = [];
  const MY = { x: 0, y: 0 };
  const tick = 0;

  const st = new HybridState();
  st.updateRoles(team as any);
  const assigned = __runAuction(team as any, tasks as any, enemies, MY, tick, st);
  assert.equal(assigned.size, tasks.length);
  for (let i = 0; i < tasks.length; i++) {
    assert.strictEqual(assigned.get(team[i].id), tasks[i]);
  }
  assert.ok(!assigned.has(team[10].id));
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
  const st = new HybridState();
  st.updateRoles([b]);
  let s1 = __scoreAssign(b, task, enemies, MY, 0, st);
  __mem.get(1)!.stunReadyAt = 5;
  let s2 = __scoreAssign(b, task, enemies, MY, 0, st);
  assert.ok(s1 > s2);
});

test('ejects when threatened and stun on cooldown', () => {
  __mem.clear();
  const ctx: any = { myBase: { x: 0, y: 0 } };
  const self = { id: 1, x: 4000, y: 4000, state: 1, stunCd: 5 };
  const enemy = { id: 2, x: 4200, y: 4000, state: 0, range: 200, stunnedFor: 0 };
  const obs: any = { tick: 10, self, friends: [], enemies: [enemy], ghostsVisible: [] };
  const actRes = act(ctx, obs);
  assert.equal(actRes.type, 'EJECT');
});

test('ejects to closer ally when safe', () => {
  __mem.clear();
  const ctx: any = { myBase: { x: 0, y: 0 } };
  const self = { id: 1, x: 6000, y: 6000, state: 1, stunCd: 10 };
  const ally = { id: 3, x: 5000, y: 5000, state: 0 };
  const obs: any = { tick: 5, self, friends: [ally], enemies: [], ghostsVisible: [] };
  const actRes = act(ctx, obs);
  assert.equal(actRes.type, 'EJECT');
});

test('does not eject when stun ready', () => {
  __mem.clear();
  const ctx: any = { myBase: { x: 0, y: 0 } };
  const self = { id: 1, x: 4000, y: 4000, state: 1, stunCd: 0 };
  const enemy = { id: 2, x: 4200, y: 4000, state: 0, range: 200, stunnedFor: 0 };
  const obs: any = { tick: 10, self, friends: [], enemies: [enemy], ghostsVisible: [] };
  const actRes = act(ctx, obs);
  assert.notEqual(actRes.type, 'EJECT');
});

test('buildTasks emits carry tasks for carriers', () => {
  const ctx: any = { tick: 0, myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } };
  const self: any = { id: 1, x: 1000, y: 1000, state: 1 };
  const obs: any = { tick: 0, self, friends: [], enemies: [], ghostsVisible: [] };
  const st = new HybridState();
  st.updateRoles([self]);
  const tasks = __buildTasks(ctx, obs, st, ctx.myBase, ctx.enemyBase);
  assert.ok(tasks.some(t => t.type === 'CARRY' && t.payload?.id === 1));
});

test('carrier can switch to higher-scoring task', () => {
  const ctx: any = { tick: 0, myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } };
  const self: any = { id: 1, x: 1000, y: 1000, state: 1, carrying: 4 };
  const obs: any = { tick: 0, self, friends: [], enemies: [], ghostsVisible: [] };
  const st = new HybridState();
  st.updateRoles([self]);
  const tasks = __buildTasks(ctx, obs, st, ctx.myBase, ctx.enemyBase);
  tasks.push({ type: 'DEFEND', target: { x: 500, y: 500 }, payload: {}, baseScore: 100 });
  const assigned = __runAuction([self], tasks as any, [], ctx.myBase, 0, st);
  const myTask = assigned.get(1)!;
  assert.equal(myTask.type, 'DEFEND');
});

test('buildTasks uses predicted path for unseen carriers', () => {
  const ctx: any = { tick: 3, myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } };
  const self: any = { id: 1, x: 0, y: 0, state: 0 };
  const obs: any = { tick: 3, self, friends: [], enemies: [], ghostsVisible: [] };
  const st = new HybridState();
  st.trackEnemies([{ id: 2, x: 2600, y: 1000, carrying: 1 }], 1);
  st.trackEnemies([{ id: 2, x: 1800, y: 1000, carrying: 1 }], 2);
  st.updateRoles([self]);
  const tasks = __buildTasks(ctx, obs, st, ctx.myBase, ctx.enemyBase);
  const intercepts = tasks.filter(t => t.type === 'INTERCEPT' && t.payload?.enemyId === 2);
  assert.ok(intercepts.some(t => t.target.x === 500 && t.target.y === 500));
  assert.ok(intercepts.length >= 2);
});

test('buildTasks skips SUPPORT for enemies stunned for several ticks', () => {
  __mem.clear();
  const ctx: any = { tick: 0, myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } };
  const self: any = { id: 1, x: 0, y: 0, state: 0 };
  const enemy: any = { id: 2, x: 0, y: 0, state: 0, range: 0 };
  const st = new HybridState();
  st.updateRoles([self]);
  let tasks = __buildTasks(ctx, { tick: 0, self, friends: [], enemies: [enemy], ghostsVisible: [] }, st, ctx.myBase, ctx.enemyBase);
  assert.ok(tasks.some(t => t.type === 'SUPPORT' && t.payload?.enemyId === 2));

  const stunned: any = { id: 2, x: 0, y: 0, state: 2, range: 0, stunnedFor: 5 };
  tasks = __buildTasks(ctx, { tick: 0, self, friends: [], enemies: [stunned], ghostsVisible: [] }, st, ctx.myBase, ctx.enemyBase);
  assert.ok(!tasks.some(t => t.type === 'SUPPORT' && t.payload?.enemyId === 2));
});
