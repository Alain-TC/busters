import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveOppPool } from './cli';

async function getNames(tokens: string[]) {
  const res = await resolveOppPool(tokens);
  return res.map(r => r.bot.meta?.name);
}

test('resolveOppPool loads base-camper', async () => {
  const names = await getNames(['base-camper']);
  assert.deepEqual(names, ['base-camper']);
});

test('resolveOppPool loads aggressive-stunner', async () => {
  const names = await getNames(['aggressive-stunner']);
  assert.deepEqual(names, ['aggressive-stunner']);
});
