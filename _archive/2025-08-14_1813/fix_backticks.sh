set -euo pipefail

GA=packages/sim-runner/src/ga.ts

# 1) Replace the template-literal console.log with plain concatenation
# (safe if it already changed; sed will just not match)
sed -i '' \
  -e 's|console\.log(`CEM gen .* (jobs=.*)`);|console.log("CEM gen " + gen + ": best=" + genBestFit.toFixed(2) + " m=[" + m.map(x => Math.round(x)).join(",") + "] (jobs=" + jobs + ")");|' \
  "$GA" || true

# 2) Drop the old compileGenomeToJS body and append a backtick-free version
#    Delete from the function signature to EOF, then append a safe implementation.
awk '
  BEGIN{ drop=0 }
  /^export function compileGenomeToJS\(/ { drop=1 }
  drop==0 { print }
' "$GA" > "$GA.tmp"

cat >> "$GA.tmp" <<'TS'
export function compileGenomeToJS(inPath: string, outPath: string) {
  const absIn = path.resolve(process.cwd(), inPath);
  if (!fs.existsSync(absIn)) throw new Error('Genome JSON not found: ' + absIn);
  const g = JSON.parse(fs.readFileSync(absIn, 'utf-8')) as Genome;

  const codeLines = [
    '/** Auto-generated single-file bot from genome */',
    'export const meta = { name: "EvolvedBot", version: "ga" };',
    'export function act(ctx, obs) {',
    '  if (obs.self.carrying !== undefined) {',
    '    const d = Math.hypot(obs.self.x - ctx.myBase.x, obs.self.y - ctx.myBase.y);',
    '    if (d <= ' + String(g.releaseDist) + ') return { type: "RELEASE" };',
    '    return { type: "MOVE", x: ctx.myBase.x, y: ctx.myBase.y };',
    '  }',
    '  const enemy = obs.enemies?.[0];',
    '  if (enemy && enemy.range <= ' + String(g.stunRange) + ' && obs.self.stunCd <= 0) return { type: "STUN", busterId: enemy.id };',
    '  const ghost = obs.ghostsVisible?.[0];',
    '  if (ghost) {',
    '    if (ghost.range >= 900 && ghost.range <= 1760) return { type: "BUST", ghostId: ghost.id };',
    '    return { type: "MOVE", x: ghost.x, y: ghost.y };',
    '  }',
    '  if (!obs.self.radarUsed && obs.tick >= ' + String(g.radarTurn) + ') return { type: "RADAR" };',
    '  return { type: "MOVE", x: ctx.myBase.x, y: ctx.myBase.y };',
    '}',
    ''
  ];
  const code = codeLines.join('\n');
  const absOut = path.resolve(process.cwd(), outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, code);
  console.log('Wrote single-file bot -> ' + absOut);
}
TS

mv "$GA.tmp" "$GA"

echo "✅ Fixed backticks in ga.ts (console.log + compileGenomeToJS)."
