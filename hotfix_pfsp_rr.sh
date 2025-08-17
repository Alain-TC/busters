set -euo pipefail
f="packages/sim-runner/src/ga.ts"
cp "$f" "$f.bak.hotfix_rr"

# 1) Injecte un petit helper juste après l'import de elo
awk '
  BEGIN{done=0}
  {
    print $0
    if (!done && $0 ~ /from ..\/elo/ ) {
      print ""
      print "// HOTFIX: PFSP tie-break -> round-robin déterministe par (gi, seed)"
      print "function pickOpponentRoundRobin(cands: PFSPCandidate[], gi: number, seed: number) {"
      print "  if (!cands || !cands.length) throw new Error(\"PFSP: no candidates\");"
      print "  const idx = Math.abs(((gi|0) * 1315423911) ^ ((seed|0) * 2654435761)) % cands.length;"
      print "  return cands[idx];"
      print "}"
      print ""
      done=1
    }
  }' "$f" > "$f.tmp" && mv "$f.tmp" "$f"

# 2) Dans evalGenomeSerial: remplacer PFSP par RR(gi=0, baseSeed)
perl -0777 -pe '
  s/(async function evalGenomeSerial[\s\S]*?const\s+cands\s*=\s*[^\n]+;\s*\n\s*)const\s+picked\s*=\s*pickOpponentPFSP\(elo,\s*cands\);\s*/$1const picked = pickOpponentRoundRobin(cands, 0, baseSeed);\n/s
' "$f" > "$f.tmp" && mv "$f.tmp" "$f"

# 3) Dans evalGenomeParallel: remplacer PFSP par RR(gi, baseSeed)
perl -0777 -pe '
  s/(async function evalGenomeParallel[\s\S]*?const\s+cands\s*=\s*[^\n]+;\s*\n\s*)const\s+picked\s*=\s*pickOpponentPFSP\(elo,\s*cands\);\s*/$1const picked = pickOpponentRoundRobin(cands, gi, baseSeed);\n/s
' "$f" > "$f.tmp" && mv "$f.tmp" "$f"

echo "✅ Hotfix appliqué. Backup: $f.bak.hotfix_rr"
