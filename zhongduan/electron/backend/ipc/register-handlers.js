import { dialog, ipcMain } from 'electron';
import { readFile, writeFile } from 'node:fs/promises';
import { readConfig } from '../repositories/config-repository.js';
import { activateAiProfile, saveAiProfile, sendAiChat } from '../services/ai-service.js';
import {
  activateServerProfile,
  downloadServerFile,
  listServerFiles,
  readServerFile,
  resolveServerPath,
  saveServerProfile,
  testServerProfile,
  uploadServerFile,
  writeServerFile,
  renameServerFile,
  deleteServerFile,
  deleteServerDirectory,
  createServerDirectory,
  deleteServerProfile,
  deleteServerProfiles
} from '../services/server-service.js';

export function registerIpcHandlers() {
  ipcMain.handle('config:get', () => readConfig());

  ipcMain.handle('server:save', async (_event, profile) => {
    const config = await saveServerProfile(profile);
    return config.servers;
  });

  ipcMain.handle('server:activate', async (_event, serverId) => {
    const config = await activateServerProfile(serverId);
    return config.preferences;
  });

  ipcMain.handle('server:test', (_event, profile) => testServerProfile(profile));

  ipcMain.handle('files:list', (_event, profile, remotePath) => listServerFiles(profile, remotePath));

  ipcMain.handle('files:resolve-path', (_event, profile, currentPath, targetName) =>
    resolveServerPath(profile, currentPath, targetName)
  );

  ipcMain.handle('files:read', (_event, profile, remotePath) => readServerFile(profile, remotePath));

  ipcMain.handle('files:write', (_event, profile, remotePath, content) => writeServerFile(profile, remotePath, content));

  ipcMain.handle('files:rename', (_event, profile, remotePath, newPath) => renameServerFile(profile, remotePath, newPath));

  ipcMain.handle('files:delete', (_event, profile, remotePath) => deleteServerFile(profile, remotePath));

  ipcMain.handle('files:delete-dir', (_event, profile, remotePath) => deleteServerDirectory(profile, remotePath));

  ipcMain.handle('files:mkdir', (_event, profile, remotePath) => createServerDirectory(profile, remotePath));

  ipcMain.handle('files:upload', (_event, profile, localPath, remotePath) =>
    uploadServerFile(profile, localPath, remotePath)
  );

  ipcMain.handle('files:download', async (_event, profile, remotePath) => {
    const target = await dialog.showSaveDialog({ defaultPath: remotePath.split('/').pop() || 'download' });
    if (target.canceled || !target.filePath) return { ok: false };
    return downloadServerFile(profile, remotePath, target.filePath);
  });

  ipcMain.handle('files:pick-local', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('local:read', (_event, filePath) => readFile(filePath, 'utf8'));

  ipcMain.handle('local:write', async (_event, filePath, content) => {
    await writeFile(filePath, content, 'utf8');
    return { ok: true };
  });

  ipcMain.handle('ai:save-profile', async (_event, profile) => {
    const config = await saveAiProfile(profile);
    return config.aiProfiles;
  });

  ipcMain.handle('ai:activate', async (_event, profileId) => {
    const config = await activateAiProfile(profileId);
    return config.preferences;
  });

  ipcMain.handle('ai:chat', (_event, profile, messages) => sendAiChat(profile, messages));

  ipcMain.handle('server:delete', async (_event, serverId) => {
    const config = await deleteServerProfile(serverId);
    return config.servers;
  });

  ipcMain.handle('server:delete-multiple', async (_event, serverIds) => {
    const config = await deleteServerProfiles(serverIds);
    return config.servers;
  });
}
