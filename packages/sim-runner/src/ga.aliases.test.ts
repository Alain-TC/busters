import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidates } from './ga';
import { BOT_ALIASES } from './loadBots';

test('buildCandidates resolves bot aliases', () => {
  const cands = buildCandidates([
    { name: 'base-camper' },
    { name: 'aggressive-stunner' },
  ], []);
  const specs = cands.filter(c => c.type === 'module').map(c => c.spec);
  assert(specs.includes(BOT_ALIASES['base-camper']));
  assert(specs.includes(BOT_ALIASES['aggressive-stunner']));
});
