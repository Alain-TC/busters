// packages/sim-runner/src/elo.ts

import fs from "fs";
import path from "path";

export type EloTable = Record<string, number>;

const DEFAULT_ELO = 1000;
const K_FACTOR = 32;
const ARTIFACTS = path.resolve("artifacts");
const ELO_PATH = process.env.ELO_PATH || path.resolve(ARTIFACTS, "elo.json");

/** Ensure artifacts dir exists */
function ensureArtifactsDir() {
  try {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
  } catch {
    /* noop */
  }
}

/** Safe JSON read */
function readJsonSafe<T = any>(p: string): T | null {
  try {
    if (!fs.existsSync(p)) return null;
    const txt = fs.readFileSync(p, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return null;
  }
}

/** Safe JSON write */
function writeJsonSafe(p: string, data: any) {
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data, null, 2));
  } catch {
    /* noop */
  }
}

/** Return a rating for id, creating it if absent */
export function getElo(tbl: EloTable, id: string): number {
  if (typeof tbl[id] !== "number") tbl[id] = DEFAULT_ELO;
  return tbl[id];
}

/** Expected score A vs B (0..1) */
export function expectedScore(ra: number, rb: number): number {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}

/** Update Elo for A vs B with scoreA in {1,0.5,0} */
export function updateElo(tbl: EloTable, aId: string, bId: string, scoreA: number, k: number = K_FACTOR) {
  const ra = getElo(tbl, aId);
  const rb = getElo(tbl, bId);
  const expA = expectedScore(ra, rb);
  const expB = 1 - expA;

  const scoreB = 1 - scoreA; // simple symmetric
  const newRa = ra + k * (scoreA - expA);
  const newRb = rb + k * (scoreB - expB);

  tbl[aId] = newRa;
  tbl[bId] = newRb;
}

/** Load Elo table from artifacts/elo.json (or empty if none) */
export function loadEloTable(filePath: string = ELO_PATH): EloTable {
  ensureArtifactsDir();
  const data = readJsonSafe<EloTable>(filePath);
  return data && typeof data === "object" ? { ...data } : {};
}

/** Save Elo table to artifacts/elo.json */
export function saveEloTable(tbl: EloTable, filePath: string = ELO_PATH) {
  ensureArtifactsDir();
  writeJsonSafe(filePath, tbl);
}

/** Convenience: record match outcome and persist */
export function recordResult(aId: string, bId: string, result: "win" | "draw" | "loss") {
  const tbl = loadEloTable();
  const scoreA = result === "win" ? 1 : result === "draw" ? 0.5 : 0;
  updateElo(tbl, aId, bId, scoreA);
  saveEloTable(tbl);
}

