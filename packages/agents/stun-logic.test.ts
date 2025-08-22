import { test } from 'node:test';
import assert from 'node:assert/strict';

import { act as aggressiveStunner } from './aggressive-stunner.js';
import { act as aggroChaser } from './aggro-chaser.js';
import { act as baseCamper } from './base-camper.js';
import { act as camperStunner } from './camper-stunner.js';
import { act as greedyBuster } from './greedy-buster.js';
import { act as defenderBot } from './defender-bot.ts';
import { act as scoutBot } from './scout-bot.ts';
import { act as evolvedBot } from './evolved-bot.js';
import { act as evolvedHybridBot } from './evolved-hybrid-bot.js';

const ctx: any = { myBase: { x: 0, y: 0 }, myTeamId: 0, mapW: 16000, mapH: 9000 };

const agents: [string, Function][] = [
  ['aggressive-stunner', aggressiveStunner],
  ['aggro-chaser', aggroChaser],
  ['base-camper', baseCamper],
  ['camper-stunner', camperStunner],
  ['greedy-buster', greedyBuster],
  ['defender-bot', defenderBot],
  ['scout-bot', scoutBot],
  ['evolved-bot', evolvedBot],
  ['evolved-hybrid-bot', evolvedHybridBot],
];

for (const [name, agent] of agents) {
  test(`${name} avoids re-stunning an already stunned enemy`, () => {
    const obs: any = {
      tick: 0,
      self: { id: 0, x: 0, y: 0, stunCd: 0, carrying: undefined, radarUsed: true },
      enemies: [{ id: 1, x: 0, y: 0, range: 0, stunnedFor: 5 }],
      ghostsVisible: [],
    };
    const action = agent(ctx, obs);
    assert.notEqual(action.type, 'STUN');
  });

  test(`${name} waits for stun cooldown before stunning again`, () => {
    const obs: any = {
      tick: 0,
      self: { id: 0, x: 0, y: 0, stunCd: 10, carrying: undefined, radarUsed: true },
      enemies: [{ id: 1, x: 0, y: 0, range: 0, stunnedFor: 0 }],
      ghostsVisible: [],
    };
    const action = agent(ctx, obs);
    assert.notEqual(action.type, 'STUN');
  });
}
