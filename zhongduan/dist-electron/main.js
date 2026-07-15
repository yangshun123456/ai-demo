import { app, ipcMain, dialog, shell, BrowserWindow } from "electron";
import { join, resolve, posix, basename, dirname } from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readFile, readdir, mkdir, writeFile, unlink } from "node:fs/promises";
import crypto$1 from "node:crypto";
import { Client } from "ssh2";
import SftpClient from "ssh2-sftp-client";
import __cjs_mod__ from "node:module";
const __filename = import.meta.filename;
const __dirname = import.meta.dirname;
const require2 = __cjs_mod__.createRequire(import.meta.url);
const defaultConfig = {
  servers: [],
  aiProfiles: [
    {
      id: "openai-compatible",
      name: "OpenAI Compatible",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "",
      model: "gpt-4.1",
      models: []
    }
  ],
  preferences: {
    activeServerId: "",
    activeAiProfileId: "openai-compatible",
    lastRemotePath: ""
  }
};
function serversConfigDirPath() {
  return join(app.getPath("userData"), "servers_config");
}
function legacyServersConfigDirPath() {
  return join(process.cwd(), "servers_config");
}
function getReadableServersConfigDirs() {
  const primaryDir = serversConfigDirPath();
  const legacyDir = legacyServersConfigDirPath();
  if (resolve(primaryDir) === resolve(legacyDir)) return [primaryDir];
  return [primaryDir, legacyDir];
}
function configPath() {
  return join(app.getPath("userData"), "linux-ai-connector.json");
}
async function readConfig() {
  let mainConfig = {};
  try {
    const raw = await readFile(configPath(), "utf8");
    mainConfig = JSON.parse(raw);
  } catch {
    mainConfig = structuredClone(defaultConfig);
  }
  const loadedServers = [];
  const loadedServerIds = /* @__PURE__ */ new Set();
  for (const dirPath of getReadableServersConfigDirs()) {
    try {
      if (!existsSync(dirPath)) continue;
      const files = await readdir(dirPath);
      for (const file of files) {
        if (file.endsWith(".json")) {
          try {
            const rawServer = await readFile(join(dirPath, file), "utf8");
            const serverProfile = JSON.parse(rawServer);
            if (serverProfile?.id && !loadedServerIds.has(serverProfile.id)) {
              loadedServers.push(serverProfile);
              loadedServerIds.add(serverProfile.id);
            }
          } catch (e) {
            console.error(`读取服务器配置文件 ${file} 失败:`, e);
          }
        }
      }
    } catch (err) {
      console.error(`读取服务器配置目录失败 ${dirPath}:`, err);
    }
  }
  mainConfig.servers = loadedServers;
  return mergeConfig(mainConfig);
}
async function writeConfig(config) {
  const mainConfigToSave = {
    ...config,
    servers: []
  };
  await mkdir(app.getPath("userData"), { recursive: true });
  await writeFile(configPath(), JSON.stringify(mergeConfig(mainConfigToSave), null, 2), "utf8");
  const dirPath = serversConfigDirPath();
  await mkdir(dirPath, { recursive: true });
  const serverIds = (config.servers || []).map((s) => s.id);
  try {
    if (existsSync(dirPath)) {
      const files = await readdir(dirPath);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const match = file.match(/^server-(.+)\.json$/);
          if (match) {
            const id = match[1];
            if (!serverIds.includes(id)) {
              await unlink(join(dirPath, file));
            }
          }
        }
      }
    }
  } catch (err) {
    console.error("清理已删除的服务器文件失败:", err);
  }
  for (const server of config.servers || []) {
    const filePath = join(dirPath, `server-${server.id}.json`);
    try {
      await writeFile(filePath, JSON.stringify(server, null, 2), "utf8");
    } catch (e) {
      console.error(`保存服务器配置文件 ${server.id} 失败:`, e);
    }
  }
}
async function updateConfig(updater) {
  const current = await readConfig();
  const next = await updater(current);
  await writeConfig(next);
  return next;
}
function mergeConfig(config) {
  return {
    ...defaultConfig,
    ...config,
    aiProfiles: config?.aiProfiles?.length ? config.aiProfiles : defaultConfig.aiProfiles,
    preferences: {
      ...defaultConfig.preferences,
      ...config?.preferences
    }
  };
}
async function saveAiProfile(profile) {
  const nextProfile = {
    id: profile.id || crypto.randomUUID(),
    name: (profile.name || "").trim(),
    baseUrl: (profile.baseUrl || "").trim(),
    apiKey: profile.apiKey || "",
    model: (profile.model || "").trim(),
    models: Array.isArray(profile.models) ? profile.models.filter(Boolean) : []
  };
  return updateConfig((config) => {
    const aiProfiles = config.aiProfiles.some((item) => item.id === nextProfile.id) ? config.aiProfiles.map((item) => item.id === nextProfile.id ? nextProfile : item) : [...config.aiProfiles, nextProfile];
    return {
      ...config,
      aiProfiles,
      preferences: {
        ...config.preferences,
        activeAiProfileId: nextProfile.id
      }
    };
  });
}
async function activateAiProfile(profileId) {
  return updateConfig((config) => ({
    ...config,
    preferences: {
      ...config.preferences,
      activeAiProfileId: profileId
    }
  }));
}
async function listAiModels(profile) {
  const baseUrl = (profile.baseUrl || "").trim().replace(/\/$/, "");
  if (!baseUrl) {
    throw new Error("请先填写 Base URL");
  }
  if (!profile.apiKey) {
    throw new Error("请先填写 API Key");
  }
  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${profile.apiKey}`
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `获取模型失败: ${response.status}`);
  }
  const payload = await response.json();
  return (payload.data || []).map((item) => item?.id).filter(Boolean).sort((left, right) => left.localeCompare(right));
}
async function sendAiChat(profile, messages) {
  const baseUrl = (profile.baseUrl || "").trim().replace(/\/$/, "");
  const apiKey = (profile.apiKey || "").trim();
  const model = (profile.model || "").trim();
  if (!baseUrl) throw new Error("请先填写 Base URL");
  if (!apiKey) throw new Error("请先填写 API Key");
  if (!model) throw new Error("请先选择模型");
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.2
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(getAiErrorMessage(text, response.status));
  }
  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("接口未返回有效的回复内容");
  }
  return content;
}
function getAiErrorMessage(text, status) {
  try {
    const payload = JSON.parse(text);
    return payload?.error?.message || payload?.message || text || `HTTP ${status}`;
  } catch {
    return text || `HTTP ${status}`;
  }
}
function normalizeServerProfile(profile) {
  return {
    id: profile.id,
    name: (profile.name || "").trim(),
    host: (profile.host || "").trim(),
    port: Number(profile.port) || 22,
    username: (profile.username || "").trim(),
    password: profile.password || "",
    privateKey: (profile.privateKey || "").trim(),
    rootPath: (profile.rootPath || "/").trim() || "/"
  };
}
async function testServerConnection(profile) {
  const connection = await createConnection(profile);
  connection.end();
  return { ok: true, message: "连接成功" };
}
async function connectSftp(sftp, profile) {
  const normalized = await prepareProfile(profile);
  await sftp.connect(toSsh2Config(normalized));
}
async function listRemoteFiles(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    const entries = await sftp.list(remotePath);
    return entries.map((entry) => ({
      type: entry.type === "d" ? "d" : "-",
      name: entry.name,
      size: Number(entry.size) || 0,
      modifyTime: Number(entry.modifyTime) || Date.now(),
      accessTime: Number(entry.accessTime) || Date.now()
    })).sort(sortFiles);
  } finally {
    await closeSftp(sftp);
  }
}
async function readRemoteFile(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    const content = await sftp.get(remotePath);
    if (Buffer.isBuffer(content)) return content.toString("utf8");
    return String(content);
  } finally {
    await closeSftp(sftp);
  }
}
async function writeRemoteFile(profile, remotePath, content) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.put(Buffer.from(content, "utf8"), remotePath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}
async function uploadRemoteFile(profile, localPath, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.fastPut(localPath, remotePath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}
async function downloadRemoteFile(profile, remotePath, localPath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.fastGet(remotePath, localPath);
    return { ok: true, path: localPath };
  } finally {
    await closeSftp(sftp);
  }
}
async function resolveRemotePath(profile, currentPath, targetName) {
  if (!targetName || targetName === ".") return currentPath;
  if (targetName === "..") {
    const parent = posix.dirname(currentPath);
    return parent === "." ? "/" : parent;
  }
  const nextPath = targetName.startsWith("/") ? posix.normalize(targetName) : posix.normalize(posix.join(currentPath, targetName));
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    const stat = await sftp.stat(nextPath);
    if (stat.isDirectory) return nextPath;
    throw new Error(`${targetName} 不是目录`);
  } finally {
    await closeSftp(sftp);
  }
}
async function renameRemoteFile(profile, remotePath, newPath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.rename(remotePath, newPath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}
async function deleteRemoteFile(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.delete(remotePath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}
async function deleteRemoteDirectory(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.rmdir(remotePath, true);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}
async function createRemoteDirectory(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.mkdir(remotePath, true);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}
async function createRemoteFile(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.put(Buffer.from(""), remotePath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}
async function executeRemoteCommand(profile, command, cwd, onStdout, onStderr, onClose) {
  const normalized = await prepareProfile(profile);
  const client = new Client();
  return new Promise((resolve2, reject) => {
    client.on("ready", () => {
      const execOptions = cwd ? { env: { PWD: cwd } } : {};
      const fullCommand = cwd ? `cd "${cwd}" && ${command}` : command;
      client.exec(fullCommand, execOptions, (err, stream) => {
        if (err) {
          client.end();
          return reject(err);
        }
        stream.on("close", (code, signal) => {
          client.end();
          if (onClose) onClose(code);
        }).on("data", (data) => {
          if (onStdout) onStdout(data.toString("utf8"));
        }).stderr.on("data", (data) => {
          if (onStderr) onStderr(data.toString("utf8"));
        });
        resolve2({ ok: true });
      });
    }).on("error", (err) => {
      reject(err);
    }).connect(toSsh2Config(normalized));
  });
}
const activeTerminals = /* @__PURE__ */ new Map();
async function startTerminalSession(profile, onData) {
  const normalized = await prepareProfile(profile);
  const client = new Client();
  const sessionId = crypto$1.randomUUID();
  return new Promise((resolve2, reject) => {
    client.on("ready", () => {
      client.shell((err, stream) => {
        if (err) {
          client.end();
          return reject(err);
        }
        activeTerminals.set(sessionId, { client, stream });
        stream.on("close", () => {
          client.end();
          activeTerminals.delete(sessionId);
        }).on("data", (data) => {
          if (onData) onData(sessionId, data.toString("utf8"));
        });
        resolve2(sessionId);
      });
    }).on("error", (err) => {
      reject(err);
    }).connect(toSsh2Config(normalized));
  });
}
function writeTerminalSession(sessionId, data) {
  const session = activeTerminals.get(sessionId);
  if (session && session.stream) {
    session.stream.write(data);
  }
}
function resizeTerminalSession(sessionId, cols, rows) {
  const session = activeTerminals.get(sessionId);
  if (session && session.stream && typeof session.stream.setWindow === "function") {
    session.stream.setWindow(rows, cols, 0, 0);
  }
}
function closeTerminalSession(sessionId) {
  const session = activeTerminals.get(sessionId);
  if (session) {
    if (session.client) session.client.end();
    activeTerminals.delete(sessionId);
  }
}
async function createConnection(profile) {
  const normalized = await prepareProfile(profile);
  return new Promise((resolve2, reject) => {
    const client = new Client();
    let settled = false;
    client.on("ready", () => {
      settled = true;
      resolve2(client);
    }).on("error", (error) => {
      if (!settled) reject(error);
    }).connect(toSsh2Config(normalized));
  });
}
async function prepareProfile(profile) {
  const normalized = normalizeServerProfile(profile);
  validateServerProfile(normalized);
  let privateKeyContent = void 0;
  if (normalized.privateKey) {
    if (normalized.privateKey.includes("-----BEGIN")) {
      privateKeyContent = normalized.privateKey;
    } else {
      privateKeyContent = await readFile(normalized.privateKey, "utf8");
    }
  }
  return {
    ...normalized,
    privateKeyContent
  };
}
function validateServerProfile(profile) {
  if (!profile.name || !profile.host || !profile.username || false) {
    throw new Error("请先完整填写服务器名称、地址、用户名和根目录。");
  }
  if (!profile.password && !profile.privateKey) {
    throw new Error("请填写密码或私钥路径后再连接服务器。");
  }
}
function toSsh2Config(profile) {
  const config = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: 2e4
  };
  if (profile.privateKeyContent) {
    config.privateKey = profile.privateKeyContent;
    if (profile.password) {
      config.passphrase = profile.password;
    }
  } else {
    config.password = profile.password;
  }
  return config;
}
async function closeSftp(sftp) {
  try {
    await sftp.end();
  } catch {
    return void 0;
  }
}
function sortFiles(left, right) {
  if (left.type !== right.type) {
    return left.type === "d" ? -1 : 1;
  }
  return left.name.localeCompare(right.name, "zh-CN");
}
function buildUploadTargetPath(currentPath, localPath) {
  return posix.join(currentPath, basename(localPath));
}
async function saveServerProfile(profile) {
  const nextProfile = {
    ...normalizeServerProfile(profile),
    id: profile.id || crypto.randomUUID()
  };
  return updateConfig((config) => {
    const servers = config.servers.some((item) => item.id === nextProfile.id) ? config.servers.map((item) => item.id === nextProfile.id ? nextProfile : item) : [...config.servers, nextProfile];
    return {
      ...config,
      servers,
      preferences: {
        ...config.preferences,
        activeServerId: nextProfile.id,
        lastRemotePath: nextProfile.rootPath
      }
    };
  });
}
async function activateServerProfile(serverId) {
  return updateConfig((config) => ({
    ...config,
    preferences: {
      ...config.preferences,
      activeServerId: serverId
    }
  }));
}
function testServerProfile(profile) {
  return testServerConnection(profile);
}
function listServerFiles(profile, remotePath) {
  return listRemoteFiles(profile, remotePath);
}
function resolveServerPath(profile, currentPath, targetName) {
  return resolveRemotePath(profile, currentPath, targetName);
}
function readServerFile(profile, remotePath) {
  return readRemoteFile(profile, remotePath);
}
function renameServerFile(profile, remotePath, newPath) {
  return renameRemoteFile(profile, remotePath, newPath);
}
function deleteServerFile(profile, remotePath) {
  return deleteRemoteFile(profile, remotePath);
}
function deleteServerDirectory(profile, remotePath) {
  return deleteRemoteDirectory(profile, remotePath);
}
function createServerDirectory(profile, remotePath) {
  return createRemoteDirectory(profile, remotePath);
}
function createServerFile(profile, remotePath) {
  return createRemoteFile(profile, remotePath);
}
function executeServerCommand(profile, command, cwd, onStdout, onStderr, onClose) {
  return executeRemoteCommand(profile, command, cwd, onStdout, onStderr, onClose);
}
function startServerTerminalSession(profile, onData) {
  return startTerminalSession(profile, onData);
}
function writeServerTerminalSession(sessionId, data) {
  return writeTerminalSession(sessionId, data);
}
function resizeServerTerminalSession(sessionId, cols, rows) {
  return resizeTerminalSession(sessionId, cols, rows);
}
function closeServerTerminalSession(sessionId) {
  return closeTerminalSession(sessionId);
}
function writeServerFile(profile, remotePath, content) {
  return writeRemoteFile(profile, remotePath, content);
}
function uploadServerFile(profile, localPath, remotePath) {
  return uploadRemoteFile(profile, localPath, remotePath || buildUploadTargetPath(profile.rootPath, localPath));
}
function downloadServerFile(profile, remotePath, localPath) {
  return downloadRemoteFile(profile, remotePath, localPath);
}
async function deleteServerProfile(serverId) {
  return updateConfig((config) => {
    const servers = config.servers.filter((item) => item.id !== serverId);
    const activeServerId = config.preferences.activeServerId === serverId ? "" : config.preferences.activeServerId;
    return {
      ...config,
      servers,
      preferences: {
        ...config.preferences,
        activeServerId
      }
    };
  });
}
async function deleteServerProfiles(serverIds) {
  return updateConfig((config) => {
    const servers = config.servers.filter((item) => !serverIds.includes(item.id));
    const activeServerId = serverIds.includes(config.preferences.activeServerId) ? "" : config.preferences.activeServerId;
    return {
      ...config,
      servers,
      preferences: {
        ...config.preferences,
        activeServerId
      }
    };
  });
}
function registerIpcHandlers() {
  ipcMain.handle("config:get", () => readConfig());
  ipcMain.handle("server:save", async (_event, profile) => {
    const config = await saveServerProfile(profile);
    return config.servers;
  });
  ipcMain.handle("server:activate", async (_event, serverId) => {
    const config = await activateServerProfile(serverId);
    return config.preferences;
  });
  ipcMain.handle("server:test", (_event, profile) => testServerProfile(profile));
  ipcMain.handle("files:list", (_event, profile, remotePath) => listServerFiles(profile, remotePath));
  ipcMain.handle(
    "files:resolve-path",
    (_event, profile, currentPath, targetName) => resolveServerPath(profile, currentPath, targetName)
  );
  ipcMain.handle("files:read", (_event, profile, remotePath) => readServerFile(profile, remotePath));
  ipcMain.handle("files:write", (_event, profile, remotePath, content) => writeServerFile(profile, remotePath, content));
  ipcMain.handle("files:rename", (_event, profile, remotePath, newPath) => renameServerFile(profile, remotePath, newPath));
  ipcMain.handle("files:delete", (_event, profile, remotePath) => deleteServerFile(profile, remotePath));
  ipcMain.handle("files:delete-dir", (_event, profile, remotePath) => deleteServerDirectory(profile, remotePath));
  ipcMain.handle("files:mkdir", (_event, profile, remotePath) => createServerDirectory(profile, remotePath));
  ipcMain.handle("files:create-file", (_event, profile, remotePath) => createServerFile(profile, remotePath));
  ipcMain.on("server:exec", async (event, channelId, profile, command, cwd) => {
    try {
      await executeServerCommand(
        profile,
        command,
        cwd,
        (data) => event.sender.send(`server:exec:stdout:${channelId}`, data),
        (data) => event.sender.send(`server:exec:stderr:${channelId}`, data),
        (code) => event.sender.send(`server:exec:close:${channelId}`, code)
      );
    } catch (err) {
      event.sender.send(`server:exec:error:${channelId}`, err.message);
    }
  });
  ipcMain.handle("terminal:start", async (event, profile) => {
    return await startServerTerminalSession(profile, (sessionId, data) => {
      event.sender.send(`terminal:incoming-data:${sessionId}`, data);
    });
  });
  ipcMain.on("terminal:data", (_event, sessionId, data) => {
    writeServerTerminalSession(sessionId, data);
  });
  ipcMain.on("terminal:resize", (_event, sessionId, cols, rows) => {
    resizeServerTerminalSession(sessionId, cols, rows);
  });
  ipcMain.on("terminal:close", (_event, sessionId) => {
    closeServerTerminalSession(sessionId);
  });
  ipcMain.handle(
    "files:upload",
    (_event, profile, localPath, remotePath) => uploadServerFile(profile, localPath, remotePath)
  );
  ipcMain.handle("files:download", async (_event, profile, remotePath) => {
    const target = await dialog.showSaveDialog({ defaultPath: remotePath.split("/").pop() || "download" });
    if (target.canceled || !target.filePath) return { ok: false };
    return downloadServerFile(profile, remotePath, target.filePath);
  });
  ipcMain.handle("files:pick-local", async () => {
    const result = await dialog.showOpenDialog({ properties: ["openFile", "multiSelections"] });
    return result.canceled ? [] : result.filePaths;
  });
  ipcMain.handle("local:read", (_event, filePath) => readFile(filePath, "utf8"));
  ipcMain.handle("local:write", async (_event, filePath, content) => {
    await writeFile(filePath, content, "utf8");
    return { ok: true };
  });
  ipcMain.handle("local:reveal-file", (_event, filePath) => {
    shell.showItemInFolder(filePath);
    return { ok: true };
  });
  ipcMain.handle("ai:save-profile", async (_event, profile) => {
    const config = await saveAiProfile(profile);
    return config.aiProfiles;
  });
  ipcMain.handle("ai:activate", async (_event, profileId) => {
    const config = await activateAiProfile(profileId);
    return config.preferences;
  });
  ipcMain.handle("ai:list-models", (_event, profile) => listAiModels(profile));
  ipcMain.handle("ai:chat", (_event, profile, messages) => sendAiChat(profile, messages));
  ipcMain.handle("server:delete", async (_event, serverId) => {
    const config = await deleteServerProfile(serverId);
    return config.servers;
  });
  ipcMain.handle("server:delete-multiple", async (_event, serverIds) => {
    const config = await deleteServerProfiles(serverIds);
    return config.servers;
  });
}
const __dirname$1 = dirname(fileURLToPath(import.meta.url));
const createWindow = () => {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 720,
    title: "Kernel AI",
    backgroundColor: "#0b1326",
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  console.log("VITE_DEV_SERVER_URL:", process.env.VITE_DEV_SERVER_URL);
  console.log("ELECTRON_RENDERER_URL:", process.env.ELECTRON_RENDERER_URL);
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else if (process.env.VITE_DEV_SERVER_URL) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void win.loadFile(join(__dirname$1, "../dist/index.html"));
  }
  win.webContents.on("did-finish-load", () => {
    void win.webContents.executeJavaScript(
      "window.__linuxAiBridgeState = { hasRuntime: !!window.linuxAiRuntime, hasBridge: !!window.linuxAi };"
    );
  });
  win.webContents.on("console-message", (event, level, message, line, sourceId) => {
    console.log(`[Renderer Console] Level ${level}: ${message} (${sourceId}:${line})`);
  });
};
app.whenReady().then(() => {
  registerIpcHandlers();
  createWindow();
});
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
function resolvePreloadPath() {
  const bundledPreload = join(__dirname$1, "preload.mjs");
  if (existsSync(bundledPreload)) return bundledPreload;
  return join(__dirname$1, "../dist-electron/preload.mjs");
}
