#!/usr/bin/env node

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const url = `http://${host}:${port}`;

function isServerReady() {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });

    req.on('error', () => resolve(false));
    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openBrowser() {
  const opener =
    process.platform === 'darwin'
      ? 'open'
      : process.platform === 'win32'
        ? 'cmd'
        : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];

  spawn(opener, args, {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    if (await isServerReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return false;
}

async function main() {
  if (await isServerReady()) {
    console.log(`服务已在运行: ${url}`);
    openBrowser();
    return;
  }

  const server = spawn(process.execPath, ['src/main.js'], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      HOST: host,
      PORT: String(port),
    },
  });

  server.on('exit', (code) => {
    process.exitCode = code || 0;
  });

  if (await waitForServer()) {
    openBrowser();
  } else {
    console.error('服务启动超时，请检查终端错误信息。');
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
