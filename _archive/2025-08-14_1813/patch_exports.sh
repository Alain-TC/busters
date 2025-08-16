set -euo pipefail
F=packages/sim-runner/src/ga.ts

fix_export () {
  local name="$1"
  if grep -qE "^[[:space:]]*export[[:space:]]+(async[[:space:]]+)?function[[:space:]]+$name\\(" "$F"; then
    echo "✔ $name already exported"
  elif grep -qE "^[[:space:]]*(async[[:space:]]+)?function[[:space:]]+$name\\(" "$F"; then
    sed -i.bak -E "s/^([[:space:]]*)(async[[:space:]]+)?function[[:space:]]+$name\\(/\\1export \\2function $name(/" "$F"
    echo "✅ Added export to $name"
  else
    echo "⚠ Could not find function $name() in $F" >&2
  fi
}

fix_export trainCEM
fix_export buildBaseOppPool
fix_export compileGenomeToJS

echo "Done."
