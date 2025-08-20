import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { initGame, step, ActionsByTeam } from './engine';
import { entitiesForTeam } from './perception';
import { Action, TeamId, MAX_TICKS } from '@busters/shared';

function parseAction(line: string): Action | undefined {
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
      return undefined;
    default:
      return undefined;
  }
}

async function readLines(rl: readline.Interface, count: number): Promise<string[]> {
  return new Promise(resolve => {
    const lines: string[] = [];
    const onLine = (line: string) => {
      lines.push(line.trim());
      if (lines.length === count) {
        rl.removeListener('line', onLine);
        resolve(lines);
      }
    };
    rl.on('line', onLine);
  });
}

async function main() {
  const [bot0Cmd, bot1Cmd] = process.argv.slice(2);
  if (!bot0Cmd || !bot1Cmd) {
    console.error('Usage: node cg-driver.js <bot0> <bot1>');
    process.exit(1);
  }

  const bots = [
    spawn(bot0Cmd, { stdio: ['pipe', 'pipe', 'inherit'], shell: true }),
    spawn(bot1Cmd, { stdio: ['pipe', 'pipe', 'inherit'], shell: true })
  ];
  const readers = bots.map(b => readline.createInterface({ input: b.stdout }));

  let state = initGame({ seed: 1, bustersPerPlayer: 2, ghostCount: 4 });

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
    if (state.scores[0] + state.scores[1] >= state.ghostCount) {
      break;
    }
  }

  console.log(`Final scores: ${state.scores[0]} - ${state.scores[1]}`);
  bots.forEach(b => b.kill());
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
