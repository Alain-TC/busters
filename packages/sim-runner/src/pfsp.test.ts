import test from 'node:test';
import assert from 'node:assert/strict';

import { selectOpponentsPFSP } from './pfsp';
import { EloTable, updateElo } from './elo';
import { mulberry32 } from '@busters/shared';

test('selectOpponentsPFSP picks opponent closest to target win rate', () => {
  const elo: EloTable = { me: 1000, weak: 900, strong: 1100 };
  const picks = selectOpponentsPFSP({
    meId: 'me',
    candidates: ['weak', 'strong'],
    elo,
    n: 1,
    target: 0.75,
    temperature: 1e-6,
    rng: () => 0,
  });
  assert.equal(picks.length, 1);
  assert.equal(picks[0].id, 'weak');
});

test('selectOpponentsPFSP is reproducible with fixed rng', () => {
  const elo: EloTable = { me: 1000, a: 950, b: 1050, c: 1020 };
  const rng1 = mulberry32(123);
  const rng2 = mulberry32(123);
  const picks1 = selectOpponentsPFSP({ meId: 'me', candidates: ['a', 'b', 'c'], elo, n: 2, rng: rng1 });
  const picks2 = selectOpponentsPFSP({ meId: 'me', candidates: ['a', 'b', 'c'], elo, n: 2, rng: rng2 });
  assert.deepEqual(picks1, picks2);
});

test('updateElo adjusts ratings after a win', () => {
  const tbl: EloTable = { a: 1000, b: 1000 };
  updateElo(tbl, 'a', 'b', 1);
  assert.equal(tbl.a, 1016);
  assert.equal(tbl.b, 984);
});

