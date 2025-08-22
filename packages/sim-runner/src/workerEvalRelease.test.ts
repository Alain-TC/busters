import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genomeToBot } from './workerEval';

test('carrier at base radius keeps moving toward base', () => {
  const bot = genomeToBot({ radarTurn: 0, stunRange: 0, releaseDist: 1700 });
  const ctx = { myBase: { x: 0, y: 0 } } as any;
  const obs = { self: { x: 1600, y: 0, carrying: 0, stunCd: 0 }, enemies: [], ghostsVisible: [], tick: 0 } as any;
  const action = bot.act(ctx, obs);
  assert.equal(action.type, 'MOVE');
});
