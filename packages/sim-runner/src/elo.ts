// Lightweight Elo + PFSP utilities
import fs from 'fs';
import path from 'path';

export type EloTable = Record<string, number>;
const DEFAULT_ELO = 1200;

export function loadElo(artDir: string): EloTable {
  const p = path.join(artDir, 'league_elo.json');
  if (fs.existsSync(p)) {
    try { return JSON.parse(fs.readFileSync(p, 'utf-8')); } catch {}
  }
  return {};
}

export function saveElo(artDir: string, elo: EloTable) {
  const p = path.join(artDir, 'league_elo.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(elo, null, 2));
}

export function ensureOpponentId(x: {type:'module', spec:string} | {type:'genome', tag:string}): string {
  return x.type === 'module' ? x.spec : x.tag;
}

function expectedScore(my: number, opp: number) {
  return 1 / (1 + Math.pow(10, (opp - my) / 400));
}

export function recordMatch(elo: EloTable, opponentId: string, myWon: boolean, K = 16) {
  const opp = elo[opponentId] ?? DEFAULT_ELO;
  // model (trainee) is treated as baseline 1200 (transient)
  const my = DEFAULT_ELO;
  const expOpp = expectedScore(opp, my);   // opponent's expected vs baseline
  const sOpp = myWon ? 0 : 1;             // if I win, opponent loses
  const newOpp = Math.round(opp + K * (sOpp - expOpp));
  elo[opponentId] = newOpp;
}

export type PFSPCandidate =
  | { type:'module', spec:string, id:string }
  | { type:'genome', tag:string, genome:any, id:string };

export function pickOpponentPFSP(elo: EloTable, cands: PFSPCandidate[], beta = 6.0) {
  // Weight opponents by closeness to 50% expected outcome vs baseline 1200
  const baseline = DEFAULT_ELO;
  const ws: number[] = [];
  let sum = 0;
  for (const c of cands) {
    const id = c.id;
    const e = elo[id] ?? DEFAULT_ELO;
    const exp = expectedScore(baseline, e);           // baseline's expected win prob vs opponent
    const w = Math.exp(-beta * Math.abs(exp - 0.5));  // closer to 0.5 -> heavier
    ws.push(w); sum += w;
  }
  let r = Math.random() * sum;
  for (let i=0;i<cands.length;i++) {
    r -= ws[i];
    if (r <= 0) return cands[i];
  }
  return cands[cands.length - 1];
}
