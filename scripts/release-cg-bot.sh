#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ART1="$ROOT/packages/sim-runner/artifacts/simrunner_best_genome.json"
ART2="$ROOT/artifacts/simrunner_best_genome.json"

# 1) Pick genome (packages path preferred; fallback to /artifacts)
if [[ -f "$ART1" ]]; then
  GENOME="$ART1"
elif [[ -f "$ART2" ]]; then
  GENOME="$ART2"
else
  echo "!! No genome found. Run training first."
  exit 1
fi

# 2) Snapshot genome with timestamp
STAMP="$(date -u +"%Y%m%dT%H%M%SZ")"
SNAP="$ROOT/artifacts/genome_${STAMP}.json"
cp "$GENOME" "$SNAP"

# 3) (Re)export bot (writes my_cg_bot.js at repo root)
pnpm -s make:cg

# 4) Versioned copy in dist/cg with short genome signature for traceability
RADAR="$(jq -r '.best.radarTurn // .radarTurn' "$SNAP" 2>/dev/null || echo 0)"
STUN="$(jq -r '.best.stunRange // .stunRange' "$SNAP" 2>/dev/null || echo 0)"
REL="$(jq -r '.best.releaseDist // .releaseDist' "$SNAP" 2>/dev/null || echo 0)"
OUT="$ROOT/dist/cg/my_cg_bot_${STAMP}_rt${RADAR}_sr${STUN}_rd${REL}.js"
mkdir -p "$ROOT/dist/cg"
cp "$ROOT/my_cg_bot.js" "$OUT"

# 5) Checksums for provenance
( cd "$ROOT/dist/cg" && shasum -a 256 "$(basename "$OUT")" > "$(basename "$OUT").sha256" )

echo "== Release =="
echo "Genome snapshot : $SNAP"
echo "CG bot          : $OUT"
echo "SHA256          : $(cat "${OUT}.sha256" | cut -d' ' -f1)"
echo "Next:"
echo "  • Paste $OUT in the Codingame IDE"
echo "  • Run: pnpm tourney:smoke   (quick RR)"
echo "  • Open viewer: pnpm viewer  (http://localhost:5173)"
