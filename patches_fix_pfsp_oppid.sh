#!/usr/bin/env bash
set -euo pipefail

FILE="packages/sim-runner/src/ga.ts"
cp "$FILE" "$FILE.bak.pfsp_oppid"

# Replace the block after pickOpponentPFSP to construct a concrete opponent,
# derive a stable oppId, and log the pick with that oppId.
perl -0777 -i -pe '
  s|
    const\ picked\ =\ pickOpponentPFSP\(elo,\ cands\);\s*
    (?:.*\n){0,12}?           # old oppId/opponent lines (variable across your edits)
    const\ opponent\ = [^\n]*\n
  |
    const picked = pickOpponentPFSP(elo, cands);

// Build the concrete opponent and a stable oppId from it
let opponent: any;
let oppId: string;

if (picked.type === "module") {
  const spec = (picked as any).spec ?? (picked as any).id ?? "@busters/agents/greedy";
  opponent = { type: "module", spec };
  oppId = spec;
} else {
  const g: any = (picked as any).genome ?? (picked as any).g;
  if (g && typeof g.radarTurn === "number" && typeof g.stunRange === "number" && typeof g.releaseDist === "number") {
    oppId = `hof:${g.radarTurn},${g.stunRange},${g.releaseDist}`;
    opponent = { type: "genome", genome: g, tag: oppId };
  } else {
    // Fallback to a module opponent if PFSP returned a genome without payload
    const spec = (picked as any).id ?? "@busters/agents/greedy";
    opponent = { type: "module", spec };
    oppId = spec;
  }
}

// Log the pick with the resolved oppId (ignore if logger isn\'t present)
try {
  logPFSPPick({
    ts: new Date().toISOString(),
    phase: "parallel",
    gi,
    seed: baseSeed,
    oppId,
    opp: opponent.type === "module"
      ? { type: "module", spec: (opponent as any).spec }
      : { type: "genome", tag: oppId }
  });
} catch {}

  |x
' "$FILE"

echo "✅ Patched PFSP oppId resolution and pick logging in $FILE"
echo "Backup at: $FILE.bak.pfsp_oppid"
