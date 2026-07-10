import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('linuxAiRuntime', {
  isElectron: true
});

contextBridge.exposeInMainWorld('linuxAi', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveServer: (profile) => ipcRenderer.invoke('server:save', profile),
  deleteServer: (serverId) => ipcRenderer.invoke('server:delete', serverId),
  deleteServers: (serverIds) => ipcRenderer.invoke('server:delete-multiple', serverIds),
  activateServer: (serverId) => ipcRenderer.invoke('server:activate', serverId),
  testServer: (profile) => ipcRenderer.invoke('server:test', profile),
  listFiles: (profile, remotePath) => ipcRenderer.invoke('files:list', profile, remotePath),
  readFile: (profile, remotePath) => ipcRenderer.invoke('files:read', profile, remotePath),
  writeFile: (profile, remotePath, content) => ipcRenderer.invoke('files:write', profile, remotePath, content),
  renameFile: (profile, remotePath, newPath) => ipcRenderer.invoke('files:rename', profile, remotePath, newPath),
  deleteFile: (profile, remotePath) => ipcRenderer.invoke('files:delete', profile, remotePath),
  deleteDirectory: (profile, remotePath) => ipcRenderer.invoke('files:delete-dir', profile, remotePath),
  createDirectory: (profile, remotePath) => ipcRenderer.invoke('files:mkdir', profile, remotePath),
  createFile: (profile, remotePath) => ipcRenderer.invoke('files:create-file', profile, remotePath),
  executeCommand: (channelId, profile, command, cwd) => ipcRenderer.send('server:exec', channelId, profile, command, cwd),
  startTerminalSession: (profile) => ipcRenderer.invoke('terminal:start', profile),
  writeTerminalSession: (sessionId, data) => ipcRenderer.send('terminal:data', sessionId, data),
  resizeTerminalSession: (sessionId, cols, rows) => ipcRenderer.send('terminal:resize', sessionId, cols, rows),
  closeTerminalSession: (sessionId) => ipcRenderer.send('terminal:close', sessionId),
  onTerminalData: (sessionId, callback) => ipcRenderer.on(`terminal:incoming-data:${sessionId}`, (_event, data) => callback(data)),
  removeTerminalListeners: (sessionId) => ipcRenderer.removeAllListeners(`terminal:incoming-data:${sessionId}`),
  onCommandStdout: (channelId, callback) => ipcRenderer.on(`server:exec:stdout:${channelId}`, (_event, data) => callback(data)),
  onCommandStderr: (channelId, callback) => ipcRenderer.on(`server:exec:stderr:${channelId}`, (_event, data) => callback(data)),
  onCommandClose: (channelId, callback) => ipcRenderer.on(`server:exec:close:${channelId}`, (_event, code) => callback(code)),
  onCommandError: (channelId, callback) => ipcRenderer.on(`server:exec:error:${channelId}`, (_event, err) => callback(err)),
  removeCommandListeners: (channelId) => {
    ipcRenderer.removeAllListeners(`server:exec:stdout:${channelId}`);
    ipcRenderer.removeAllListeners(`server:exec:stderr:${channelId}`);
    ipcRenderer.removeAllListeners(`server:exec:close:${channelId}`);
    ipcRenderer.removeAllListeners(`server:exec:error:${channelId}`);
  },
  uploadFile: (profile, localPath, remotePath) => ipcRenderer.invoke('files:upload', profile, localPath, remotePath),
  downloadFile: (profile, remotePath) => ipcRenderer.invoke('files:download', profile, remotePath),
  pickLocalFiles: () => ipcRenderer.invoke('files:pick-local'),
  revealFileInFolder: (filePath) => ipcRenderer.invoke('local:reveal-file', filePath),
  saveAiProfile: (profile) => ipcRenderer.invoke('ai:save-profile', profile),
  activateAiProfile: (profileId) => ipcRenderer.invoke('ai:activate', profileId),
  chat: (profile, messages) => ipcRenderer.invoke('ai:chat', profile, messages)
});
