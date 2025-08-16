import { initGame, step } from '../packages/engine/src/engine';
import type { ActionsByTeam } from '../packages/engine/src/engine';

// Test 1: If a carrier is stunned *in base 0*, base 0 scores
(function testStunInBaseScores() {
  let s = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 0 });
  // Team 0 buster carries ghost 99 at base 0
  s.busters[0].x = 0; s.busters[0].y = 0; s.busters[0].state = 1; s.busters[0].value = 99;
  // Team 1 buster next to it, ready to stun
  s.busters[1].x = 100; s.busters[1].y = 100; s.busters[1].stunCd = 0;

  const acts: ActionsByTeam = {
    0: [ { type:'MOVE', x:0, y:0 } ],
    1: [ { type:'STUN', busterId: s.busters[0].id } ]
  } as any;

  s = step(s, acts);
  if (s.scores[0] !== 1) throw new Error('Expected base 0 to score on stun-in-base drop');
  if (s.busters[0].state !== 2) throw new Error('Victim should be stunned');
  console.log('✓ Test 1: stun-in-base scores OK');
})();

// Test 2: If a carrier attempts BUST, its ghost escapes (no score), endurance 0 on ground
(function testCarrierBustEscape() {
  let s = initGame({ seed: 1, bustersPerPlayer: 1, ghostCount: 1 });
  const carrier = s.busters[0];
  carrier.state = 1; carrier.value = 0; // carrying ghost id 0
  // Put a visible ghost id 0 at map (we will overwrite soon on "escape")
  s.ghosts = []; // captured already: not on map
  const enemy = s.busters[1]; enemy.x = carrier.x + 2000; enemy.y = carrier.y; // far

  const acts: ActionsByTeam = {
    0: [ { type:'BUST', ghostId: 123 } as any ], // invalid id but effect is "escape"
    1: [ { type:'MOVE', x: enemy.x, y: enemy.y } ]
  } as any;

  s = step(s, acts);
  const dropped = s.ghosts.find(g => g.id === 0);
  if (!dropped) throw new Error('Expected carried ghost to escape to ground');
  if (s.scores[0] !== 0 && s.scores[1] !== 0) throw new Error('Escape should not score');
  console.log('✓ Test 2: carrying + BUST => escape OK');
})();
