set -euo pipefail

# 1) Remove the legacy self-registering worker bootstrap (mjs)
rm -f packages/sim-runner/src/workerEval.mjs || true

# 2) Ensure the TS worker doesn't import tsx/register
sed -i.bak -E "/tsx\/register/d" packages/sim-runner/src/workerEval.ts || true

# 3) Normalize worker spawn to ESM + --import tsx/esm and drop any --loader tsx
node - <<'NODE'
const fs = require('fs');
const p = 'packages/sim-runner/src/ga.ts';
let s = fs.readFileSync(p,'utf8');

// drop any --loader ...tsx... occurrences
s = s.replace(/(['"]--loader['"][^,\]\)]*)/g, '');

// force a clean worker spawn that points at workerEval.ts with ESM + --import tsx/esm
s = s.replace(
  /new\s+Worker\([^)]*workerEval\.(?:ts|mjs)[^)]*\)/g,
  `new Worker(new URL('./workerEval.ts', import.meta.url), { type: 'module', execArgv: ['--import','tsx/esm'] })`
);

fs.writeFileSync(p,s);
console.log('Patched '+p);
NODE

# 4) Show any remaining offenders
echo "=== scanning for leftover loader/register lines ==="
( command -v rg >/dev/null 2>&1 && rg -n "tsx/register|--loader.*tsx|Hooks\\.register|register\\(\"tsx\"" packages/sim-runner/src || \
  grep -RniE "tsx/register|--loader.*tsx|Hooks\\.register|register\\(\"tsx\"" packages/sim-runner/src || true )
