import fs from 'fs';
import path from 'path';
import { runEpisodes } from './runEpisodes';
import { loadBotModule } from './loadBots';

export type BotSpec = { id: string; spec: string }; // id (display), spec (import path or package export)

export type MatchResult = {
  a: string; b: string;
  seed: number;
  episodes: number;
  scoreA: number; scoreB: number;
};

export type Standings = {
  bots: string[];
  points: Record<string, number>;
  wins: Record<string, number>;
  losses: Record<string, number>;
  draws: Record<string, number>;
  elo: Record<string, number>;
  matches: MatchResult[];
};

function expectedScore(ra: number, rb: number) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400));
}
function updateElo(ra: number, rb: number, resultA: number, k=24) {
  const ea = expectedScore(ra, rb);
  const eb = expectedScore(rb, ra);
  const na = ra + k * (resultA - ea);
  const nb = rb + k * ((1 - resultA) - eb);
  return [na, nb] as const;
}

export async function runRoundRobin(opts: {
  bots: BotSpec[];
  seed: number;
  seedsPerPair: number;        // CRNs: seeds per pair
  episodesPerSeed: number;     // episodes per seed
  bustersPerPlayer?: number;   // default 3
  ghostCount?: number;         // default 12
  replayDir?: string | null;   // save per-match replay JSONs
}) {
  const bpp = opts.bustersPerPlayer ?? 3;
  const ghosts = opts.ghostCount ?? 12;

  // load once
  const loaded = new Map<string, any>();
  for (const b of opts.bots) loaded.set(b.id, await loadBotModule(b.spec));

  const ids = opts.bots.map(b => b.id);
  const elo: Record<string, number> = Object.fromEntries(ids.map(id => [id, 1000]));
  const points: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
  const wins: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
  const losses: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
  const draws: Record<string, number> = Object.fromEntries(ids.map(id => [id, 0]));
  const matches: MatchResult[] = [];

  const seeds = Array.from({length: opts.seedsPerPair}, (_,i)=> opts.seed + i);

  if (opts.replayDir) fs.mkdirSync(path.resolve(opts.replayDir), { recursive: true });

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const A = ids[i], B = ids[j];
      const botA = loaded.get(A), botB = loaded.get(B);
      let aggA = 0, aggB = 0;

      for (const s of seeds) {
        const frames: any[] = [];
        const res = await runEpisodes({
          seed: s,
          episodes: opts.episodesPerSeed,
          bustersPerPlayer: bpp,
          ghostCount: ghosts,
          botA, botB,
          onTick: opts.replayDir ? (st: any) => {
            frames.push({ tick: st.tick, width: st.width, height: st.height, busters: st.busters, ghosts: st.ghosts, scores: st.scores });
          } : undefined
        } );

        aggA += res.scoreA; aggB += res.scoreB;

        if (opts.replayDir) {
          const file = path.join(opts.replayDir, `${A}__vs__${B}__seed${s}.json`);
          fs.writeFileSync(file, JSON.stringify({ meta: { A, B, seed: s, episodes: opts.episodesPerSeed }, frames }, null, 2));
        }

        matches.push({ a: A, b: B, seed: s, episodes: opts.episodesPerSeed, scoreA: res.scoreA, scoreB: res.scoreB });
      }

      // decide result on aggregate
      const diff = aggA - aggB;
      let ra = elo[A], rb = elo[B];

      if (diff > 0) {
        points[A] += 3; wins[A]++; losses[B]++;
        const [na, nb] = updateElo(ra, rb, 1);
        elo[A] = na; elo[B] = nb;
      } else if (diff < 0) {
        points[B] += 3; wins[B]++; losses[A]++;
        const [na, nb] = updateElo(ra, rb, 0);
        elo[A] = na; elo[B] = nb;
      } else {
        points[A] += 1; points[B] += 1; draws[A]++; draws[B]++;
        const [na, nb] = updateElo(ra, rb, 0.5);
        elo[A] = na; elo[B] = nb;
      }
    }
  }

  const standings: Standings = { bots: ids, points, wins, losses, draws, elo, matches };
  return standings;
}
