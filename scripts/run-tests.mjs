import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const includeReal = process.env.RUN_REAL_AUDIT === '1' || process.argv.includes('--real');
const tests = (await readdir(root))
  .filter((name) => /^test_.*\.js$/.test(name))
  .filter((name) => includeReal || name !== 'test_real_integration.js')
  .sort();

for (const test of tests) {
  process.stdout.write(`\n[TEST] ${test}\n`);
  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [test], {
      cwd: root,
      env: includeReal ? { ...process.env, RUN_REAL_AUDIT: '1' } : process.env,
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`${test} termino por senal ${signal}`));
      else resolve(code ?? 1);
    });
  });

  if (exitCode !== 0) {
    console.error(`\n[FAIL] ${test} (exit ${exitCode})`);
    process.exit(exitCode);
  }
}

console.log(`\nTEST_SUITE_OK=${tests.length}`);
