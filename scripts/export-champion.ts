// scripts/export-champion.ts
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";

function arg(flag: string, dflt?: string) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}

const standingsPath = arg("--standings", "packages/sim-runner/artifacts/tournament_standings.json");
const outPath = arg("--out", "agents/codingame-bot.js");

if (!fs.existsSync(standingsPath)) {
  console.error(`Standings not found: ${standingsPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(standingsPath, "utf8"));
// Expect either array of rows or object with rows; we try to be lenient.
const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
if (!rows.length) {
  console.error("No rows in standings JSON.");
  process.exit(1);
}

// Pick highest winRate, tie-break by avgDiff
rows.sort((a: any, b: any) => (b.winRate - a.winRate) || (b.avgDiff - a.avgDiff));
const champ = rows[0];
const id: string = champ.id || champ.name;

console.log(`Champion: ${id}`);

function runExport(args: string[]) {
  execFileSync("pnpm", ["-s", "tsx", "scripts/export-codingame.ts", ...args], { stdio: "inherit" });
}

if (id.startsWith("hof:")) {
  // id like "hof:16,1843,1600"
  const parts = id.slice(4).split(",").map(s => +s);
  const tmpGenome = { radarTurn: parts[0], stunRange: parts[1], releaseDist: parts[2] };
  const tmpPath = "packages/sim-runner/artifacts/tmp_champion_genome.json";
  fs.writeFileSync(tmpPath, JSON.stringify(tmpGenome), "utf8");
  runExport(["--from", "genome", "--in", tmpPath, "--out", outPath]);
} else if (id.includes("@busters/agents/hybrid")) {
  runExport(["--from", "hybrid", "--out", outPath]);
} else {
  // Fallback: treat as genome if a genome file exists; otherwise hybrid
  if (fs.existsSync("packages/sim-runner/artifacts/simrunner_best_genome.json")) {
    runExport(["--from", "genome", "--in", "packages/sim-runner/artifacts/simrunner_best_genome.json", "--out", outPath]);
  } else {
    runExport(["--from", "hybrid", "--out", outPath]);
  }
}

