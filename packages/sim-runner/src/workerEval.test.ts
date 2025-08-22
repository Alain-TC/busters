import { test } from 'node:test';
import assert from 'node:assert/strict';
import { genomeToBot } from './workerEval';

// Confirm STUN cooldown is tracked when obs.self.stunCd is undefined
// and prevents repeated STUN actions until the cooldown expires.
test('tracks stun cooldown when obs.self.stunCd is missing', () => {
  const bot = genomeToBot({ radarTurn: 999, stunRange: 1760, releaseDist: 1600 });
  const ctx = { myBase: { x: 0, y: 0 } } as any;
  const mkObs = (tick: number) => ({
    tick,
    self: { id: 1, x: 0, y: 0, radarUsed: true },
    enemies: [{ id: 2, range: 1000 }],
    ghostsVisible: [],
  }) as any;

  const first = bot.act(ctx, mkObs(0));
  assert.equal(first.type, 'STUN');

  for (let t = 1; t < 20; t++) {
    const act = bot.act(ctx, mkObs(t));
    assert.notEqual(act.type, 'STUN', `tick ${t}`);
  }

  const after = bot.act(ctx, mkObs(20));
  assert.equal(after.type, 'STUN');
});

test('stun cooldown resets between episodes', () => {
  const bot = genomeToBot({ radarTurn: 999, stunRange: 1760, releaseDist: 1600 });
  const ctx = { myBase: { x: 0, y: 0 } } as any;
  const mkObs = (tick: number) => ({
    tick,
    self: { id: 1, x: 0, y: 0, radarUsed: true },
    enemies: [{ id: 2, range: 1000 }],
    ghostsVisible: [],
  }) as any;

  const first = bot.act(ctx, mkObs(0));
  assert.equal(first.type, 'STUN');

  const next = bot.act(ctx, mkObs(1));
  assert.notEqual(next.type, 'STUN');

  const episode2 = bot.act(ctx, mkObs(0));
  assert.equal(episode2.type, 'STUN');
});
