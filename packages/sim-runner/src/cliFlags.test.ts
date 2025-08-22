import test from 'node:test';
import assert from 'node:assert/strict';
import { getFlag } from './cli';

test('getFlag returns provided value when flag has a value', () => {
  const args = ['--foo', 'bar'];
  assert.equal(getFlag(args, 'foo'), 'bar');
});

test('getFlag returns default when value is missing', () => {
  const args = ['--foo'];
  assert.equal(getFlag(args, 'foo', 'baz'), 'baz');
});

test('getFlag returns undefined when value is missing and no default', () => {
  const args = ['--foo'];
  assert.equal(getFlag(args, 'foo'), undefined);
});
