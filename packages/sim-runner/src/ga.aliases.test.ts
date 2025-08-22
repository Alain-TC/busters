import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates } from './ga';
import { BOT_ALIASES } from './loadBots';

test('buildCandidates resolves bot aliases', () => {
  const cands = buildCandidates([{ name: 'greedy,random' }], []);
  const specs = cands.filter(c => c.type === 'module').map(c => (c as any).spec);
  assert(specs.includes(BOT_ALIASES.greedy));
  assert(specs.includes(BOT_ALIASES.random));
});
