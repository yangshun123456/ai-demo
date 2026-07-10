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
  uploadFile: (profile, localPath, remotePath) => ipcRenderer.invoke('files:upload', profile, localPath, remotePath),
  downloadFile: (profile, remotePath) => ipcRenderer.invoke('files:download', profile, remotePath),
  pickLocalFiles: () => ipcRenderer.invoke('files:pick-local'),
  saveAiProfile: (profile) => ipcRenderer.invoke('ai:save-profile', profile),
  activateAiProfile: (profileId) => ipcRenderer.invoke('ai:activate', profileId),
  chat: (profile, messages) => ipcRenderer.invoke('ai:chat', profile, messages)
});
