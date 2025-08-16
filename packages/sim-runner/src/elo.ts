/**
 * Elo rating helpers + JSON persistence
 * File path: packages/sim-runner/artifacts/league_elo.json
 */
import fs from "node:fs";
import path from "node:path";

export type EloTable = Record<string, number>;

const ART_DIR = path.resolve("packages/sim-runner/artifacts");
const ELO_PATH = path.join(ART_DIR, "league_elo.json");

// Default ratings for known baselines
const DEFAULTS: EloTable = {
  greedy: 1000,
  random: 1000,
};

export function expectedScore(rA: number, rB: number) {
  return 1 / (1 + Math.pow(10, (rB - rA) / 400));
}

export function updateElo(rA: number, rB: number, scoreA: 0 | 0.5 | 1, K = 24) {
  const expA = expectedScore(rA, rB);
  const newA = rA + K * (scoreA - expA);
  const newB = rB + K * ((1 - scoreA) - (1 - expA));
  return [newA, newB] as const;
}

export function ensureDir() {
  if (!fs.existsSync(ART_DIR)) fs.mkdirSync(ART_DIR, { recursive: true });
}

export function loadEloTable(): EloTable {
  ensureDir();
  if (!fs.existsSync(ELO_PATH)) {
    return { ...DEFAULTS };
  }
  try {
    const raw = fs.readFileSync(ELO_PATH, "utf8");
    const j = JSON.parse(raw) as EloTable;
    // seed defaults if missing
    for (const [k, v] of Object.entries(DEFAULTS)) {
      if (j[k] == null) j[k] = v;
    }
    return j;
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveEloTable(tbl: EloTable) {
  ensureDir();
  fs.writeFileSync(ELO_PATH, JSON.stringify(tbl, null, 2));
}

/**
 * Get rating for id, initializing if missing.
 */
export function getElo(tbl: EloTable, id: string, init = 1000) {
  if (tbl[id] == null) tbl[id] = init;
  return tbl[id];
}

/**
 * Record a match result for A vs B (scoreA ∈ {0,0.5,1})
 */
export function recordResult(tbl: EloTable, idA: string, idB: string, scoreA: 0 | 0.5 | 1, K = 24) {
  const rA = getElo(tbl, idA);
  const rB = getElo(tbl, idB);
  const [nA, nB] = updateElo(rA, rB, scoreA, K);
  tbl[idA] = nA;
  tbl[idB] = nB;
  return tbl;
}

// --- Compatibility exports for existing ga.ts imports ---
export { selectOpponentsPFSP as pickOpponentPFSP } from "./pfsp";
export type PFSPCandidate = { id: string; act?: Function };

// Keep old names working by delegating to the new functions
export function loadElo() { return loadEloTable(); }
export function saveElo(tbl: EloTable) { return saveEloTable(tbl); }
/** Ensure an opponent id exists in the Elo table (returns the table for chaining). */
export function ensureOpponentId(tbl: EloTable, id: string, init = 1000) {
  getElo(tbl, id, init);
  return tbl;
}
/** Record a match for A vs B using scoreA ∈ {0, 0.5, 1}. */
export function recordMatch(tbl: EloTable, idA: string, idB: string, scoreA: 0 | 0.5 | 1, K = 24) {
  return recordResult(tbl, idA, idB, scoreA, K);
}
