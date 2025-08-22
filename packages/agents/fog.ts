/** Minimal fog-of-war & frontier selector for Busters (EVOL2)
 *  - Grid covers 16000x9000 with 400px cells => 40 x 23
 *  - Tracks last-visited tick per cell
 *  - Tracks a soft "ghost belief" heat value per cell (decays each tick)
 *  - Provides pickFrontierTarget(start) = best exploration target
 *
 *  API:
 *   - beginTick(tick: number)
 *   - markVisited(p: {x,y})
 *   - clearCircle(p: {x,y}, r: number)
 *   - bumpGhost(x: number, y: number)
 *   - pickFrontierTarget(from: {x,y}): {x,y}
 */

type Pt = { x: number; y: number };

const W = 16000, H = 9000;
const CELL = 400;
const GX = Math.ceil(W / CELL); // 40
const GY = Math.ceil(H / CELL); // 23

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function dist(ax: number, ay: number, bx: number, by: number) { return Math.hypot(ax - bx, ay - by); }

export class Fog {
  private tick = 0;

  // last visited tick, -1 means never
  private last: Int32Array;
  // belief heat (0..+inf, small decay)
  private heat: Float32Array;

  constructor() {
    this.last = new Int32Array(GX * GY);
    this.heat = new Float32Array(GX * GY);
    for (let i = 0; i < this.last.length; i++) this.last[i] = -1;
  }

  reset() {
    this.tick = 0;
    this.last.fill(-1);
    this.heat.fill(0);
  }

  beginTick(t: number) {
    if (t === this.tick) return;
    this.tick = t;

    // light decay of heat to slowly forget stale beliefs
    // (fast: vectorized loop)
    for (let i = 0; i < this.heat.length; i++) {
      this.heat[i] *= 0.97; // gentle decay
      if (this.heat[i] < 0.02) this.heat[i] = 0;
    }
    this.diffuse();
    this.normalize();
  }

  private idxOf(x: number, y: number): number {
    const gx = clamp(Math.floor(x / CELL), 0, GX - 1);
    const gy = clamp(Math.floor(y / CELL), 0, GY - 1);
    return gy * GX + gx;
  }

  markVisited(p: Pt) {
    const i = this.idxOf(p.x, p.y);
    this.last[i] = this.tick;
    this.heat[i] *= 0.5;
    this.normalize();
  }

 /** Clear vision circle (approx) by setting heat low & refresh visited in the disk */
  clearCircle(p: Pt, r: number) {
    const gx0 = clamp(Math.floor((p.x - r) / CELL), 0, GX - 1);
    const gx1 = clamp(Math.floor((p.x + r) / CELL), 0, GX - 1);
    const gy0 = clamp(Math.floor((p.y - r) / CELL), 0, GY - 1);
    const gy1 = clamp(Math.floor((p.y + r) / CELL), 0, GY - 1);
    const r2 = r * r;

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = gx * CELL + CELL / 2;
        const cy = gy * CELL + CELL / 2;
        if ((cx - p.x) * (cx - p.x) + (cy - p.y) * (cy - p.y) <= r2) {
          const i = gy * GX + gx;
          this.last[i] = this.tick;
          this.heat[i] *= 0.2; // strong down-weight if we just saw it
        }
      }
    }
    this.normalize();
  }

  /** Probability/heat at a given point */
  probAt(p: Pt): number {
    const i = this.idxOf(p.x, p.y);
    return this.heat[i];
  }

  /** Positive evidence: increase belief near a ghost sighting */
  bumpGhost(x: number, y: number) {
    const gx0 = clamp(Math.floor((x - 800) / CELL), 0, GX - 1);
    const gx1 = clamp(Math.floor((x + 800) / CELL), 0, GX - 1);
    const gy0 = clamp(Math.floor((y - 800) / CELL), 0, GY - 1);
    const gy1 = clamp(Math.floor((y + 800) / CELL), 0, GY - 1);

    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const cx = gx * CELL + CELL / 2;
        const cy = gy * CELL + CELL / 2;
        const d = dist(cx, cy, x, y);
        const w = Math.max(0, 1 - d / 900); // cone within ~900
        const i = gy * GX + gx;
        this.heat[i] += 0.8 * w;
      }
    }
    this.normalize();
  }

  private diffuse() {
    const next = new Float32Array(this.heat.length);
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const i = gy * GX + gx;
        const v = this.heat[i];
        const share = v / 5; // self + 4-neighbors
        next[i] += share;
        const nbs = [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ];
        for (const [dx, dy] of nbs) {
          const nx = gx + dx, ny = gy + dy;
          if (nx >= 0 && nx < GX && ny >= 0 && ny < GY) {
            next[ny * GX + nx] += share;
          } else {
            next[i] += share;
          }
        }
      }
    }
    this.heat = next;
  }

  private normalize() {
    let sum = 0;
    for (const v of this.heat) sum += v;
    if (sum <= 0) return;
    for (let i = 0; i < this.heat.length; i++) this.heat[i] /= sum;
  }

  /** Frontier score and target based on age * distance * heat */
  frontier(from: Pt): { target: Pt; score: number } {
    let bestI = 0;
    let bestS = -1;
    for (let gy = 0; gy < GY; gy++) {
      for (let gx = 0; gx < GX; gx++) {
        const i = gy * GX + gx;
        const cx = gx * CELL + CELL / 2;
        const cy = gy * CELL + CELL / 2;
        const lv = this.last[i];
        const age = lv < 0 ? 200 : (this.tick - lv);
        const d = dist(from.x, from.y, cx, cy);
        const score = age * d * (this.heat[i] + 1);
        if (score > bestS) { bestS = score; bestI = i; }
      }
    }
    const bx = (bestI % GX) * CELL + CELL / 2;
    const by = Math.floor(bestI / GX) * CELL + CELL / 2;
    return { target: { x: clamp(bx, 0, W), y: clamp(by, 0, H) }, score: bestS };
  }

  /** Return frontier target only */
  pickFrontierTarget(from: Pt): Pt {
    return this.frontier(from).target;
  }
}

