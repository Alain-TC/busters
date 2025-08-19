import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);
let explicitLog: string | undefined;
let sinceStr: string | undefined;
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--since') {
    sinceStr = args[++i];
  } else if (!a.startsWith('--') && !explicitLog) {
    explicitLog = a;
  } else {
    console.error('pfsp-report: unknown arg', a);
    process.exit(1);
  }
}

let since: number | null = null;
if (sinceStr) {
  const t = Date.parse(sinceStr);
  if (Number.isNaN(t)) {
    console.error('pfsp-report: invalid --since timestamp');
    process.exit(1);
  }
  since = t;
}

const candidates = [
  path.resolve('packages/sim-runner/artifacts/pfsp_log.jsonl'),
  path.resolve('artifacts/pfsp_log.jsonl'),
];
const logPath = explicitLog ? path.resolve(explicitLog) : candidates.find(p => fs.existsSync(p));
if (!logPath || !fs.existsSync(logPath)) {
  const locations = [explicitLog, ...candidates].filter(Boolean).join(' or ');
  console.log('pfsp-report: no PFSP log found at', locations);
  process.exit(0);
}

type Row = {
  ts?: string;
  type: 'pick' | 'result';
  oppId?: string;
  opp?: { type:'module'|'genome'; spec?:string; tag?:string };
  diff?: number;
};

function deriveId(r: Row) {
  return r.oppId ?? (r.opp?.type === 'module' ? r.opp?.spec : r.opp?.tag);
}

let rows: Row[] = fs.readFileSync(logPath, 'utf-8')
  .split('\n').map(s => s.trim()).filter(Boolean)
  .map(s => { try { return JSON.parse(s) as Row; } catch { return {} as Row; } })
  .filter(r => r && (r.type === 'pick' || r.type === 'result'));

if (since !== null) {
  rows = rows.filter(r => {
    const ts = Date.parse(r.ts || '');
    return !Number.isNaN(ts) && ts >= since!;
  });
}

type Acc = { id:string; picks:number; results:number; W:number; D:number; L:number; diffSum:number; };
const byId = new Map<string, Acc>();
const acc = (id:string)=> byId.get(id) ?? byId.set(id, { id, picks:0, results:0, W:0, D:0, L:0, diffSum:0 }).get(id)!;

for (const r of rows) {
  const id = deriveId(r);
  if (!id) continue;
  const a = acc(id);
  if (r.type === 'pick') a.picks++;
  else if (r.type === 'result') {
    a.results++;
    const d = typeof r.diff === 'number' ? r.diff : 0;
    a.diffSum += d;
    if (d > 0) a.W++; else if (d < 0) a.L++; else a.D++;
  }
}

const table = Array.from(byId.values()).map(a => ({
  id: a.id,
  picks: a.picks,
  results: a.results,
  winRate: a.results ? +(a.W / a.results).toFixed(3) : 0,
  avgDiff: a.results ? +(a.diffSum / a.results).toFixed(3) : 0,
  W: a.W, D: a.D, L: a.L,
})).sort((x,y)=> y.picks - x.picks);

console.table(table);
