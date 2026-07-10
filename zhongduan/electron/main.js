import { app, BrowserWindow } from 'electron';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { registerIpcHandlers } from './backend/ipc/register-handlers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: '智联 Linux',
    backgroundColor: '#0b1326',
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(join(__dirname, '../dist/index.html'));
  }

  win.webContents.on('did-finish-load', () => {
    void win.webContents.executeJavaScript(
      'window.__linuxAiBridgeState = { hasRuntime: !!window.linuxAiRuntime, hasBridge: !!window.linuxAi };'
    );
  });
};

app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

function resolvePreloadPath() {
  const bundledPreload = join(__dirname, 'preload.mjs');
  if (existsSync(bundledPreload)) return bundledPreload;
  return join(__dirname, '../dist-electron/preload.mjs');
}
