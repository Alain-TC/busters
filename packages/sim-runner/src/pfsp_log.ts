import fs from 'fs';
import path from 'path';

const DEFAULT_PATH = path.resolve(process.cwd(), 'artifacts/pfsp_log.jsonl');
const LOG_PATH = path.resolve(process.env.PFSP_LOG_PATH || DEFAULT_PATH);

function ensureFile() {
  const dir = path.dirname(LOG_PATH);
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOG_PATH)) fs.writeFileSync(LOG_PATH, '');
}

export function resetPFSPLog() {
  ensureFile();
  fs.writeFileSync(LOG_PATH, '');
}

function append(obj: any) {
  ensureFile();
  fs.appendFileSync(LOG_PATH, JSON.stringify(obj) + '\n');
}

type Phase = 'serial' | 'parallel';
type OppSummary = { type: 'module'|'genome'; spec?: string; tag?: string };

function deriveId(oppId?: string, opp?: OppSummary) {
  if (oppId) return oppId;
  if (opp?.type === 'module') return opp.spec;
  if (opp?.type === 'genome') return opp.tag;
  return undefined;
}

export function logPFSPPick(evt: {
  ts: string; phase: Phase; seed: number; gi?: number;
  oppId?: string; opp?: OppSummary;
}) {
  const id = deriveId(evt.oppId, evt.opp);
  append({ type: 'pick', ...evt, oppId: id });
}

export function logPFSPResult(evt: {
  ts: string; phase: Phase; diff: number; gi?: number; jid?: number;
  oppId?: string; opp?: OppSummary;
}) {
  const id = deriveId(evt.oppId, evt.opp);
  append({ type: 'result', ...evt, oppId: id });
}

export function getPFSPLogPath() { return LOG_PATH; }
