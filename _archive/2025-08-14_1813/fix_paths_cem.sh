#!/usr/bin/env bash
set -euo pipefail
FILE="packages/sim-runner/src/cli.ts"
# Replace the bad compile path used after training with a CWD-safe one
perl -0777 -pe \
 's/compileGenomeToJS\([^)]*simrunner_best_genome\.json[^)]*\);/compileGenomeToJS(\x27artifacts\/simrunner_best_genome.json\x27, \x27..\/agents\/evolved-bot.js\x27);/s' \
 -i "$FILE"
echo "Patched $FILE. Re-run training with pnpm -C packages/sim-runner start train ..."
