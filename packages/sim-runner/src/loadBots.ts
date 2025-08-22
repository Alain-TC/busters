// packages/sim-runner/src/loadBots.ts

import path from "path";

export type Bot = {
  meta?: { name?: string; [k: string]: any };
  act: (ctx: any, obs: any) => any;
};

// Map short names -> real package export specs
export const BOT_ALIASES: Record<string, string> = {
  greedy: "@busters/agents/greedy",
  stunner: "@busters/agents/stunner",
  camper: "@busters/agents/camper",
  "base-camper": "@busters/agents/base-camper",
  "aggressive-stunner": "@busters/agents/aggressive-stunner",
  random: "@busters/agents/random",
  defender: "@busters/agents/defender",
  scout: "@busters/agents/scout",
  hybrid: "@busters/agents/hybrid",
  evolved: "@busters/agents/evolved", // if present in your repo
  hof: "@busters/agents/hof",          // <-- important one
};

function guessNameFromSpec(spec: string) {
  const m = spec.match(/([^/@]+)$/);
  return m ? m[1] : spec;
}

/** Normalize a user token into an importable spec */
export function resolveSpec(token: string): string {
  if (!token) return token;
  if (token.startsWith("hof:")) {
    const tag = token.slice(4);
    const file = tag.endsWith(".js") ? tag : `${tag}.js`;
    return path.resolve(process.cwd(), "../agents/hof", file);
  }
  // if already a path or scoped package, keep as-is
  if (token.startsWith("@") || token.startsWith(".") || token.startsWith("/")) return token;
  // else try alias
  return BOT_ALIASES[token] ?? token;
}

/** Load a bot module by spec or alias */
export async function loadBotModule(specOrAlias: string): Promise<Bot> {
  const spec = resolveSpec(specOrAlias);
  let mod: any;
  try {
    mod = await import(spec);
  } catch (e) {
    // Helpful message if the alias was not resolvable
    const hint = BOT_ALIASES[specOrAlias]
      ? `Resolved "${specOrAlias}" -> "${spec}" but import failed. Check @busters/agents/package.json exports and file existence.`
      : `Unknown bot token "${specOrAlias}". Try one of: ${Object.keys(BOT_ALIASES).join(", ")}, or pass a full module path.`;
    throw new Error(`${(e as Error).message}\n${hint}`);
  }

  const bot: Bot = (mod?.default ?? mod) as Bot;
  if (!bot || typeof bot.act !== "function") {
    throw new Error(`Module "${spec}" does not export a valid bot (missing act).`);
  }
  if (!bot.meta) bot.meta = {};
  if (!bot.meta.name) bot.meta.name = guessNameFromSpec(spec);
  return bot;
}

/** Convenience: load multiple tokens */
export async function loadMany(tokens: string[]): Promise<Bot[]> {
  return Promise.all(tokens.map(loadBotModule));
}

