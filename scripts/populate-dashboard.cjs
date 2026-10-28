#!/usr/bin/env node
// Cross-platform Node entry point for the canonical real-API demo seed.
const { spawnSync } = require('node:child_process');
const { mkdirSync } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const directory = resolve(root, 'artifacts/demo');
mkdirSync(directory, { recursive: true });
const dockerPath = value => value.replaceAll(String.fromCharCode(92), '/');
const result = spawnSync('docker', ['compose', 'run', '--rm', '--no-deps',
  '-v', `${dockerPath(resolve(root, 'scripts'))}:/demo-scripts:ro`,
  '-v', `${dockerPath(directory)}:/demo-data`,
  'backend', 'node', '/demo-scripts/seed-frontend-demo.cjs'], { cwd: root, stdio: 'inherit', shell: false });
if (result.error) console.error('Could not run Docker Compose:', result.error.message);
process.exitCode = result.status ?? 1;
