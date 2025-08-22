import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOppPool } from './cli';

test('resolveOppPool loads bots by alias', async () => {
  const opps = await resolveOppPool(['greedy', 'random']);
  assert.equal(opps.length, 2);
  assert.equal(typeof opps[0].bot.act, 'function');
  assert.equal(typeof opps[1].bot.act, 'function');
});
