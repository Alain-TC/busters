import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..', '..');
const botFile = path.join(root, 'codingame_bot.js');

test('codingame bot enforces stun cooldown', () => {
  const code = fs.readFileSync(botFile, 'utf8');
  const inputs = [
    '1', // busters per player
    '0', // ghost count
    '0', // my team id
    '2',
    '0 1000 1000 0 0 0',
    '1 1200 1000 1 0 0',
    '2',
    '0 1000 1000 0 0 0',
    '1 1200 1000 1 0 0'
  ];
  const outputs: string[] = [];
  const sandbox = {
    readline: () => inputs.shift(),
    console: {
      log: (s: string) => {
        outputs.push(String(s));
        if (outputs.length >= 2) throw new Error('stop');
      }
    }
  };
  try {
    vm.runInNewContext(code, sandbox);
  } catch {
    // expected stop after second output
  }
  assert.ok(/^STUN/.test(outputs[0]), 'first action should be STUN');
  assert.ok(!/^STUN/.test(outputs[1]), 'second action should not be STUN due to cooldown');
});
