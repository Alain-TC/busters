import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldContinue } from './cg-driver';
import { GameState } from '@busters/shared';

test('shouldContinue returns false when no ghosts and no buster carrying', () => {
  const state: GameState = {
    seed: 1,
    tick: 0,
    width: 0,
    height: 0,
    bustersPerPlayer: 1,
    ghostCount: 0,
    scores: { 0: 0, 1: 0 },
    busters: [{ id: 0, teamId: 0, x: 0, y: 0, state: 0, value: 0, stunCd: 0, radarUsed: false }],
    ghosts: [],
    radarNextVision: {},
    lastSeenTickForGhost: {}
  };
  assert.equal(shouldContinue(state), false);
});

test('shouldContinue returns true when ghosts remain', () => {
  const state: GameState = {
    seed: 1,
    tick: 0,
    width: 0,
    height: 0,
    bustersPerPlayer: 1,
    ghostCount: 1,
    scores: { 0: 0, 1: 0 },
    busters: [{ id: 0, teamId: 0, x: 0, y: 0, state: 0, value: 0, stunCd: 0, radarUsed: false }],
    ghosts: [{ id: 0, x: 0, y: 0, endurance: 0, engagedBy: 0 }],
    radarNextVision: {},
    lastSeenTickForGhost: {}
  };
  assert.equal(shouldContinue(state), true);
});

test('shouldContinue returns true when a buster is carrying', () => {
  const state: GameState = {
    seed: 1,
    tick: 0,
    width: 0,
    height: 0,
    bustersPerPlayer: 1,
    ghostCount: 0,
    scores: { 0: 0, 1: 0 },
    busters: [{ id: 0, teamId: 0, x: 0, y: 0, state: 1, value: 0, stunCd: 0, radarUsed: false }],
    ghosts: [],
    radarNextVision: {},
    lastSeenTickForGhost: {}
  };
  assert.equal(shouldContinue(state), true);
});
