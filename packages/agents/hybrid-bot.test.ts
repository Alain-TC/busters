import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, __mem, __pMem, __runAuction, __scoreAssign, __buildTasks, __fog, buildPlan, executePlan, resetHybridMemory, serializeHybridMemory, loadHybridMemory } from './hybrid-bot';
import { HybridState } from './lib/state';
import { Fog } from './fog';
import { hungarian } from './hungarian';
import { TUNE } from './hybrid-params';

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

test('mem entries removed when busters disappear', () => {
  const ctx: any = {};
  const obs1: any = { tick: 0, self: { id: 1, x: 0, y: 0, state: 0 }, friends: [{ id: 2, x: 0, y: 0, state: 0 }], enemies: [], ghostsVisible: [] };
  act(ctx, obs1);
  const obs2: any = { tick: 0, self: { id: 2, x: 0, y: 0, state: 0 }, friends: [{ id: 1, x: 0, y: 0, state: 0 }], enemies: [], ghostsVisible: [] };
  act(ctx, obs2);
  assert.ok(__mem.has(1) && __mem.has(2));

  // only buster 1 acts on tick 1
  const obs3: any = { tick: 1, self: { id: 1, x: 0, y: 0, state: 0 }, friends: [], enemies: [], ghostsVisible: [] };
  act(ctx, obs3);
  assert.ok(__mem.has(1) && __mem.has(2));

  // next tick triggers cleanup for missing buster
  const obs4: any = { tick: 2, self: { id: 1, x: 0, y: 0, state: 0 }, friends: [], enemies: [], ghostsVisible: [] };
  act(ctx, obs4);
  assert.ok(__mem.has(1));
  assert.ok(!__mem.has(2));
});

