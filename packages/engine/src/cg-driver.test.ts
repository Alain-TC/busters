import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveGameConfig } from './cg-driver';

test('resolveGameConfig prefers CLI args over env vars', () => {
  const env = { SEED: '5', BUSTERS_PER_PLAYER: '1', GHOST_COUNT: '2' } as any;
  const cfg = resolveGameConfig(['10', '3', '6'], env);
  assert.deepEqual(cfg, { seed: 10, bustersPerPlayer: 3, ghostCount: 6 });
});

test('resolveGameConfig falls back to env vars', () => {
  const env = { SEED: '7', BUSTERS_PER_PLAYER: '2', GHOST_COUNT: '5' } as any;
  const cfg = resolveGameConfig([], env);
  assert.deepEqual(cfg, { seed: 7, bustersPerPlayer: 2, ghostCount: 5 });
});

test('resolveGameConfig uses defaults when missing', () => {
  const cfg = resolveGameConfig([], {} as any);
  assert.deepEqual(cfg, { seed: 1, bustersPerPlayer: 2, ghostCount: 4 });
});

