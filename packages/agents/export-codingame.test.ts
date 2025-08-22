import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const outFile = path.join(root, 'codingame_bot.js');
const hadFile = fs.existsSync(outFile);
const original = hadFile ? fs.readFileSync(outFile, 'utf8') : undefined;

test('exported bot runs under codingame_bot.js', () => {
  // export using current hybrid parameters
  execSync(`pnpm exec tsx scripts/export-codingame.ts --from hybrid --out ${outFile}`, { cwd: root, stdio: 'inherit' });

  try {
    const code = fs.readFileSync(outFile, 'utf8');
    const inputs = ['2', '0', '0', '0'];
    const outputs: string[] = [];
    vm.runInNewContext(code, {
      readline: () => inputs.shift(),
      print: (s: string) => outputs.push(String(s))
    });
    assert.equal(outputs.length, 2, 'expected two action lines');
  } finally {
    if (hadFile && original !== undefined) {
      fs.writeFileSync(outFile, original);
    } else if (fs.existsSync(outFile)) {
      fs.unlinkSync(outFile);
    }
  }
});
