import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initGame, collectIntents, applyMoves, resolveStuns, handleReleases, ActionsByTeam } from './engine';
import { RULES, TEAM0_BASE } from '@busters/shared';

test('collectIntents ignores stunned busters and clamps MOVE', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  const next = { ...state, busters: state.busters.map(b => ({ ...b })) };
  const byTeam: Record<number, typeof next.busters> = { 0: [], 1: [] } as any;
  next.busters.forEach(b => byTeam[b.teamId].push(b));
  const b0 = next.busters[0];
  const b1 = next.busters.find(b => b.teamId === 1)!;
  b1.state = 2; // stunned
  const actions: ActionsByTeam = {
    0: [{ type: 'MOVE', x: next.width + 100, y: next.height + 100 }],
    1: [{ type: 'MOVE', x: 0, y: 0 }],
  } as any;
  const intents = collectIntents(next, actions, byTeam as any);
  const move = intents.get(b0.id)! as any;
  assert.equal(move.x, next.width - 1);
  assert.equal(move.y, next.height - 1);
  assert.ok(!intents.has(b1.id));
});

test('collectIntents skips STUN when on cooldown', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  const next = { ...state, busters: state.busters.map(b => ({ ...b })) };
  const byTeam: Record<number, typeof next.busters> = { 0: [], 1: [] } as any;
  next.busters.forEach(b => byTeam[b.teamId].push(b));
  const attacker = next.busters[0];
  const victim = next.busters.find(b => b.teamId === 1)!;
  attacker.stunCd = 1; // still cooling down
  const actions: ActionsByTeam = {
    0: [{ type: 'STUN', busterId: victim.id }],
    1: [],
  } as any;
  const intents = collectIntents(next, actions, byTeam as any);
  assert.ok(!intents.has(attacker.id));
});

test('applyMoves respects speed limit', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  const next = { ...state, busters: state.busters.map(b => ({ ...b })) };
  const b = next.busters[0];
  b.x = 1000; b.y = 1000;
  const intents = new Map<number, any>();
  intents.set(b.id, { type: 'MOVE', x: b.x + 2000, y: b.y });
  applyMoves(next, intents as any);
  assert.equal(b.x, 1000 + RULES.MOVE_SPEED);
  assert.equal(b.y, 1000);
});

test('resolveStuns stuns target and drops carried ghost', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const next = { ...state, busters: state.busters.map(b => ({ ...b })), ghosts: state.ghosts.map(g => ({ ...g })) };
  const attacker = next.busters.find(b => b.teamId === 0)!;
  const victim = next.busters.find(b => b.teamId === 1)!;
  attacker.x = 1000; attacker.y = 1000;
  victim.x = attacker.x + RULES.STUN_RANGE - 1; victim.y = attacker.y;
  const ghost = next.ghosts[0];
  next.ghosts = [];
  victim.state = 1; victim.value = ghost.id;
  const startCarry = new Map<number, number | null>([
    [attacker.id, null],
    [victim.id, ghost.id],
  ]);
  const busterById = new Map(next.busters.map(b => [b.id, b]));
  const dropped: number[] = [];
  function dropCarried(_: any, gid: number | null) {
    if (gid !== null) dropped.push(gid);
  }
  const intents = new Map<number, any>([
    [attacker.id, { type: 'STUN', busterId: victim.id }],
  ]);
  resolveStuns(next, intents as any, startCarry, busterById, dropCarried);
  assert.equal(busterById.get(victim.id)!.state, 2);
  assert.equal(dropped[0], ghost.id);
});

test('handleReleases scores when releasing in base', () => {
  const state = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const next = { ...state, busters: state.busters.map(b => ({ ...b })), ghosts: [] as any }; // ghost removed
  const b = next.busters[0];
  const ghost = { id: 0, x: 0, y: 0, endurance: 0, engagedBy: 0 };
  const ghostById = new Map<number, any>([[ghost.id, ghost]]);
  b.state = 1; b.value = ghost.id; b.x = TEAM0_BASE.x; b.y = TEAM0_BASE.y;
  const intents = new Map<number, any>([[b.id, { type: 'RELEASE' }]]);
  handleReleases(next as any, intents as any, ghostById as any);
  assert.equal(next.scores[0], 1);
  assert.equal(b.state, 0);
});

