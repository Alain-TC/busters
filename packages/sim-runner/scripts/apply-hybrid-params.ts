import fs from "fs";
import path from "path";

type KV = Record<string, number>;
type TW = { TUNE: KV; WEIGHTS: KV };

// --- Expected keys & default values (match your hybrid-bot defaults) ---
const TUNE_KEYS = [
  "RELEASE_DIST",
  "STUN_RANGE",
  "RADAR1_TURN",
  "RADAR2_TURN",
  "SPACING",
  "SPACING_PUSH",
  "BLOCK_RING",
  "DEFEND_RADIUS",
  "EXPLORE_STEP_REWARD",
] as const;

const WEIGHT_KEYS = [
  "BUST_BASE",
  "BUST_RING_BONUS",
  "BUST_ENEMY_NEAR_PEN",
  "INTERCEPT_BASE",
  "INTERCEPT_DIST_PEN",
  "DEFEND_BASE",
  "DEFEND_NEAR_BONUS",
  "BLOCK_BASE",
  "EXPLORE_BASE",
  "DIST_PEN",
] as const;

const DEFAULT_TUNE: KV = {
  RELEASE_DIST: 1600,
  STUN_RANGE: 1760,
  RADAR1_TURN: 2,
  RADAR2_TURN: 55,
  SPACING: 900,
  SPACING_PUSH: 280,
  BLOCK_RING: 1750,
  DEFEND_RADIUS: 3200,
  EXPLORE_STEP_REWARD: 1.0,
};

const DEFAULT_WEIGHTS: KV = {
  BUST_BASE: 12,
  BUST_RING_BONUS: 5,
  BUST_ENEMY_NEAR_PEN: 3,
  INTERCEPT_BASE: 14,
  INTERCEPT_DIST_PEN: 0.004,
  DEFEND_BASE: 10,
  DEFEND_NEAR_BONUS: 6,
  BLOCK_BASE: 6,
  EXPLORE_BASE: 4,
  DIST_PEN: 0.003,
};

// --- Helpers ---
function isNumberArray(x: any): x is number[] {
  return Array.isArray(x) && x.every(v => typeof v === "number" && Number.isFinite(v));
}

function normalizeName(k: string): string {
  // Uppercase and strip non alphanumerics to tolerate different styles (radar1Turn, radar_1_turn, etc.)
  return k.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

const TUNE_LOOKUP = new Map(TUNE_KEYS.map(k => [normalizeName(k), k]));
const WEIGHT_LOOKUP = new Map(WEIGHT_KEYS.map(k => [normalizeName(k), k]));

function intsForTurns(tune: KV) {
  tune.RADAR1_TURN = Math.max(1, Math.round(tune.RADAR1_TURN ?? DEFAULT_TUNE.RADAR1_TURN));
  tune.RADAR2_TURN = Math.max(tune.RADAR1_TURN + 1, Math.round(tune.RADAR2_TURN ?? DEFAULT_TUNE.RADAR2_TURN));
  // distances rounded to ints
  const roundKeys: Array<keyof typeof DEFAULT_TUNE> = [
    "RELEASE_DIST","STUN_RANGE","SPACING","SPACING_PUSH","BLOCK_RING","DEFEND_RADIUS"
  ];
  for (const k of roundKeys) if (tune[k] != null) tune[k] = Math.round(tune[k]);
}

function fromVector(vec: number[]): TW {
  const need = TUNE_KEYS.length + WEIGHT_KEYS.length;
  if (vec.length < need) {
    throw new Error(`Vector length ${vec.length} < ${need}`);
  }
  const TUNE: KV = { ...DEFAULT_TUNE };
  const WEIGHTS: KV = { ...DEFAULT_WEIGHTS };
  let i = 0;
  for (const k of TUNE_KEYS) TUNE[k] = vec[i++];
  for (const k of WEIGHT_KEYS) WEIGHTS[k] = vec[i++];
  intsForTurns(TUNE);
  return { TUNE, WEIGHTS };
}

function tryFlatObject(o: any): TW | null {
  if (!o || typeof o !== "object") return null;
  const TUNE: KV = { ...DEFAULT_TUNE };
  const WEIGHTS: KV = { ...DEFAULT_WEIGHTS };
  let hitT = 0, hitW = 0;

  for (const [k, v] of Object.entries(o)) {
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const keyN = normalizeName(k);
    const tk = TUNE_LOOKUP.get(keyN);
    if (tk) { TUNE[tk] = v; hitT++; continue; }
    const wk = WEIGHT_LOOKUP.get(keyN);
    if (wk) { WEIGHTS[wk] = v; hitW++; continue; }
  }

  // Accept if we matched at least a few keys, otherwise return null
  if (hitT + hitW >= 4) {
    intsForTurns(TUNE);
    return { TUNE, WEIGHTS };
  }
  return null;
}

function searchVectorDeep(x: any): number[] | null {
  if (isNumberArray(x)) return x.length >= (TUNE_KEYS.length + WEIGHT_KEYS.length) ? x : null;
  if (!x || typeof x !== "object") return null;
  for (const v of Object.values(x)) {
    const found = searchVectorDeep(v);
    if (found) return found;
  }
  return null;
}

function searchTWDeep(x: any): TW | null {
  if (!x || typeof x !== "object") return null;

  // direct shape
  if (x.TUNE && x.WEIGHTS) {
    const flat = tryFlatObject({ ...x.TUNE, ...x.WEIGHTS });
    if (flat) return { TUNE: flat.TUNE, WEIGHTS: flat.WEIGHTS };
  }

  // try child objects recursively
  for (const v of Object.values(x)) {
    if (v && typeof v === "object") {
      // maybe nested TUNE/WEIGHTS inside
      if ((v as any).TUNE && (v as any).WEIGHTS) {
        const flat = tryFlatObject({ ...(v as any).TUNE, ...(v as any).WEIGHTS });
        if (flat) return { TUNE: flat.TUNE, WEIGHTS: flat.WEIGHTS };
      }
      // or a useful flat object
      const fo = tryFlatObject(v);
      if (fo) return fo;
    }
  }

  // try deepest numeric vector
  const vec = searchVectorDeep(x);
  if (vec) return fromVector(vec);

  // finally try treating x itself as flat object
  const fo = tryFlatObject(x);
  if (fo) return fo;

  return null;
}

function coerceToTW(raw: any): TW {
  const tw = searchTWDeep(raw);
  if (!tw) throw new Error("Invalid best_hybrid.json — could not find TUNE/WEIGHTS or a decodable vector");
  return tw;
}

function emitTs(outPath: string, data: TW) {
  const { TUNE, WEIGHTS } = data;
  const header = `/** Auto-generated from CEM best_hybrid.json — do not edit by hand */
export const TUNE = ${JSON.stringify(TUNE, null, 2)} as const;

export const WEIGHTS = ${JSON.stringify(WEIGHTS, null, 2)} as const;
`;
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), header, "utf8");
  console.log(`Wrote -> ${path.resolve(outPath)} (TUNE ${Object.keys(TUNE).length} keys, WEIGHTS ${Object.keys(WEIGHTS).length} keys)`);
}

async function main() {
  const [, , inJson = "artifacts/best_hybrid.json", outTs = "../agents/hybrid-params.ts"] = process.argv;

  const rawTxt = fs.readFileSync(path.resolve(inJson), "utf8");
  const raw = JSON.parse(rawTxt);

  const tw = coerceToTW(raw);
  emitTs(outTs, tw);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});

