export class CodinGameRandom {
  private seed: bigint;
  private static readonly MULTIPLIER = 0x5DEECE66Dn;
  private static readonly ADDEND = 0xBn;
  private static readonly MASK = (1n << 48n) - 1n;

  constructor(seed = 1) {
    this.seed = (BigInt(seed) ^ CodinGameRandom.MULTIPLIER) & CodinGameRandom.MASK;
  }

  private next(bits: number): bigint {
    this.seed = (this.seed * CodinGameRandom.MULTIPLIER + CodinGameRandom.ADDEND) & CodinGameRandom.MASK;
    return this.seed >> (48n - BigInt(bits));
  }

  /**
   * Returns a pseudo-random 32-bit integer.
   */
  int(): number {
    return Number(this.next(32));
  }

  /**
   * Returns a uniform integer in [0, bound).
   */
  intBetween(bound: number): number {
    if (bound <= 0) throw new Error('bound must be positive');
    const b = BigInt(bound);
    if ((bound & (bound - 1)) === 0) {
      return Number((b * this.next(31)) >> 31n);
    }
    let bits: bigint, val: bigint;
    do {
      bits = this.next(31);
      val = bits % b;
    } while (bits - val + (b - 1n) < 0n);
    return Number(val);
  }

  /**
   * Returns a floating point number in [0, 1).
   */
  float(): number {
    const high = this.next(26);
    const low = this.next(27);
    const result = (high << 27n) + low;
    return Number(result) / 2 ** 53;
  }
}
