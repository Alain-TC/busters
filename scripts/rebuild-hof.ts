import fs from "fs";
import path from "path";
import { compileGenomeToJS } from "../packages/sim-runner/src/ga";

const artDir = path.resolve("packages/sim-runner/artifacts");
const outDir = path.resolve("packages/agents/hof");

fs.mkdirSync(outDir, { recursive: true });

const existing = fs.readdirSync(outDir).filter(f => f.endsWith('.js'));
for (const f of existing) fs.unlinkSync(path.join(outDir, f));

const files = fs.readdirSync(artDir).filter(f => f.startsWith("genome_") && f.endsWith(".json"));
if (files.length === 0) {
  console.error(`No genome artifacts found in ${artDir}`);
  process.exit(1);
}

for (const file of files) {
  const tag = file.replace(/^genome_/, '').replace(/\.json$/, '');
  const inPath = path.join(artDir, file);
  const outPath = path.join(outDir, `${tag}.js`);
  compileGenomeToJS(inPath, outPath);
}

console.log(`Rebuilt HoF opponent pool -> ${outDir}`);
