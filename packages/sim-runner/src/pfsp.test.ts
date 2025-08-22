import test from 'node:test';
import assert from 'node:assert/strict';

import { selectOpponentsPFSP } from './pfsp';
import { EloTable, updateElo } from './elo';

test('selectOpponentsPFSP picks opponent closest to target win rate', () => {
  const elo: EloTable = { me: 1000, weak: 900, strong: 1100 };
  const origRandom = Math.random;
  Math.random = () => 0; // deterministic sampling
  const picks = selectOpponentsPFSP({
    meId: 'me',
    candidates: ['weak', 'strong'],
    elo,
    n: 1,
    target: 0.75,
    temperature: 1e-6,
  });
  Math.random = origRandom;
  assert.equal(picks.length, 1);
  assert.equal(picks[0].id, 'weak');
});

test('updateElo adjusts ratings after a win', () => {
  const tbl: EloTable = { a: 1000, b: 1000 };
  updateElo(tbl, 'a', 'b', 1);
  assert.equal(tbl.a, 1016);
  assert.equal(tbl.b, 984);
});

