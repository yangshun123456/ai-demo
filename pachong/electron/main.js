const path = require('path');
const { app, BrowserWindow, shell } = require('electron');

let mainWindow = null;
let serverHandle = null;

function configureRuntimePaths() {
  process.env.CRAWLER_DOWNLOAD_DIR = path.join(app.getPath('userData'), 'downloads');

  if (app.isPackaged) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(process.resourcesPath, 'ms-playwright');
  } else {
    process.env.PLAYWRIGHT_BROWSERS_PATH = path.join(__dirname, '..', 'ms-playwright');
  }
}

async function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 960,
    minHeight: 680,
    title: '爬虫控制台',
    backgroundColor: '#f5f7fb',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    shell.openExternal(targetUrl);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, targetUrl) => {
    if (!targetUrl.startsWith(url)) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });

  await mainWindow.loadURL(url);
}

async function startApp() {
  configureRuntimePaths();

  const { startServer } = require('../src/main');
  serverHandle = await startServer({
    host: '127.0.0.1',
    port: 0,
  });

  await createMainWindow(serverHandle.url);
}

app.whenReady().then(startApp).catch((error) => {
  console.error(error);
  app.quit();
});

app.on('activate', async () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverHandle?.url) {
    await createMainWindow(serverHandle.url);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverHandle?.server) {
    serverHandle.server.close();
    serverHandle = null;
  }
});
