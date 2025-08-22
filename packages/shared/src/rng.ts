export class XorShift32 {
  private _state: number;
  constructor(seed = 1) {
    this._state = seed >>> 0 || 1;
  }
  int(): number {
    // https://en.wikipedia.org/wiki/Xorshift
    let x = this._state;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this._state = x >>> 0;
    return this._state;
  }
  float(): number { return (this.int() >>> 0) / 0x100000000; }
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function gaussian(rng: () => number): number {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}
