import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(rootDir, '.env');

if (!fs.existsSync(envPath)) {
  console.error('[git-push] Error: .env file not found.');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const match = envContent.match(/GITHUB_TOKEN=([^\r\n]+)/);
if (!match || !match[1].trim()) {
  console.error('[git-push] Error: GITHUB_TOKEN not found in .env.');
  process.exit(1);
}

const token = match[1].trim();
const args = process.argv.slice(2);

const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: rootDir, encoding: 'utf8' }).trim();
let targetRef = args[0];

if (!targetRef) {
  try {
    const upstream = execSync('git rev-parse --abbrev-ref --symbolic-full-name @{u}', { cwd: rootDir, encoding: 'utf8' }).trim();
    if (upstream.startsWith('origin/')) {
      const remoteBranch = upstream.replace('origin/', '');
      targetRef = `${currentBranch}:${remoteBranch}`;
    }
  } catch {
    targetRef = currentBranch;
  }
}

const pushUrl = `https://${token}@github.com/buildbyravi/thru-wallet-ext.git`;
console.log(`[git-push] Pushing ${targetRef} to origin...`);
execSync(`git push ${pushUrl} ${targetRef}`, { cwd: rootDir, stdio: 'inherit' });
