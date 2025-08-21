import { test } from 'node:test';
import assert from 'node:assert/strict';
import { act, __mem, __pMem } from './hybrid-bot';
import { HybridState } from './lib/state';

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

test('ghost probability map decays and updates', () => {
  const spawns = [{ x: 100, y: 100 }];
  const st = new HybridState({ w: 400, h: 400 }, 2, 2, undefined, spawns, 0.5);

  let top = st.topGhostCells(1)[0];
  assert.ok(top.prob > 0);
  const initial = top.prob;

  st.decayGhosts();
  top = st.topGhostCells(1)[0];
  assert.ok(top.prob < initial);

  st.updateGhosts([{ x: 100, y: 100 }]);
  top = st.topGhostCells(1)[0];
  assert.equal(top.prob, 1);

  st.updateGhosts([], [{ x: 100, y: 100 }]);
  const probAfterCapture = st.ghostProbAt({ x: 100, y: 100 });
  assert.equal(probAfterCapture, 0);
});