test('memory can be serialized, reset, and restored', () => {
  resetHybridMemory();
  const ctx: any = {};
  const obs: any = { tick: 0, self: { id: 1, x: 0, y: 0, state: 0 }, friends: [], enemies: [], ghostsVisible: [] };
  act(ctx, obs);
  __pMem.set(5, { wp: 1 });
  const snap = serializeHybridMemory();
  assert.ok(snap.mem.some(([id]) => id === 1));
  assert.ok(snap.pMem.some(([id]) => id === 5));

  resetHybridMemory();
  assert.equal(__mem.size, 0);
  assert.equal(__pMem.size, 0);

  loadHybridMemory(snap);
  assert.ok(__mem.has(1));
  assert.ok(__pMem.has(5));
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

test('runAuction respects HUNGARIAN_MAX_COMBOS override', async () => {
  process.env.HUNGARIAN_MAX_COMBOS = '50';
  const mod = await import('./hybrid-bot.ts?override');
  const { __runAuction, HUNGARIAN_MAX_COMBOS } = mod;
  const { HybridState } = await import('./lib/state.ts');
  assert.equal(HUNGARIAN_MAX_COMBOS, 50);
  const team = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, x: i * 100, y: 0 }));
  const tasks = Array.from({ length: 7 }, (_, i) => ({ type: 'EXPLORE', target: { x: i * 100, y: 0 }, baseScore: 100 }));
  const enemies: any[] = [];
  const MY = { x: 0, y: 0 };
  const tick = 0;
  const st = new HybridState();
  st.updateRoles(team as any);
  const assigned = __runAuction(team as any, tasks as any, enemies, MY, tick, st);
  assert.equal(assigned.size, tasks.length);
  assert.ok(!assigned.has(team[7].id));
  delete process.env.HUNGARIAN_MAX_COMBOS;
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

test('stun cooldown enforced when stunCd missing', () => {
  __mem.clear();
  const ctx: any = {};
  const self = { id: 1, x: 0, y: 0, state: 0 };
  let obs: any = { tick: 0, self, friends: [], enemies: [{ id: 2, x: 0, y: 0, state: 0, range: 0, stunnedFor: 0 }], ghostsVisible: [] };
  let action = act(ctx, obs);
  assert.equal(action.type, 'STUN');

  obs = { tick: 10, self, friends: [], enemies: [{ id: 2, x: 0, y: 0, state: 0, range: 0, stunnedFor: 0 }], ghostsVisible: [] };
  action = act(ctx, obs);
  assert.notEqual(action.type, 'STUN');

  obs = { tick: 21, self, friends: [], enemies: [{ id: 2, x: 0, y: 0, state: 0, range: 0, stunnedFor: 0 }], ghostsVisible: [] };
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

test('scoreAssign ignores distant enemies for bust tasks', () => {
  __mem.clear();
  const b: any = { id: 1, x: 0, y: 0 };
  const task: any = { type: 'BUST', target: { x: 0, y: 0 }, payload: { ghostId: 1 }, baseScore: 0 };
  const farEnemy: any = { id: 2, x: 10000, y: 10000 };
  const MY = { x: 0, y: 0 };
  const st = new HybridState();
  st.updateRoles([b]);
  const s1 = __scoreAssign(b, task, [], MY, 0, st);
  const s2 = __scoreAssign(b, task, [farEnemy], MY, 0, st);
  assert.equal(s1, s2);
});

test('drops bust when assigned ghost disappears', () => {
  __mem.clear();
  const ctx: any = { tick: 0, myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } };
  const b1: any = { id: 1, x: 0, y: 0, state: 0 };
  const b2: any = { id: 2, x: 5000, y: 0, state: 0 };
  const g1 = { id: 1, x: 5200, y: 0, range: 200 };
  const obs1: any = { tick: 0, self: b1, friends: [b2], enemies: [], ghostsVisible: [g1] };
  const state = new HybridState();
  state.updateRoles([b1, b2]);
  buildPlan({ ctx, obs: obs1, state, friends: [b1, b2], enemiesAll: [], MY: ctx.myBase, EN: ctx.enemyBase, tick: 0 });

  // b2 executes plan; assigned ghost g1 disappeared and g2 is visible
  const g2 = { id: 2, x: 6000, y: 0, range: 1000 };
  const action = executePlan({
    me: b2,
    friends: [b1],
    enemies: [],
    enemiesAll: [],
    ghosts: [g2],
    carrying: false,
    canStun: false,
    MY: ctx.myBase,
  });
  assert.equal(action.type, 'MOVE');
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

test('releases when carrying inside base radius', () => {
  __mem.clear();
  const ctx: any = { myBase: { x: 0, y: 0 } };
  act(ctx, { tick: 0, self: { id: 99, x: 0, y: 0, state: 0 }, friends: [], enemies: [], ghostsVisible: [] });
  const self = { id: 1, x: 1000, y: 1000, state: 1, stunCd: 5 };
  const obs: any = { tick: 20, self, friends: [], enemies: [], ghostsVisible: [] };
  const actRes = act(ctx, obs);
  assert.equal(actRes.type, 'RELEASE');
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

test('scheduled RADAR activates at RADAR1_TURN and RADAR2_TURN', () => {
  __mem.clear();
  const ctx1: any = { tick: TUNE.RADAR1_TURN };
  const b1: any = { id: 1, x: 0, y: 0, state: 0, localIndex: 0 };
  const obs1: any = { tick: TUNE.RADAR1_TURN, self: b1, friends: [], enemies: [], ghostsVisible: [] };
  const act1 = act(ctx1, obs1);
  assert.equal(act1.type, 'RADAR');

  __mem.clear();
  const ctx2: any = { tick: TUNE.RADAR2_TURN };
  const b2: any = { id: 2, x: 0, y: 0, state: 0, localIndex: 1 };
  const obs2: any = { tick: TUNE.RADAR2_TURN, self: b2, friends: [], enemies: [], ghostsVisible: [] };
  const act2 = act(ctx2, obs2);
  assert.equal(act2.type, 'RADAR');
});

test('BLOCK tasks redirect to INTERCEPT when a carrier appears', () => {
  const ctx: any = { tick: 0, myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } };
  const self: any = { id: 1, x: 1000, y: 1000, state: 0 };
  const obs: any = { tick: 0, self, friends: [], enemies: [], ghostsVisible: [] };
  const st = new HybridState();
  st.updateRoles([self]);
  let tasks = __buildTasks(ctx, obs, st, ctx.myBase, ctx.enemyBase);
  assert.ok(tasks.some(t => t.type === 'BLOCK'));

  const carrier: any = { id: 2, x: 8000, y: 4500, state: 1 };
  const obs2: any = { tick: 1, self, friends: [], enemies: [carrier], ghostsVisible: [] };
  tasks = __buildTasks({ ...ctx, tick: 1 }, obs2, st, ctx.myBase, ctx.enemyBase);
  assert.ok(!tasks.some(t => t.type === 'BLOCK'));
  assert.ok(tasks.some(t => t.type === 'INTERCEPT' && t.payload?.enemyId === 2));
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
