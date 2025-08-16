import fs from 'fs';
import path from 'path';
import { loadBotModule } from './loadBots';
import { runEpisodes } from './runEpisodes';
import { trainCEM, compileGenomeToJS, buildBaseOppPool } from './ga';
import { runRoundRobin } from './tournament';

function getFlag(args: string[], name: string, def?: any) {
  const i = args.indexOf(`--${name}`);
  if (i >= 0) return args[i+1] ?? true;
  return def;
}
function getBool(args: string[], name: string, def=false) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? true : def;
}

async function main() {
  const [,, mode, ...rest] = process.argv;

  if (mode === 'sim') {
    const botAPath = rest[0] || '@busters/agents/random';
    const botBPath = rest[1] || '@busters/agents/greedy';
    const episodes = Number(getFlag(rest, 'episodes', 3));
    const seed = Number(getFlag(rest, 'seed', 42));
    const replayPath = getFlag(rest, 'replay', null);

    const botA = await loadBotModule(botAPath);
    const botB = await loadBotModule(botBPath);

    const frames: any[] = [];
    const onTick = replayPath ? (st: any) => {
      frames.push({ tick: st.tick, width: st.width, height: st.height, busters: st.busters, ghosts: st.ghosts, scores: st.scores });
    } : undefined;

    const res = await runEpisodes({ seed, episodes, bustersPerPlayer: 3, ghostCount: 12, botA, botB, onTick } );
    console.log(`A(${botA.meta?.name||'A'}) vs B(${botB.meta?.name||'B'}) ->`, res);

    if (replayPath) {
      fs.mkdirSync(path.dirname(path.resolve(replayPath)), { recursive: true });
      fs.writeFileSync(path.resolve(replayPath), JSON.stringify({ frames }, null, 2));
      console.log(`Saved replay -> ${path.resolve(replayPath)}`);
    }
    return;
  }

  if (mode === 'train') {
    const pop = Number(getFlag(rest, 'pop', 24));
    const gens = Number(getFlag(rest, 'gens', 12));
    const seed = Number(getFlag(rest, 'seed', 42));
    const algo = String(getFlag(rest, 'algo', 'cem'));
    const seedsPer = Number(getFlag(rest, 'seeds-per', 7));
    const episodesPerSeed = Number(getFlag(rest, 'eps-per-seed', 3));
    const jobs = Number(getFlag(rest, 'jobs', 1));
    const oppPoolArg = String(getFlag(rest, 'opp-pool', 'greedy,random'));
    const hofSize = Number(getFlag(rest, 'hof', 5));

    const baseOpps = await buildBaseOppPool();
    const chosen: any[] = [];
    const names = oppPoolArg.split(',').map(s=>s.trim()).filter(Boolean);
    for (const n of names) {
      const b = baseOpps.find(o => o.name === n);
      if (b) chosen.push(b);
    }
    if (chosen.length === 0) chosen.push(...baseOpps);

    console.log(`Training ${algo.toUpperCase()}: pop=${pop} gens=${gens} seedsPer=${seedsPer} oppPool=${names.join('+')||'greedy+random'}`);

    if (algo === 'cem') {
      const best = await trainCEM({
        gens, pop,
        elitePct: 0.2,
        seedsPer,
        episodesPerSeed,
        oppPool: chosen,
        hofSize,
        seed,
        artifactsDir: 'artifacts',
        jobs
      });
      // CWD is packages/sim-runner when using -C
      compileGenomeToJS('artifacts/simrunner_best_genome.json', '../agents/evolved-bot.js');
      console.log('Best genome:', best);
      return;
    }

    console.log(`Unknown algo: ${algo}. Try --algo cem`);
    return;
  }

  if (mode === 'compile') {
    const inPath = String(getFlag(rest, 'in', 'artifacts/simrunner_best_genome.json'));
    const outPath = String(getFlag(rest, 'out', '../agents/evolved-bot.js'));
    compileGenomeToJS(inPath, outPath);
    return;
  }

  if (mode === 'tourney') {
    const botsArg = String(getFlag(rest, 'bots', '@busters/agents/greedy,@busters/agents/random,@busters/agents/evolved'));
    const seed = Number(getFlag(rest, 'seed', 123));
    const seedsPerPair = Number(getFlag(rest, 'seeds', 5));
    const episodesPerSeed = Number(getFlag(rest, 'episodes', 3));
    const replayDir = getFlag(rest, 'replay-dir', null);
    const exportChamp = getFlag(rest, 'export-champ', null); // optional copy champion bot here
    const standingsOut = getFlag(rest, 'out', 'artifacts/tournament_standings.json');

    const bots = botsArg.split(',').map((s, idx) => {
      const spec = s.trim();
      const id = spec.replace(/[^A-Za-z0-9._-]/g, '_') || `bot${idx}`;
      return { id, spec };
    });

    console.log(`Tournament RR: bots=${bots.length} seedsPerPair=${seedsPerPair} episodesPerSeed=${episodesPerSeed}`);
    const standings = await runRoundRobin({
      bots, seed, seedsPerPair, episodesPerSeed,
      replayDir: replayDir ? String(replayDir) : null
    });

    // Rank by points then Elo
    const ranked = [...standings.bots].sort((a,b) => {
      const dp = (standings.points[b] - standings.points[a]);
      return dp !== 0 ? dp : (standings.elo[b] - standings.elo[a]);
    });

    const champ = ranked[0];
    console.log('\n=== Standings (points, W-D-L, Elo) ===');
    for (const id of ranked) {
      console.log(`${id.padEnd(28)}  ${String(standings.points[id]).padStart(4)}   ${String(standings.wins[id]).padStart(2)}-${String(standings.draws[id]).padStart(2)}-${String(standings.losses[id]).padStart(2)}   Elo ${Math.round(standings.elo[id])}`);
    }
    console.log(`\nChampion: ${champ}`);

    // Save standings
    fs.mkdirSync(path.dirname(path.resolve(standingsOut)), { recursive: true });
    fs.writeFileSync(path.resolve(standingsOut), JSON.stringify({ ranked, ...standings }, null, 2));
    console.log(`Saved -> ${path.resolve(standingsOut)}`);

    // Optional: copy champion file if it was passed as a FILE path
    if (exportChamp) {
      const champSpec = bots.find(b => b.id === champ)!.spec;
      const looksLikeFile = champSpec.startsWith('./') || champSpec.startsWith('../') || champSpec.startsWith('/') || champSpec.startsWith('file:');
      if (looksLikeFile && !champSpec.startsWith('file:')) {
        const abs = path.isAbsolute(champSpec) ? champSpec : path.resolve(process.cwd(), champSpec);
        fs.copyFileSync(abs, path.resolve(process.cwd(), String(exportChamp)));
        console.log(`Copied champion file -> ${path.resolve(process.cwd(), String(exportChamp))}`);
      } else {
        console.log(`Champion is a package export; skipping copy. You can re-export it from a small wrapper if needed.`);
      }
    }
    return;
  }

  if (mode === 'sample') {
    const episodes = Number(getFlag(rest, 'episodes', 8));
    const seed = Number(getFlag(rest, 'seed', 123));
    const pairs: Array<[number, number]> = [];
    for (let i=0;i<episodes;i++) {
      const bpp = 2 + ((seed+i) % 3); // 2..4
      const ghosts = 8 + ((seed*7+i*5) % 21); // 8..28
      pairs.push([bpp, ghosts]);
    }
    console.log(JSON.stringify(pairs, null, 2));
    return;
  }

  console.log(`Usage:
  # Train (CEM)
  tsx src/cli.ts train --algo cem --pop 24 --gens 12 --seeds-per 7 --seed 42 [--opp-pool greedy,random,hof]

  # Sim a single match (optional replay)
  tsx src/cli.ts sim <botA> <botB> [--episodes 3] [--seed 42] [--replay path.json]

  # Round-robin tournament (saves standings; optional per-pair replays)
  tsx src/cli.ts tourney --bots @busters/agents/greedy,@busters/agents/random,@busters/agents/evolved \\
    --seed 123 --seeds 5 --episodes 3 \\
    [--replay-dir ../viewer/public/replays/tourney] \\
    [--out artifacts/tournament_standings.json] \\
    [--export-champ ../agents/champion-bot.js]

  # Compile genome → single-file workspace bot
  tsx src/cli.ts compile --in artifacts/simrunner_best_genome.json --out ../agents/evolved-bot.js
`);
}
main();
