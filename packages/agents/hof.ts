/** Hall-of-Fame export for training opp-pool.
 * Default = latest champion snapshot (if present),
 * otherwise falls back to the tuned Hybrid.
 */

import * as Hybrid from "./hybrid-bot";

type Bot = { meta: any; act: (ctx: any, obs: any) => any };

function normalize(mod: any): Bot {
  const m = mod?.default ?? mod;
  const meta = m?.meta ?? { name: "HOF" };
  const act = typeof m?.act === "function" ? m.act : Hybrid.act;
  return { meta, act };
}

// Start with Hybrid as the safe fallback
let chosen: Bot = normalize(Hybrid);

try {
  // If you previously exported a champion with --export-champ, prefer it
  const mod = await import("./champion-bot.js");
  const champ = normalize(mod);
  if (typeof champ.act === "function") chosen = champ;
} catch {
  // No champion present; keep Hybrid
}

// Re-export in both styles (named + default) so any loader is happy
export const meta = { name: `HOF(${chosen.meta?.name ?? "?"})`, ...chosen.meta };
export function act(ctx: any, obs: any) {
  return chosen.act(ctx, obs);
}
export default { meta, act };

// Optional: list for future multi-snapshot HOF logic
export const candidates = [{ meta, act }];
export function random() {
  return candidates[0];
}

