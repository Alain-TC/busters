import path from "path";
import { pathToFileURL, fileURLToPath } from "url";

export type BotModule = { act: Function; meta?: any };

const hereDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(hereDir, "../../..");
const agentsDir = path.join(repoRoot, "packages", "agents");

const NAMED: Record<string, string> = {
  greedy: path.join(agentsDir, "greedy-buster.js"),
  random: path.join(agentsDir, "random-bot.js"),
  evolved: path.join(agentsDir, "evolved-bot.js"),
};

export async function loadBotModule(spec: string): Promise<BotModule> {
  const mapped = NAMED[spec];
  if (mapped) spec = mapped;

  const isFileLike =
    spec.startsWith("./") ||
    spec.startsWith("../") ||
    spec.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(spec) ||
    spec.startsWith("file:");

  let mod: any;
  if (isFileLike) {
    const href = spec.startsWith("file:")
      ? spec
      : pathToFileURL(path.isAbsolute(spec) ? spec : path.resolve(process.cwd(), spec)).href;
    mod = await import(href);
  } else {
    mod = await import(spec);
  }

  const candidate = mod?.default?.act ? mod.default : mod;
  if (!candidate?.act) throw new Error(`No act() export found in ${spec}`);
  return candidate;
}
