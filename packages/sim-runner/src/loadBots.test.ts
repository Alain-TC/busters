import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { resolveSpec } from './loadBots';

test('resolveSpec maps hof tokens to champion paths', () => {
  const spec = resolveSpec('hof:abc123');
  const expected = path.resolve(process.cwd(), '../agents/hof/abc123.js');
  assert.equal(spec, expected);
});
