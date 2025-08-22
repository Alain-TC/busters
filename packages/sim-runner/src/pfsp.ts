// packages/sim-runner/src/pfsp.ts
import { EloTable, getElo, expectedScore, loadEloTable } from "./elo";

export type Opponent = { id: string; act?: Function };

/**
 * PFSP selection using Elo:
 *  - Prefers opponents near target win-rate (default 0.5).
 *  - Samples with a softmax temperature (default 0.2).
 * Env overrides:
 *   PFSP_TARGET=0.55 PFSP_TEMP=0.15 ELO_PATH=artifacts/elo.json
 */
export function selectOpponentsPFSP(params: {
  meId: string;
  candidates?: Opponent[] | string[];
  elo?: EloTable;
  n?: number;
  target?: number;
  temperature?: number;
  rng?: () => number;
}): Opponent[] {
  const envTarget = Number(process.env.PFSP_TARGET);
  const envTemp = Number(process.env.PFSP_TEMP);
  const target = Number.isFinite(params.target) ? params.target
               : Number.isFinite(envTarget) ? envTarget
               : 0.5;
  const temperature = Number.isFinite(params.temperature) ? params.temperature
                    : Number.isFinite(envTemp) ? envTemp
                    : 0.2;

  const meId = params.meId;
  const elo: EloTable = params.elo ?? loadEloTable();
  const rng = params.rng ?? Math.random;

  // Normalize candidate list defensively
  let cand: Opponent[] = [];
  if (Array.isArray(params.candidates)) {
    cand = params.candidates.map((c: any) => (typeof c === "string" ? { id: c } : c));
  }

  // Fallbacks if empty/undefined
  if (!cand || cand.length === 0) {
    getElo(elo, "greedy");
    getElo(elo, "random");
    cand = [{ id: "greedy" }, { id: "random" }];
  }

  // n: clamp to [1, cand.length]
  let n = Number.isFinite(params.n as number) ? (params.n as number) : Math.min(2, cand.length);
  n = Math.max(1, Math.min(cand.length, n));
  if (cand.length <= n) return cand.slice(0, n);

  // Ratings
  const rMe = getElo(elo, meId);

  // Score by closeness to target p(win)
  const scored = cand.map((c) => {
    const rOpp = getElo(elo, c.id);
    const pWin = expectedScore(rMe, rOpp);
    const closeness = 1 - Math.abs(pWin - target); // [0..1], 1 = closest
    return { opp: c, pWin, closeness };
  });

  // Softmax sampling over closeness/temperature
  const temp = Math.max(temperature, 1e-6);
  const weights = scored.map((s) => Math.exp(s.closeness / temp));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const probs = weights.map((w) => w / total);

  // Sample n without replacement
  const picks: Opponent[] = [];
  const used = new Set<number>();
  while (picks.length < n && used.size < probs.length) {
    let r = rng();
    let idx = -1;
    for (let i = 0; i < probs.length; i++) {
      if (used.has(i)) continue;
      const p = probs[i];
      if (r <= p) { idx = i; break; }
      r -= p;
    }
    if (idx < 0) idx = probs.findIndex((_, i) => !used.has(i));
    if (idx < 0) break;
    used.add(idx);
    picks.push(scored[idx].opp);
  }
  if (picks.length === 0) picks.push(cand[0] ?? { id: "greedy" });
  return picks;
}

