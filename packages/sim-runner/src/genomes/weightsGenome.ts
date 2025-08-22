import { Weights, BOUNDS, DEFAULT_WEIGHTS } from "../../../agents/weights";

export const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[];

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function clampWeights(w: Weights): Weights {
  const out: Weights = { ...w };
  for (const k of WEIGHT_KEYS) {
    const { min, max } = BOUNDS[k];
    out[k] = clamp(out[k], min, max);
  }
  // enforce bustMin <= bustMax
  if (out.bustMin > out.bustMax) out.bustMin = out.bustMax;
  return out;
}

export function weightsToVec(w: Weights): number[] {
  return WEIGHT_KEYS.map(k => w[k]);
}

export function vecToWeights(vec: number[]): Weights {
  const w: Weights = { ...DEFAULT_WEIGHTS };
  for (let i = 0; i < WEIGHT_KEYS.length; i++) {
    const k = WEIGHT_KEYS[i];
    const v = vec[i] ?? DEFAULT_WEIGHTS[k];
    const { min, max } = BOUNDS[k];
    w[k] = clamp(v, min, max);
  }
  // order constraint
  if (w.bustMin > w.bustMax) w.bustMin = w.bustMax;
  return w;
}
