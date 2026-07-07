#!/usr/bin/env node

const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const browserPath = path.join(projectRoot, 'ms-playwright');
const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(executable, ['playwright', 'install', 'chromium'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    PLAYWRIGHT_BROWSERS_PATH: browserPath,
  },
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}
