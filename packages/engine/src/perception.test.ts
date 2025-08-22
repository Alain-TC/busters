import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame } from './engine';
import { observationsForTeam, entitiesForTeam } from './perception';
import { RULES } from '@busters/shared';

test('radar vision reveals distant entities', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const me = state.busters.find(b => b.teamId === 0)!;
  const enemy = state.busters.find(b => b.teamId === 1)!;
  const ghost = state.ghosts[0];

  me.x = 0; me.y = 0;
  enemy.x = RULES.VISION + 100; enemy.y = 0;
  ghost.x = RULES.VISION + 100; ghost.y = 0;

  let obs = observationsForTeam(state, 0)[0];
  assert.equal(obs.ghostsVisible.length, 0);
  assert.equal(obs.enemies.length, 0);

  state.radarNextVision[me.id] = true;
  obs = observationsForTeam(state, 0)[0];
  assert.equal(obs.ghostsVisible.length, 1);
  assert.equal(obs.ghostsVisible[0].id, ghost.id);
  assert.equal(obs.enemies.length, 1);
  assert.equal(obs.enemies[0].id, enemy.id);
});

test('entity list includes radar-detected units', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const me = state.busters.find(b => b.teamId === 0)!;
  const enemy = state.busters.find(b => b.teamId === 1)!;
  const ghost = state.ghosts[0];

  me.x = 0; me.y = 0;
  enemy.x = RULES.VISION + 100; enemy.y = 0;
  ghost.x = RULES.VISION + 100; ghost.y = 0;

  let list = entitiesForTeam(state, 0);
  // only own buster visible
  assert.equal(list.length, 1);

  state.radarNextVision[me.id] = true;
  list = entitiesForTeam(state, 0);
  const ids = list.map(e => e.id);
  assert.equal(list.length, 3);
  assert(ids.includes(me.id));
  assert(ids.includes(enemy.id));
  assert(ids.includes(ghost.id));
});

test('entities are returned sorted by id', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const me = state.busters.find(b => b.teamId === 0)!;
  const enemy = state.busters.find(b => b.teamId === 1)!;
  const ghost = state.ghosts[0];

  // Place all entities within vision so they appear in the list
  me.x = 0; me.y = 0;
  enemy.x = 0; enemy.y = 0;
  ghost.x = 0; ghost.y = 0;

  const list = entitiesForTeam(state, 0);
  assert.equal(list.length, 3);
  const ids = list.map(e => e.id);
  const sorted = [...ids].sort((a, b) => a - b);
  assert.deepEqual(ids, sorted);
});

test('enemy stun cooldown is hidden', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  const me = state.busters.find(b => b.teamId === 0)!;
  const enemy = state.busters.find(b => b.teamId === 1)!;

  // Ensure both busters see each other
  me.x = 0; me.y = 0;
  enemy.x = 0; enemy.y = 0;

  me.stunCd = 5;
  enemy.stunCd = 7;

  // Neither buster is carrying, stunned or busting
  me.state = 0;
  enemy.state = 0;

  const list = entitiesForTeam(state, 0);
  const myEntity = list.find(e => e.id === me.id)!;
  const enemyEntity = list.find(e => e.id === enemy.id)!;

  assert.equal(myEntity.value, 5);
  assert.equal(enemyEntity.value, 0);
});

test('ranges in observations are actual distances', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 2, ghostCount: 1 });
  const me = state.busters.find(b => b.teamId === 0)!;
  const ally = state.busters.find(b => b.teamId === 0 && b.id !== me.id)!;
  const ghost = state.ghosts[0];

  me.x = 0; me.y = 0;
  ally.x = 3; ally.y = 4; // distance 5
  ghost.x = 6; ghost.y = 8; // distance 10

  const obs = observationsForTeam(state, 0)[0];
  assert.equal(obs.allies[0].range, 5);
  assert.equal(obs.ghostsVisible[0].range, 10);
});
