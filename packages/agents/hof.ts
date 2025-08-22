/** Hall-of-Fame export for training opp-pool.
 * Default = latest champion snapshot (if present),
 * otherwise falls back to the tuned Hybrid.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as Hybrid from "./hybrid-bot";
import { HybridState } from "./lib/state";

type Bot = { meta: any; act: (ctx: any, obs: any, state?: HybridState) => any };

function normalize(mod: any): Bot {
  const m = mod?.default ?? mod;
  const meta = m?.meta ?? { name: "HOF" };
  const act = typeof m?.act === "function" ? m.act : Hybrid.act;
  return { meta, act };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cand: Bot[] = [];

try {
  const files = fs.readdirSync(__dirname)
    .filter(f => f.startsWith("champion-bot") && f.endsWith(".js"));
  for (const f of files) {
    try {
      const mod = await import(`./${f}?v=${Date.now()}${Math.random()}`);
      cand.push(normalize(mod));
    } catch {
      // ignore broken snapshot
    }
  }
} catch {
  // ignore fs errors
}

if (!cand.length) cand.push(normalize(Hybrid));
let chosen: Bot = cand[Math.floor(Math.random() * cand.length)];
let state: HybridState | undefined;

export const candidates = cand;
export function random() {
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export const meta = { name: `HOF(${chosen.meta?.name ?? "?"})`, ...chosen.meta };
export function act(ctx: any, obs: any) {
  state ??= new HybridState(ctx?.bounds);
  return chosen.act(ctx, obs, state);
}
export default { meta, act };

