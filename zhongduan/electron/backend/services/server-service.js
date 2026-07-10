import { updateConfig } from '../repositories/config-repository.js';
import {
  buildUploadTargetPath,
  downloadRemoteFile,
  listRemoteFiles,
  normalizeServerProfile,
  readRemoteFile,
  resolveRemotePath,
  testServerConnection,
  uploadRemoteFile,
  writeRemoteFile,
  renameRemoteFile,
  deleteRemoteFile,
  deleteRemoteDirectory,
  createRemoteDirectory
} from './ssh-service.js';

export async function saveServerProfile(profile) {
  const nextProfile = {
    ...normalizeServerProfile(profile),
    id: profile.id || crypto.randomUUID()
  };

  return updateConfig((config) => {
    const servers = config.servers.some((item) => item.id === nextProfile.id)
      ? config.servers.map((item) => (item.id === nextProfile.id ? nextProfile : item))
      : [...config.servers, nextProfile];

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

export async function activateServerProfile(serverId) {
  return updateConfig((config) => ({
    ...config,
    preferences: {
      ...config.preferences,
      activeServerId: serverId
    }
  }));
}

export function testServerProfile(profile) {
  return testServerConnection(profile);
}

export function listServerFiles(profile, remotePath) {
  return listRemoteFiles(profile, remotePath);
}

export function resolveServerPath(profile, currentPath, targetName) {
  return resolveRemotePath(profile, currentPath, targetName);
}

export function readServerFile(profile, remotePath) {
  return readRemoteFile(profile, remotePath);
}

export function renameServerFile(profile, remotePath, newPath) {
  return renameRemoteFile(profile, remotePath, newPath);
}

export function deleteServerFile(profile, remotePath) {
  return deleteRemoteFile(profile, remotePath);
}

export function deleteServerDirectory(profile, remotePath) {
  return deleteRemoteDirectory(profile, remotePath);
}

export function createServerDirectory(profile, remotePath) {
  return createRemoteDirectory(profile, remotePath);
}

export function writeServerFile(profile, remotePath, content) {
  return writeRemoteFile(profile, remotePath, content);
}

export function uploadServerFile(profile, localPath, remotePath) {
  return uploadRemoteFile(profile, localPath, remotePath || buildUploadTargetPath(profile.rootPath, localPath));
}

export function downloadServerFile(profile, remotePath, localPath) {
  return downloadRemoteFile(profile, remotePath, localPath);
}

export async function deleteServerProfile(serverId) {
  return updateConfig((config) => {
    const servers = config.servers.filter((item) => item.id !== serverId);
    const activeServerId = config.preferences.activeServerId === serverId ? '' : config.preferences.activeServerId;
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

export async function deleteServerProfiles(serverIds) {
  return updateConfig((config) => {
    const servers = config.servers.filter((item) => !serverIds.includes(item.id));
    const activeServerId = serverIds.includes(config.preferences.activeServerId) ? '' : config.preferences.activeServerId;
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
