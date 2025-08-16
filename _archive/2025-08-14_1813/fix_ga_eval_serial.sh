set -euo pipefail
F=packages/sim-runner/src/ga.ts
awk '
BEGIN{repl=0}
# When we reach evalGenomeSerial, print a fresh implementation and start skipping
/^async function evalGenomeSerial\(/ {
  print "async function evalGenomeSerial(g: Genome, opts: CEMOpts) {";
  print "  let total = 0;";
  print "  for (let si = 0; si < opts.seedsPer; si++) {";
  print "    const seed = opts.seed + si;";
  print "    const opp = opts.oppPool[si % opts.oppPool.length].bot;";
  print "    const me  = genomeToBot(g);";
  print "    const res = await runEpisodes({";
  print "      seed,";
  print "      episodes: opts.episodesPerSeed,";
  print "      bustersPerPlayer: 3,";
  print "      ghostCount: 12,";
  print "      botA: me,";
  print "      botB: opp";
  print "    });";
  print "    total += (res.scoreA - res.scoreB);";
  print "  }";
  print "  return total / opts.seedsPer;";
  print "}";
  repl=1; next
}
# Stop skipping right before the next function and print that line too
repl==1 && /^async function evalGenomeParallel\(/ { repl=0; print; next }
# Otherwise, print lines normally
repl==0 { print }
' "$F" > "$F.tmp" && mv "$F.tmp" "$F"
echo "Patched evalGenomeSerial in $F"
