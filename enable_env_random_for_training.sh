set -euo pipefail

# 1) Patch runEpisodes.ts to support -1 = "randomize per episode (seeded)"
perl -0777 -i.bak -pe '
  s|export async function runEpisodes\(([^)]*)\)\s*\{|export async function runEpisodes($1){\n  // --- env sampler ---\n  function sfc32(a,b,c,d){return function(){a|=0;b|=0;c|=0;d|=0;var t=(a+b|0)+d|0;d=d+1|0;a=b^b>>>9;b=c+(c<<3)|0;c=(c<<21|c>>>11);c=c+(t|0)|0;return((t>>>0) / 4294967296)};}\n  function mix(n){let x=2166136261>>>0; x^=n+0x9e3779b9+(x<<6)+(x>>>2); return x>>>0}\n  function sampleEnv(seed, ep){ const rng=sfc32(mix(seed),mix(ep),mix(seed^0xA5A5),mix(ep^0x5A5A));\n    const bpp = 2 + Math.floor(rng()*3);            // 2..4\n    const ghosts = 8 + Math.floor(rng()*21);        // 8..28\n    const endset = [3,15,40]; const endurance = endset[Math.floor(rng()*endset.length)];\n    return { bpp, ghosts, endurance };\n  }|s;

  s|for\s*\(\s*let\s+ep\s*=.*?\)\s*\{\s*//\s*start episode|for (let ep = 0; ep < episodes; ep++) { // start episode\n    const _seed = (seed ?? 0) + ep;\n    const useRand = (bustersPerPlayer === -1 || ghostCount === -1 || (typeof (globalThis as any).endurance !== "number" && true));\n    const env = sampleEnv(_seed, ep);\n    const _bpp = (bustersPerPlayer === -1) ? env.bpp : bustersPerPlayer;\n    const _ghosts = (ghostCount === -1) ? env.ghosts : ghostCount;\n    const _endurance = (typeof (globalThis as any).endurance === "number") ? (globalThis as any).endurance : env.endurance;|s;

  s|\bbustersPerPlayer:\s*\w+,\s*\n\s*ghostCount:\s*\w+,\s*\n|bustersPerPlayer: _bpp,\n      ghostCount: _ghosts,\n      endurance: _endurance,\n|s;
' packages/sim-runner/src/runEpisodes.ts

# 2) Make CEM/worker pass -1 flags (=randomize per episode)
perl -0777 -i.bak -pe 's/bustersPerPlayer:\s*3/bustersPerPlayer: -1/g; s/ghostCount:\s*12/ghostCount: -1/g' packages/sim-runner/src/ga.ts
perl -0777 -i.bak -pe 's/bustersPerPlayer:\s*3/bustersPerPlayer: -1/g; s/ghostCount:\s*12/ghostCount: -1/g' packages/sim-runner/src/workerEval.ts

echo "✅ Env randomization enabled: bpp 2–4, ghosts 8–28, endurance {3,15,40} per episode."
