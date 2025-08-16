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
  float(): number { return (this.int() >>> 0) / 0xFFFFFFFF; }
}
