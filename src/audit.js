import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srcDir = __dirname;

export async function runPeriodicAudit() {
  console.log('[audit] Starting periodic security audit...');

  // 1. Audit npm dependencies
  try {
    const { stdout } = await execAsync('npm audit --json');
    const auditResult = JSON.parse(stdout);
    const vulnerabilities = auditResult.metadata?.vulnerabilities || {};

    if (vulnerabilities.total > 0) {
      console.warn(`[audit] WARNING: Found ${vulnerabilities.total} npm vulnerabilities (${vulnerabilities.high} high, ${vulnerabilities.critical} critical).`);
    } else {
      console.log('[audit] npm dependencies: No vulnerabilities found.');
    }
  } catch (err) {
    // npm audit returns a non-zero exit code if vulnerabilities are found
    if (err.stdout) {
      try {
        const auditResult = JSON.parse(err.stdout);
        const vulnerabilities = auditResult.metadata?.vulnerabilities || {};
        console.warn(`[audit] WARNING: Found ${vulnerabilities.total} npm vulnerabilities (${vulnerabilities.high} high, ${vulnerabilities.critical} critical). Please run npm audit.`);
      } catch (e) {
        console.error('[audit] Error parsing npm audit output:', e);
      }
    } else {
      console.error('[audit] Error running npm audit:', err);
    }
  }

  // 2. Scan for hardcoded credentials/secrets in src/ (basic heuristic)
  let foundLeaks = false;
  const credentialRegex = /(password|secret|token|api_key|apikey)[\s]*[:=][\s]*['"][^'"]+['"]/i;

  function scanDir(dir) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        scanDir(fullPath);
      } else if (file.endsWith('.js')) {
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (credentialRegex.test(line) && !line.includes('process.env')) {
            console.warn(`[audit] WARNING: Potential hardcoded credential found in ${fullPath}:${i + 1} -> ${line.trim()}`);
            foundLeaks = true;
          }
        }
      }
    }
  }

  try {
    scanDir(srcDir);
    if (!foundLeaks) {
      console.log('[audit] No obvious hardcoded credentials found in source files.');
    }
  } catch (err) {
    console.error('[audit] Error scanning files for credentials:', err);
  }

  console.log('[audit] Periodic security audit completed.');
}
