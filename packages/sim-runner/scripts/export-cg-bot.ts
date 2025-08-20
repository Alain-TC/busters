import fs from "fs";
import path from "path";
import { execSync } from "child_process";

type TW = { TUNE: any; WEIGHTS: any };

const ORDER = [
  "TUNE.RELEASE_DIST",
  "TUNE.STUN_RANGE",
  "TUNE.RADAR1_TURN",
  "TUNE.RADAR2_TURN",
  "TUNE.SPACING",
  "TUNE.SPACING_PUSH",
  "TUNE.BLOCK_RING",
  "TUNE.DEFEND_RADIUS",
  "TUNE.EXPLORE_STEP_REWARD",
  "WEIGHTS.BUST_BASE",
  "WEIGHTS.BUST_RING_BONUS",
  "WEIGHTS.BUST_ENEMY_NEAR_PEN",
  "WEIGHTS.INTERCEPT_BASE",
  "WEIGHTS.INTERCEPT_DIST_PEN",
  "WEIGHTS.DEFEND_BASE",
  "WEIGHTS.DEFEND_NEAR_BONUS",
  "WEIGHTS.BLOCK_BASE",
  "WEIGHTS.EXPLORE_BASE",
  "WEIGHTS.DIST_PEN",
] as const;

function coerceToTW(raw: any): TW {
  if (raw && raw.TUNE && raw.WEIGHTS) return raw as TW;
  if (Array.isArray(raw) && raw.length === ORDER.length) {
    const TUNE: any = {};
    const WEIGHTS: any = {};
    ORDER.forEach((key, i) => {
      const v = raw[i];
      if (key.startsWith("TUNE.")) TUNE[key.slice(5)] = v;
      else WEIGHTS[key.slice(8)] = v;
    });
    return { TUNE, WEIGHTS };
  }
  if (raw && Array.isArray(raw.vec) && raw.vec.length === ORDER.length) {
    return coerceToTW(raw.vec);
  }
  throw new Error("Invalid best_hybrid.json — expected {TUNE, WEIGHTS} or a vector of length " + ORDER.length);
}

function buildCgBotSource(TUNE: any, WEIGHTS: any): string {
  execSync("pnpm --filter @busters/agents build:cg", { stdio: "inherit" });
  const bundlePath = path.resolve(__dirname, "../../agents/dist/hybrid-cg.js");
  let code = fs.readFileSync(bundlePath, "utf8");
  const TUNE_STR = JSON.stringify(TUNE, null, 2);
  const WEIGHTS_STR = JSON.stringify(WEIGHTS, null, 2);
  code = code.replace(/var TUNE = {[^]*?};/, `var TUNE = ${TUNE_STR};`);
  code = code.replace(/var WEIGHTS = {[^]*?};/, `var WEIGHTS = ${WEIGHTS_STR};`);
  return code;
}

async function main() {
  const inPath = process.argv[2] || "artifacts/best_hybrid.json";
  const outPath = process.argv[3] || "../agents/codingame-hybrid.js";

  const absIn = path.resolve(process.cwd(), inPath);
  const absOut = path.resolve(process.cwd(), outPath);

  const raw = JSON.parse(fs.readFileSync(absIn, "utf8"));
  const { TUNE, WEIGHTS } = coerceToTW(raw);

  const src = buildCgBotSource(TUNE, WEIGHTS);

  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, src);
  console.log(`Wrote Codingame bot -> ${absOut}`);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
