/** Deterministic env sampler from a seed (CRNs across genomes).
 *  bustersPerPlayer ∈ {2,3,4}, ghostCount ∈ {8..28}
 */
function mulb32(a: number) {
  return function() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function envFromSeed(seed: number): { bpp: number; ghosts: number } {
  const rng = mulb32((seed ^ 0x9E3779B9) >>> 0);
  const bpp    = 2 + Math.floor(rng() * 3);         // 2..4
  const ghosts = 8 + Math.floor(rng() * 21);        // 8..28
  return { bpp, ghosts };
}
