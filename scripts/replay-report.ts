// packages/sim-runner/scripts/replay-report.ts
import fs from 'fs';
import path from 'path';

function sumCounts(a?: Record<string, number>, b?: Record<string, number>) {
  const out: Record<string, number> = {};
  for (const src of [a || {}, b || {}]) {
    for (const [k, v] of Object.entries(src)) out[k] = (out[k] ?? 0) + (v as number);
  }
  return out;
}

function sortTop(obj: Record<string, number>, k = 10) {
  return Object.entries(obj).sort((x, y) => y[1] - x[1]).slice(0, k);
}

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error('Usage: tsx scripts/replay-report.ts <replay.json>');
    process.exit(1);
  }
  const abs = path.resolve(file);
  const j = JSON.parse(fs.readFileSync(abs, 'utf8'));

  const frames = j.frames ?? j; // tolerate old format
  const summary = j.summary ?? null;

  let A: Record<string, number> = {};
  let B: Record<string, number> = {};

  for (const f of frames) {
    A = sumCounts(A, f.tagsA);
    B = sumCounts(B, f.tagsB);
  }

  console.log(`Replay: ${abs}\n`);

  if (summary) {
    console.log(`Summary: ${summary.botA} vs ${summary.botB} (seed=${summary.seed}, episodes=${summary.episodes})`);
    console.log(`Final scores: A=${summary.scoreA}  B=${summary.scoreB}\n`);
  } else {
    // Fallback: try last frame’s scoreboard
    const last = frames[frames.length - 1] || {};
    console.log(`Final scores (last frame):`, last.scores, '\n');
  }

  const topA = sortTop(A);
  const topB = sortTop(B);

  console.log('Top tags A:');
  for (const [k, v] of topA) console.log(`  ${k.padEnd(12)} : ${v}`);
  console.log('\nTop tags B:');
  for (const [k, v] of topB) console.log(`  ${k.padEnd(12)} : ${v}`);

  // Key totals (compat with your previous headings)
  const key = (obj: Record<string, number>, ...keys: string[]) =>
    keys.reduce((s, k) => s + (obj[k] ?? 0), 0);

  console.log('\nKey totals (A):');
  console.log(`  STUNs          : ${key(A, 'STUN')}`);
  console.log(`  BUST on ring   : ${key(A, 'BUST_RING')}`);
  console.log(`  RADARs         : ${key(A, 'RADAR')}`);
  console.log(`  INTERCEPT moves: ${key(A, 'INTERCEPT')}`);
  console.log(`  BLOCK moves    : ${key(A, 'BLOCK')}`);
  console.log(`  DEFEND moves   : ${key(A, 'DEFEND')}`);

  console.log('\nKey totals (B):');
  console.log(`  STUNs          : ${key(B, 'STUN')}`);
  console.log(`  BUST on ring   : ${key(B, 'BUST_RING')}`);
  console.log(`  RADARs         : ${key(B, 'RADAR')}`);
  console.log(`  INTERCEPT moves: ${key(B, 'INTERCEPT')}`);
  console.log(`  BLOCK moves    : ${key(B, 'BLOCK')}`);
  console.log(`  DEFEND moves   : ${key(B, 'DEFEND')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

