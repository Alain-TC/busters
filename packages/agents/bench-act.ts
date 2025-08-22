import { act, __mem, __pMem } from './hybrid-bot';
import { HybridState } from './lib/state';
import { resetMicroPerf } from './micro';
import { performance } from 'node:perf_hooks';

process.env.MICRO_TIMING = '1';

const originalLog = console.log;
console.log = (...args: any[]) => {
  if (typeof args[0] === 'string' && args[0].startsWith('[micro]')) return;
  originalLog(...args);
};

const scenarios = [
  {
    ctx: { myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } },
    obs: { self: { id: 1, x: 0, y: 0, state: 0 }, friends: [], enemies: [], ghostsVisible: [] },
  },
  {
    ctx: { myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } },
    obs: {
      self: { id: 1, x: 4000, y: 4000, state: 0 },
      friends: [
        { id: 2, x: 3000, y: 4000, state: 0 },
        { id: 3, x: 3500, y: 4100, state: 0 },
      ],
      enemies: [
        { id: 4, x: 4200, y: 4000, state: 0, range: 200 },
        { id: 5, x: 5000, y: 4000, state: 0, range: 800 },
      ],
      ghostsVisible: [{ id: 100, x: 4500, y: 4000, state: 0, range: 600 }],
    },
  },
  {
    ctx: { myBase: { x: 0, y: 0 }, enemyBase: { x: 16000, y: 9000 } },
    obs: {
      self: { id: 1, x: 6000, y: 6000, state: 1, carrying: 4, stunCd: 5 },
      friends: [{ id: 2, x: 5000, y: 5500, state: 0 }],
      enemies: [{ id: 3, x: 6100, y: 6000, state: 0, range: 100 }],
      ghostsVisible: [],
    },
  },
];

const runs = 90;
const times: number[] = [];
__mem.clear();
__pMem.clear();
const state = new HybridState();
for (let i = 0; i < runs; i++) {
  const base = scenarios[i % scenarios.length];
  const ctx = { ...base.ctx, tick: i } as any;
  const obs = {
    ...base.obs,
    tick: i,
    self: { ...base.obs.self },
    friends: base.obs.friends.map(f => ({ ...f })),
    enemies: base.obs.enemies.map(e => ({ ...e })),
    ghostsVisible: base.obs.ghostsVisible.map(g => ({ ...g })),
  } as any;
  resetMicroPerf();
  const start = performance.now();
  act(ctx, obs, state);
  times.push(performance.now() - start);
}

console.log = originalLog;

times.sort((a, b) => a - b);
const avg = times.reduce((a, b) => a + b, 0) / times.length;
const p95 = times[Math.floor(times.length * 0.95)];
const max = times[times.length - 1];
console.log(`act timings: avg=${avg.toFixed(3)}ms p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms`);

if (max > 100 || p95 > 100) {
  throw new Error(`act exceeded 100ms per turn (avg=${avg.toFixed(3)}ms p95=${p95.toFixed(3)}ms max=${max.toFixed(3)}ms)`);
}
