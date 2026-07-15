import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  calculateSupervisorDelayMs,
  shouldRestartChild,
} from './src/launcher.js';

assert.equal(calculateSupervisorDelayMs(1), 3000);
assert.equal(calculateSupervisorDelayMs(4), 24000);
assert.equal(calculateSupervisorDelayMs(8), 30000);

assert.equal(shouldRestartChild({ code: 1, signal: null, shuttingDown: false }), true);
assert.equal(shouldRestartChild({ code: null, signal: 'SIGKILL', shuttingDown: false }), true);
assert.equal(shouldRestartChild({ code: 0, signal: null, shuttingDown: false }), false);
assert.equal(shouldRestartChild({ code: 1, signal: null, shuttingDown: true }), false);

const packageJson = JSON.parse(fs.readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const dockerfile = fs.readFileSync(new URL('./Dockerfile', import.meta.url), 'utf8');
const indexSource = fs.readFileSync(new URL('./src/index.js', import.meta.url), 'utf8');

assert.equal(packageJson.scripts.start, 'node src/launcher.js');
assert.match(dockerfile, /CMD \["node", "src\/launcher\.js"\]/);
assert.match(indexSource, /restart_worker_exit[\s\S]*process\.exit\(1\)/);

console.log('PROCESS_SUPERVISOR_OK');
