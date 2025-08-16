set -euo pipefail
F=packages/sim-runner/src/ga.ts
node - <<'JS'
const fs=require('fs'); const p='packages/sim-runner/src/ga.ts';
let s=fs.readFileSync(p,'utf8');

/* 1) In evalGenomeParallel: make HoF usage depend only on seed (CRNs) */
s=s.replace(
  /const useHof\s*=\s*\(HOF\.length\s*&&\s*\(\(\(\(gi\s*\*\s*73856093\)\s*\^\s*seed\)\s*>>>?\s*0\)\s*%\s*10\)\s*<\s*4\)\s*;\s*[\r\n]+const opponent\s*=\s*useHof\s*\?[^;]+;/m,
  `const useHof = (HOF.length && ((seed >>> 0) % 10) < 4);
      const opponent = useHof
        ? { type: 'genome', genome: HOF[seed % HOF.length] }
        : { type: 'module', spec: baseSpec };`
);

/* 2) Insert CSV logging (metrics.csv) right before the console.log of each gen */
s=s.replace(
  /console\.log\(`CEM gen \$\{gen\}:[^`]+`\);/m,
  `
    // --- metrics: mean fitness + CSV ---
    const meanFit = fits.reduce((a,b)=>a+b,0)/Math.max(1,fits.length);
    const csvPath = path.join(artDir, 'metrics.csv');
    if (!fs.existsSync(csvPath)) {
      fs.writeFileSync(csvPath, 'gen,best,mean,m0,m1,m2,s0,s1,s2,hof\\n');
    }
    fs.appendFileSync(
      csvPath,
      [
        gen,
        genBestFit.toFixed(4),
        meanFit.toFixed(4),
        ...m.map(v=>Math.round(v)),
        ...s.map(v=>Math.round(v)),
        HOF.length
      ].join(',') + '\\n'
    );

    console.log(\`CEM gen \${gen}: best=\${genBestFit.toFixed(2)} m=[\${m.map(x=>Math.round(x)).join(',')}] (jobs=\${jobs})\`);
  `
);

fs.writeFileSync(p,s);
console.log('✅ Patched CRNs (seed-only HoF) + CSV metrics to artifacts/metrics.csv');
JS
