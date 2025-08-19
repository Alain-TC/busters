/** Hungarian algorithm (min-cost assignment) for rows <= cols.
 *  Input:  cost matrix cost[nRows][nCols] (any real numbers).
 *  Output: assignment array of length nRows with the chosen column per row (or -1).
 *
 *  If nCols < nRows, we pad with large-cost dummy columns.
 */
export function hungarian(cost: number[][]): number[] {
  const n = cost.length;
  const m0 = cost[0]?.length ?? 0;

  if (n === 0 || m0 === 0) return [];

  let m = m0;
  if (m < n) m = n; // pad to square

  // Build squared matrix with padding
  const BIG = 1e9;
  const a: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    a[i] = new Array(m);
    for (let j = 0; j < m; j++) {
      a[i][j] = (j < m0) ? cost[i][j] : BIG;
    }
  }

  // Potentials and matching arrays (1-based indexing trick)
  const u = new Array(n + 1).fill(0);
  const v = new Array(m + 1).fill(0);
  const p = new Array(m + 1).fill(0);
  const way = new Array(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    const minv = new Array(m + 1).fill(Infinity);
    const used = new Array(m + 1).fill(false);
    let j0 = 0;

    do {
      used[j0] = true;
      const i0 = p[j0];
      let delta = Infinity;
      let j1 = 0;

      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
        if (cur < minv[j]) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j] < delta) {
          delta = minv[j];
          j1 = j;
        }
      }

      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta;
          v[j] -= delta;
        } else {
          minv[j] -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    do {
      const j1 = way[j0];
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== 0);
  }

  // Build result: row -> chosen column (within original m0; else -1)
  const res = new Array(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    if (p[j] > 0) {
      const i = p[j] - 1;
      const col = j - 1;
      res[i] = (col < m0) ? col : -1;
    }
  }
  return res;
}

