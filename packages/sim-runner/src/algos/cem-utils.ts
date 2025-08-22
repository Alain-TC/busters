export function vecMean(vs: number[][]): number[] {
  const n = vs.length;
  const d = vs[0].length;
  const out = new Array(d).fill(0);
  for (const v of vs) {
    for (let i = 0; i < d; i++) out[i] += v[i];
  }
  for (let i = 0; i < d; i++) out[i] /= n;
  return out;
}

export function vecVar(vs: number[][], m: number[]): number[] {
  const n = vs.length;
  const d = m.length;
  const out = new Array(d).fill(0);
  for (const v of vs) {
    for (let i = 0; i < d; i++) {
      const dv = v[i] - m[i];
      out[i] += dv * dv;
    }
  }
  const denom = Math.max(1, n - 1);
  for (let i = 0; i < d; i++) out[i] /= denom;
  return out;
}
