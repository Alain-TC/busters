import fs from 'fs';

const outPath = 'packages/agents/evolved-bot.js';
const genomePath = process.argv[2] || 'artifacts/best_genome.json';
if (!fs.existsSync(genomePath)) {
  console.error(`Genome file not found: ${genomePath}. Run "pnpm train" first.`);
  process.exit(1);
}
const g = JSON.parse(fs.readFileSync(genomePath,'utf8'));
const file = `// Auto-generated bot from genome
export const meta = { name: 'EvolvedBot', trained: '${new Date().toISOString()}' };

const G = ${JSON.stringify(g)};

export function act(ctx, obs) {
  // Heuristic policy compiled from genome
  if (obs.self.carrying !== undefined) {
    const d = Math.hypot(obs.self.x-ctx.myBase.x, obs.self.y-ctx.myBase.y);
    if (d <= G.releaseDist) return { type:'RELEASE' };
    return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
  }
  const e = obs.enemies && obs.enemies[0];
  if (e && e.range <= G.stunRange && obs.self.stunCd<=0) return { type:'STUN', busterId:e.id };
  const g = obs.ghostsVisible && obs.ghostsVisible[0];
  if (g) return (g.range>=900 && g.range<=1760) ? { type:'BUST', ghostId:g.id } : { type:'MOVE', x:g.x, y:g.y };
  if (!obs.self.radarUsed && obs.tick >= G.radarTurn) return { type:'RADAR' };
  return { type:'MOVE', x: ctx.myBase.x, y: ctx.myBase.y };
}
export default { act, meta };
`;
fs.writeFileSync(outPath, file);
console.log('Wrote single-file bot to', outPath);
