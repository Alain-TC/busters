import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildObs } from './cg-adapter';

// Unit test verifying enemy carriers and stunned enemies recognized by buildObs

test('buildObs marks enemy carriers and stunned enemies', () => {
  const me = { id: 0, x: 1000, y: 1000, state: 0, value: 0 };
  const opp = [
    { id: 1, x: 2000, y: 2000, state: 1, value: 5 }, // carrying ghost id 5
    { id: 2, x: 3000, y: 3000, state: 2, value: 3 }, // stunned for 3 ticks
  ];
  const ghosts: any[] = [];

  const obs = buildObs(me, opp, ghosts, 0);

  const carrier = obs.enemies.find((e: any) => e.id === 1);
  assert.equal(carrier.carrying, 5);

  const stunned = obs.enemies.find((e: any) => e.id === 2);
  assert.equal(stunned.stunnedFor, 3);
});
