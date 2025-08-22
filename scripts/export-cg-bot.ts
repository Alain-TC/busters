// scripts/export-cg-bot.ts
// Simple exporter that injects numeric genome parameters into the
// Codingame-compatible bot template. The resulting single-file bot is
// written to `codingame_bot.js` at the repository root.

import fs from "fs";
import path from "path";

type Genome = { radarTurn: number; stunRange: number; releaseDist: number };

function findGenome(): Genome {
  const candidates = [
    "packages/sim-runner/artifacts/simrunner_best_genome.json",
    "artifacts/simrunner_best_genome.json",
  ].map((p) => path.resolve(p));

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const raw = fs.readFileSync(p, "utf-8");
        const j = JSON.parse(raw);
        const g = (j?.best ?? j) as Partial<Genome>;
        if (
          typeof g.radarTurn === "number" &&
          typeof g.stunRange === "number" &&
          typeof g.releaseDist === "number"
        ) {
          return g as Genome;
        }
      } catch {
        // ignore malformed candidates and continue searching
      }
    }
  }
  // Fallback to a known-good genome so the exporter always succeeds.
  return { radarTurn: 23, stunRange: 1766, releaseDist: 1600 };
}

const g = findGenome();

// Inject genome values into the bot template. The template contains the
// placeholders __RADAR__, __STUN__ and __RELEASE__ which are replaced here.
const templatePath = path.resolve("bot_template_cg.js");
const outPath = path.resolve("codingame_bot.js");

let code = fs.readFileSync(templatePath, "utf8");
code = code
  .replace("__RADAR__", String(g.radarTurn))
  .replace("__STUN__", String(g.stunRange))
  .replace("__RELEASE__", String(g.releaseDist))
  // Rename template constant to GENOME for compatibility with existing tooling
  .replace("const G =", "const GENOME =")
  .replace(/\bG\./g, "GENOME.");

fs.writeFileSync(outPath, code, "utf8");
console.log("Wrote Codingame bot ->", outPath);

