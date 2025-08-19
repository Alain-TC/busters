import { Weights, BOUNDS, DEFAULT_WEIGHTS } from "../../../agents/weights";

export const WEIGHT_KEYS = Object.keys(DEFAULT_WEIGHTS) as (keyof Weights)[];

export function clampWeights(w: Weights): Weights {
  const out = { ...w };
  for (const k of WEIGHT_KEYS) {
    const {min,max} = BOUNDS[k];
    // @ts-ignore
    out[k] = Math.max(min, Math.min(max, out[k]));
  }
  // enforce bustMin <= bustMax
  if (out.bustMin > out.bustMax) out.bustMin = out.bustMax;
  return out;
}

export function weightsToVec(w: Weights): number[] {
  return WEIGHT_KEYS.map(k => (w as any)[k] as number);
}

export function vecToWeights(vec: number[]): Weights {
  const w: any = { ...DEFAULT_WEIGHTS };
  for (let i=0;i<WEIGHT_KEYS.length;i++){
    const k = WEIGHT_KEYS[i];
    const v = vec[i] ?? (DEFAULT_WEIGHTS as any)[k];
    const {min,max} = BOUNDS[k];
    w[k] = Math.max(min, Math.min(max, v));
  }
  // order constraint
  if (w.bustMin > w.bustMax) w.bustMin = w.bustMax;
  return w as Weights;
}
