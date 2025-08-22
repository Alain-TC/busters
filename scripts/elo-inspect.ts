// scripts/elo-inspect.ts
import fs from "fs";
import path from "path";
import { loadEloTable, expectedScore, getElo } from "../packages/sim-runner/src/elo";

const elo = loadEloTable();
const args = process.argv.slice(2);

// parse env or args
const target = Number(process.env.PFSP_TARGET) || Number(args[0]) || 0.5;
const temp   = Number(process.env.PFSP_TEMP)   || Number(args[1]) || 0.2;

function table(pool: string[], meId = "evolved") {
  const rMe = getElo(elo, meId);
  const rows = pool.map((id) => {
    const rOpp = getElo(elo, id);
    const pWin = expectedScore(rMe, rOpp);
    const closeness = 1 - Math.abs(pWin - target);
    return { id, rOpp: Math.round(rOpp), pWin, closeness };
  });

  // softmax over closeness/temp
  const weights = rows.map((r) => Math.exp(r.closeness / Math.max(temp, 1e-6)));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const probs = weights.map((w) => w / total);

  const out = rows
    .map((r, i) => ({
      id: r.id,
      elo: r.rOpp,
      pWin: +r.pWin.toFixed(3),
      close: +r.closeness.toFixed(3),
      pfspProb: +(probs[i] || 0).toFixed(3),
    }))
    .sort((a, b) => b.close - a.close);

  return out;
}

const poolGuess = ["greedy", "random", "camper", "stunner", "defender", "scout"];
console.log("PFSP inspector");
console.log(" target =", target, " temp =", temp);
console.log(" elo =", elo);
console.table(table(poolGuess));

