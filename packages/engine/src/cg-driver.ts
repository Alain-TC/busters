import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { initGame, step, ActionsByTeam } from './engine';
import { entitiesForTeam } from './perception';
import { Action, TeamId, MAX_TICKS } from '@busters/shared';

export function parseAction(line: string): Action | undefined {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0]?.toUpperCase();
  switch (cmd) {
    case 'MOVE':
      return { type: 'MOVE', x: Number(parts[1]), y: Number(parts[2]) };
    case 'BUST':
      return { type: 'BUST', ghostId: Number(parts[1]) };
    case 'RELEASE':
      return { type: 'RELEASE' };
    case 'STUN':
      return { type: 'STUN', busterId: Number(parts[1]) };
    case 'RADAR':
      return { type: 'RADAR' };
    case 'EJECT':
      return { type: 'EJECT', x: Number(parts[1]), y: Number(parts[2]) };
    case 'WAIT':
      return { type: 'WAIT' };
    default:
      return undefined;
  }
}

export async function readLines(rl: readline.Interface, count: number): Promise<string[]> {
  return new Promise(resolve => {
    const lines: string[] = [];
    const onLine = (line: string) => {
      lines.push(line.trim());
      if (lines.length === count) {
        clearTimeout(timer);
        rl.removeListener('line', onLine);
        resolve(lines);
      }
    };

    const timer = setTimeout(() => {
      rl.removeListener('line', onLine);
      if (lines.length < count) {
        const missing = count - lines.length;
        console.warn(`Timed out waiting for ${missing} line(s)`);
        while (lines.length < count) lines.push('WAIT');
      }
      resolve(lines);
    }, 100);

    rl.on('line', onLine);
  });
}

const DEFAULT_SEED = 1;
const DEFAULT_BUSTERS = 2;
const DEFAULT_GHOSTS = 4;

function parseArgs(argv: string[]) {
  const cfg = { seed: DEFAULT_SEED, bustersPerPlayer: DEFAULT_BUSTERS, ghostCount: DEFAULT_GHOSTS };
  const bots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed' && i + 1 < argv.length) { cfg.seed = Number(argv[++i]); }
    else if (a.startsWith('--seed=')) { cfg.seed = Number(a.split('=')[1]); }
    else if ((a === '--busters' || a === '--busters-per-player') && i + 1 < argv.length) { cfg.bustersPerPlayer = Number(argv[++i]); }
    else if (a.startsWith('--busters=') || a.startsWith('--busters-per-player=')) { cfg.bustersPerPlayer = Number(a.split('=')[1]); }
    else if ((a === '--ghosts' || a === '--ghost-count') && i + 1 < argv.length) { cfg.ghostCount = Number(argv[++i]); }
    else if (a.startsWith('--ghosts=') || a.startsWith('--ghost-count=')) { cfg.ghostCount = Number(a.split('=')[1]); }
    else if (a === '--config' && i + 1 < argv.length) {
      const path = argv[++i];
      const file = JSON.parse(readFileSync(path, 'utf8'));
      if (typeof file.seed === 'number') cfg.seed = file.seed;
      if (typeof file.bustersPerPlayer === 'number') cfg.bustersPerPlayer = file.bustersPerPlayer;
      if (typeof file.ghostCount === 'number') cfg.ghostCount = file.ghostCount;
    } else {
      bots.push(a);
    }
  }
  return { bots, cfg };
}

async function main() {
  const { bots: botCmds, cfg } = parseArgs(process.argv.slice(2));
  const [bot0Cmd, bot1Cmd] = botCmds;
  if (!bot0Cmd || !bot1Cmd) {
    console.error('Usage: node cg-driver.js <bot0> <bot1> [--seed <n>] [--busters <n>] [--ghosts <n>] [--config <file>]');
    process.exit(1);
  }

  const bots = [
    spawn(bot0Cmd, { stdio: ['pipe', 'pipe', 'inherit'], shell: true }),
    spawn(bot1Cmd, { stdio: ['pipe', 'pipe', 'inherit'], shell: true })
  ];
  const readers = bots.map(b => readline.createInterface({ input: b.stdout }));

  let state = initGame(cfg);

  for (const t of [0, 1] as TeamId[]) {
    const w = bots[t].stdin;
    w.write(`${state.bustersPerPlayer}\n`);
    w.write(`${state.ghostCount}\n`);
    w.write(`${t}\n`);
  }

  while (state.tick < MAX_TICKS) {
    for (const t of [0, 1] as TeamId[]) {
      const entities = entitiesForTeam(state, t);
      const w = bots[t].stdin;
      w.write(`${entities.length}\n`);
      for (const e of entities) {
        w.write(`${e.id} ${e.x} ${e.y} ${e.entityType} ${e.state} ${e.value}\n`);
      }
    }

    const [lines0, lines1] = await Promise.all([
      readLines(readers[0], state.bustersPerPlayer),
      readLines(readers[1], state.bustersPerPlayer)
    ]);

    const actions: ActionsByTeam = {
      0: lines0.map(parseAction),
      1: lines1.map(parseAction)
    };

    state = step(state, actions);
    if (state.ghosts.length === 0 && !state.busters.some(b => b.state === 1)) {
      break;
    }
  }

  console.log(`Final scores: ${state.scores[0]} - ${state.scores[1]}`);
  bots.forEach(b => b.kill());
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
