set -euo pipefail

# 1) Patch ga.ts to derive env from seed and pass to runEpisodes / worker
node - <<'JS'
const fs=require('fs'), p='packages/sim-runner/src/ga.ts';
let s=fs.readFileSync(p,'utf8');

// helper snippet to derive env from a seed (CRN)
const ENV_SNIPPET = `
    // CRN env from seed
    const r = (seed * 1103515245 + 12345) >>> 0;
    const bpp = 2 + (r % 3);                 // 2..4
    const ghostCount = 8 + ((r >>> 3) % 21); // 8..28
`;

//
// Serial evaluator: insert env + pass to runEpisodes
//
s = s.replace(
  /const seed = opts\.seed \+ si;\s*\n\s*const base = opts\.oppPool\[si % opts\.oppPool\.length\]\.bot;/,
  (m)=> m + ENV_SNIPPET
);
s = s.replace(
  /runEpisodes\(\{\s*seed,\s*episodes:\s*opts\.episodesPerSeed,\s*bustersPerPlayer:\s*3,\s*ghostCount:\s*12,/,
  `runEpisodes({ seed, episodes: opts.episodesPerSeed, bustersPerPlayer: bpp, ghostCount,`
);

//
// Parallel evaluator: compute env per task and send to worker
//
s = s.replace(
  /const tasks: Task\[\] = \[\];/,
  `type Env = { bpp:number; ghostCount:number };
  const tasks: Task[] = [];`
);
s = s.replace(
  /type Task = \{ jid: number; gi: number; seed: number; opponent: any \};/,
  `type Task = { jid: number; gi: number; seed: number; opponent: any; env: Env };`
);
s = s.replace(
  /const opponent = useHof[\s\S]*?;\s*tasks\.push\(\{ jid: jid\+\+, gi, seed, opponent \}\);/,
  `const opponent = useHof
        ? { type: 'genome', genome: HOF[seed % HOF.length] }
        : { type: 'module', spec: baseSpec };
      // env from seed (CRN)
      const r = (seed * 1103515245 + 12345) >>> 0;
      const env = { bpp: 2 + (r % 3), ghostCount: 8 + ((r >>> 3) % 21) };
      tasks.push({ jid: jid++, gi, seed, opponent, env });`
);
s = s.replace(
  /w\.postMessage\(\{\s*id:\s*t\.jid,\s*genome:\s*pop\[t\.gi\],\s*seed:\s*t\.seed,\s*episodes:\s*opts\.episodesPerSeed,\s*opponent:\s*t\.opponent\s*\}\);/,
  `w.postMessage({
          id: t.jid,
          genome: pop[t.gi],
          seed: t.seed,
          episodes: opts.episodesPerSeed,
          opponent: t.opponent,
          env: t.env
        });`
);

// tweak the per-gen log to advertise env randomization (informational only)
s = s.replace(
  /console\.log\(`CEM gen \$\{gen\}:[^`]+`\);/,
  `console.log(\`CEM gen \${gen}: best=\${genBestFit.toFixed(2)} m=[\${m.map(x=>Math.round(x)).join(',')}] (jobs=\${jobs}) env=CRN(bpp 2-4, ghosts 8-28)\`);`
);

fs.writeFileSync(p,s);
console.log('✅ Patched ga.ts for CRN env (bpp & ghosts) in serial and parallel paths.');
JS

# 2) Patch worker to receive env and pass to runEpisodes
node - <<'JS'
const fs=require('fs'), p='packages/sim-runner/src/workerEval.ts';
let s=fs.readFileSync(p,'utf8');

s = s.replace(
  /runEpisodes\(\{\s*seed:\s*msg\.seed,\s*episodes:\s*msg\.episodes,\s*bustersPerPlayer:\s*3,\s*ghostCount:\s*12,/,
  `runEpisodes({ seed: msg.seed, episodes: msg.episodes, bustersPerPlayer: (msg.env?.bpp ?? 3), ghostCount: (msg.env?.ghostCount ?? 12),`
);

fs.writeFileSync(p,s);
console.log('✅ Patched workerEval.ts to consume env from message.');
JS

echo 'Done.'
