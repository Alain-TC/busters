import { Fog } from "../fog";
import { resetPlan } from "./planner";

/** Memory per buster */
const mem = new Map<number, { stunReadyAt: number; radarUsed: boolean }>();
export const __mem = mem; // exposed for tests
/** tiny patrol memory for exploration */
const pMem = new Map<number, { wp: number }>();
export const __pMem = pMem; // exposed for tests

export function M(id: number) {
  if (!mem.has(id)) mem.set(id, { stunReadyAt: 0, radarUsed: false });
  return mem.get(id)!;
}

export function MPatrol(id: number) {
  if (!pMem.has(id)) pMem.set(id, { wp: 0 });
  return pMem.get(id)!;
}

export const fog = new Fog();
export const __fog = fog; // exposed for tests

let lastTick = Infinity;
const activeIds = new Set<number>();
let lifecycleTick = -1;

export function beginLifecycle(tick: number) {
  if (tick !== lifecycleTick) {
    if (lifecycleTick !== -1) {
      for (const id of Array.from(mem.keys())) {
        if (!activeIds.has(id)) {
          mem.delete(id);
          pMem.delete(id);
        }
      }
    }
    activeIds.clear();
    lifecycleTick = tick;
  }
}

export function markActive(id: number) {
  activeIds.add(id);
}

export function resetHybridMemory() {
  mem.clear();
  pMem.clear();
  resetPlan();
  fog.reset();
  activeIds.clear();
  lifecycleTick = -1;
  lastTick = Infinity;
}

export type HybridMemory = {
  mem: [number, { stunReadyAt: number; radarUsed: boolean }][];
  pMem: [number, { wp: number }][];
};

export function serializeHybridMemory(): HybridMemory {
  return {
    mem: Array.from(mem.entries()),
    pMem: Array.from(pMem.entries()),
  };
}

export function loadHybridMemory(data: HybridMemory) {
  resetHybridMemory();
  for (const [id, m] of data.mem) mem.set(id, m);
  for (const [id, m] of data.pMem) pMem.set(id, m);
}

export function getLastTick() {
  return lastTick;
}

export function setLastTick(tick: number) {
  lastTick = tick;
}
