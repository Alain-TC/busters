set -euo pipefail
F=packages/sim-runner/src/ga.ts

# If an un-exported compileGenomeToJS exists, delete it (we'll re-add a clean one)
if grep -q 'function compileGenomeToJS(' "$F" && ! grep -q 'export function compileGenomeToJS(' "$F"; then
  # delete old implementation block (function .. up to the next top-level closing brace)
  awk '
    BEGIN{skip=0}
    /^function compileGenomeToJS\(/ {skip=1; next}
    skip==1 && /^\}/ {skip=0; next}
    skip==0 {print}
  ' "$F" > "$F.tmp" && mv "$F.tmp" "$F"
fi

# If there is no exported compileGenomeToJS, append a clean implementation
if ! grep -q 'export function compileGenomeToJS(' "$F"; then
  cat >> "$F" <<'TS'

// ==== Exporter (single-file bot from genome JSON) ====
export function compileGenomeToJS(inPath: string, outPath: string) {
  const absIn = path.resolve(process.cwd(), inPath);
  if (!fs.existsSync(absIn)) throw new Error(`Genome JSON not found: ${absIn}`);
  const g = JSON.parse(fs.readFileSync(absIn, 'utf-8')) as Genome;

  const lines = [
    "/** Auto-generated single-file bot from genome */",
    "export const meta = { name: \"EvolvedBot\", version: \"ga\" };",
    "export function act(ctx, obs) {",
    "  if (obs.self.carrying !== undefined) {",
    "    const d = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);",
    `    if (d <= ${g.releaseDist}) return { type: "RELEASE" };`,
    "    return { type: \"MOVE\", x: ctx.myBase.x, y: ctx.myBase.y };",
    "  }",
    "  const enemy = obs.enemies?.[0];",
    `  if (enemy && enemy.range <= ${g.stunRange} && obs.self.stunCd <= 0) return { type: "STUN", busterId: enemy.id };`,
    "  const ghost = obs.ghostsVisible?.[0];",
    "  if (ghost) {",
    "    if (ghost.range >= 900 && ghost.range <= 1760) return { type: \"BUST\", ghostId: ghost.id };",
    "    return { type: \"MOVE\", x: ghost.x, y: ghost.y };",
    "  }",
    `  if (!obs.self.radarUsed && obs.tick >= ${g.radarTurn}) return { type: "RADAR" };`,
    "  return { type: \"MOVE\", x: ctx.myBase.x, y: ctx.myBase.y };",
    "}",
    ""
  ];
  const code = lines.join("\n");
  const absOut = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, code);
  console.log(`Wrote single-file bot -> ${absOut}`);
}
TS
  echo "Appended exported compileGenomeToJS to $F"
else
  echo "compileGenomeToJS already exported in $F"
fi
