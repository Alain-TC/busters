import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame } from './engine';
import { observationsForTeam } from './perception';
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
