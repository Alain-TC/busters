export function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

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
