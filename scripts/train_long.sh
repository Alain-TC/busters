#!/usr/bin/env bash
set -euo pipefail

# ========= Defaults =========
POP=32
GENS=40
SEEDS_PER=6
EPS_PER_SEED=3
SEED=123
HOF=8
JOBS="auto"
OPP_POOL="greedy,random,camper,stunner,base-camper,aggressive-stunner"
ART_DIR="packages/sim-runner/artifacts"
RESET_ELO=0
TAG="run"
SUBJECT="hybrid"
REQUIRE_PFSP_LOG=${REQUIRE_PFSP_LOG:-0}

# ========= Args =========
while [[ $# -gt 0 ]]; do
  case "$1" in
    --pop) POP="$2"; shift 2 ;;
    --gens) GENS="$2"; shift 2 ;;
    --seeds-per) SEEDS_PER="$2"; shift 2 ;;
    --eps-per-seed|--eps) EPS_PER_SEED="$2"; shift 2 ;;
    --seed) SEED="$2"; shift 2 ;;
    --hof) HOF="$2"; shift 2 ;;
    --jobs) JOBS="$2"; shift 2 ;;
    --opp-pool) OPP_POOL="$2"; shift 2 ;;
    --reset-elo) RESET_ELO=1; shift ;;
    --tag) TAG="$2"; shift 2 ;;
    --subject) SUBJECT="$2"; shift 2 ;;
    --require-pfsp-log) REQUIRE_PFSP_LOG=1; shift ;;
    -h|--help)
      cat <<USAGE
Usage: scripts/train_long.sh [options]

Options:
  --pop N              population size (default: $POP)
  --gens N             generations (default: $GENS)
  --seeds-per N        distinct base seeds per genome (default: $SEEDS_PER)
  --eps-per-seed N     episodes per seed (default: $EPS_PER_SEED)
  --seed N             master RNG seed (default: $SEED)
  --hof N              Hall-of-Fame size (default: $HOF)
  --jobs N|auto        parallel workers (default: auto)
  --opp-pool list      comma list of opponents (default: $OPP_POOL)
  --subject NAME       training subject (default: $SUBJECT)
  --reset-elo          delete Elo + PFSP logs before training
  --tag NAME           label for saved outputs (default: $TAG)
  --require-pfsp-log   fail if PFSP log is missing
  -h, --help           show this help
USAGE
      exit 0 ;;
    *)
      echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# ========= Helpers =========
cpu_count() {
  if command -v nproc >/dev/null 2>&1; then nproc
  elif command -v sysctl >/dev/null 2>&1; then sysctl -n hw.ncpu
  else echo 8
  fi
}

if [[ "$JOBS" == "auto" ]]; then JOBS="$(cpu_count)"; fi
TS="$(date +%Y%m%d-%H%M%S)"
PFSP_LOG="$ART_DIR/pfsp_log_${TS}_${TAG}.jsonl"

# ========= Prep =========
mkdir -p "$ART_DIR"

if [[ "$RESET_ELO" == "1" ]]; then
  echo ">> Resetting Elo & PFSP logs in $ART_DIR"
  rm -f "$ART_DIR/elo.json" "$PFSP_LOG"
fi

echo ">> Starting training"
echo "   pop=$POP gens=$GENS seedsPer=$SEEDS_PER epsPerSeed=$EPS_PER_SEED jobs=$JOBS seed=$SEED"
echo "   oppPool=$OPP_POOL hof=$HOF subject=$SUBJECT"

# ========= Train =========
PFSP_LOG_PATH="$PFSP_LOG" pnpm -C packages/sim-runner start train \
  --algo cem \
  --pop "$POP" --gens "$GENS" \
  --seeds-per "$SEEDS_PER" --eps-per-seed "$EPS_PER_SEED" \
  --jobs "$JOBS" --seed "$SEED" \
  --opp-pool "$OPP_POOL" \
  --hof "$HOF" \
  --subject "$SUBJECT"

# ========= Reports =========
echo ">> PFSP report"
SUMMARY_FILE="$ART_DIR/pfsp_summary_${TS}_${TAG}.txt"
if [[ -f "$PFSP_LOG" ]]; then
  pnpm pfsp:report "$PFSP_LOG" | tee "$SUMMARY_FILE"
else
  echo "NOTICE: PFSP log $PFSP_LOG not found; skipping report"
  if [[ "$REQUIRE_PFSP_LOG" == "1" ]]; then
    exit 1
  fi
fi

# ========= Artifacts / Exports =========
case "$SUBJECT" in
  hybrid)
    BEST_ART="$ART_DIR/best_hybrid.json"
    BEST_SNAP="$ART_DIR/best_hybrid.${TS}.${TAG}.json"
    BEST_MSG="Best hybrid params snapshot"
    ;;
  *)
    BEST_ART="$ART_DIR/simrunner_best_genome.json"
    BEST_SNAP="$ART_DIR/simrunner_best_genome.${TS}.${TAG}.json"
    BEST_MSG="Best genome snapshot"
    ;;
esac

TOP_BOT="agents/evolved-bot.js"
CG_BOT="agents/evolved-bot.cg.js"

if [[ -f "$TOP_BOT" ]]; then
  echo ">> Exporting CodinGame-compatible bot via scripts/export-codingame.ts -> $CG_BOT"
  if [[ "$SUBJECT" == "hybrid" ]]; then
    pnpm tsx scripts/export-codingame.ts --from hybrid --weights "$BEST_ART" --out "$CG_BOT"
  else
    pnpm tsx scripts/export-codingame.ts --from genome --out "$CG_BOT"
  fi
  # Timestamped backups of both ESM & CG variants
  cp "$TOP_BOT" "agents/evolved-bot.${TS}.${TAG}.js"
  cp "$CG_BOT" "agents/evolved-bot.${TS}.${TAG}.cg.js"
else
  echo "WARN: $TOP_BOT not found — did training generate it?"
fi

if [[ -f "$BEST_ART" ]]; then
  cp "$BEST_ART" "$BEST_SNAP"
  echo ">> $BEST_MSG -> $BEST_SNAP"
fi

echo
echo "=== DONE ==="
echo "Jobs     : $JOBS"
echo "PFSP sum : $SUMMARY_FILE"
echo "PFSP log : $PFSP_LOG"
echo "Bot (ESM): $TOP_BOT"
echo "Bot (CG) : $CG_BOT"
