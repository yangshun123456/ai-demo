import { readFile } from 'node:fs/promises';
import { basename, posix } from 'node:path';
import { Client } from 'ssh2';
import SftpClient from 'ssh2-sftp-client';

export function normalizeServerProfile(profile) {
  return {
    id: profile.id,
    name: (profile.name || '').trim(),
    host: (profile.host || '').trim(),
    port: Number(profile.port) || 22,
    username: (profile.username || '').trim(),
    password: profile.password || '',
    privateKey: (profile.privateKey || '').trim(),
    rootPath: (profile.rootPath || '/').trim() || '/'
  };
}

export async function testServerConnection(profile) {
  console.log(`[SSH Backend] 开始尝试建立测试连接...
  - 服务器: ${profile.name}
  - 地址: ${profile.host}:${profile.port}
  - 用户名: ${profile.username}
  - 认证方式: ${profile.privateKey ? 'SSH 私钥' : '密码'}`);

  try {
    const connection = await createConnection(profile);
    console.log(`[SSH Backend] 测试连接成功: ${profile.name} (${profile.host})`);
    connection.end();
    return { ok: true, message: '连接成功' };
  } catch (error) {
    console.error(`[SSH Backend] 测试连接失败: ${profile.name} (${profile.host}), 错误: ${error.message}`);
    throw error;
  }
}

async function connectSftp(sftp, profile) {
  const normalized = await prepareProfile(profile);
  console.log(`[SFTP Connection] 正在与远程主机建立 SFTP 连接...
  - 服务器: ${normalized.name}
  - 地址: ${normalized.host}:${normalized.port}
  - 用户名: ${normalized.username}
  - 认证方式: ${normalized.privateKey ? 'SSH 私钥' : '密码'}`);

  try {
    await sftp.connect(toSsh2Config(normalized));
    console.log(`[SFTP Connection] 与远程主机 ${normalized.host}:${normalized.port} 建立 SFTP 连接成功`);
  } catch (error) {
    console.error(`[SFTP Connection] 远程主机 ${normalized.host}:${normalized.port} SFTP 连接失败: ${error.message}`);
    throw error;
  }
}

export async function listRemoteFiles(profile, remotePath) {
  const sftp = new SftpClient();

  try {
    await connectSftp(sftp, profile);
    const entries = await sftp.list(remotePath);

    return entries
      .map((entry) => ({
        type: entry.type === 'd' ? 'd' : '-',
        name: entry.name,
        size: Number(entry.size) || 0,
        modifyTime: Number(entry.modifyTime) || Date.now(),
        accessTime: Number(entry.accessTime) || Date.now()
      }))
      .sort(sortFiles);
  } finally {
    await closeSftp(sftp);
  }
}

export async function readRemoteFile(profile, remotePath) {
  const sftp = new SftpClient();

  try {
    await connectSftp(sftp, profile);
    const content = await sftp.get(remotePath);
    if (Buffer.isBuffer(content)) return content.toString('utf8');
    return String(content);
  } finally {
    await closeSftp(sftp);
  }
}

export async function writeRemoteFile(profile, remotePath, content) {
  const sftp = new SftpClient();

  try {
    await connectSftp(sftp, profile);
    await sftp.put(Buffer.from(content, 'utf8'), remotePath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}

export async function uploadRemoteFile(profile, localPath, remotePath) {
  const sftp = new SftpClient();

  try {
    await connectSftp(sftp, profile);
    await sftp.fastPut(localPath, remotePath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}

export async function downloadRemoteFile(profile, remotePath, localPath) {
  const sftp = new SftpClient();

  try {
    await connectSftp(sftp, profile);
    await sftp.fastGet(remotePath, localPath);
    return { ok: true, path: localPath };
  } finally {
    await closeSftp(sftp);
  }
}

export async function resolveRemotePath(profile, currentPath, targetName) {
  if (!targetName || targetName === '.') return currentPath;
  if (targetName === '..') {
    const parent = posix.dirname(currentPath);
    return parent === '.' ? '/' : parent;
  }

  const nextPath = targetName.startsWith('/')
    ? posix.normalize(targetName)
    : posix.normalize(posix.join(currentPath, targetName));

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

export async function renameRemoteFile(profile, remotePath, newPath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.rename(remotePath, newPath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}

export async function deleteRemoteFile(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.delete(remotePath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}

export async function deleteRemoteDirectory(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.rmdir(remotePath, true);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}

export async function createRemoteDirectory(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.mkdir(remotePath, true);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}

async function createConnection(profile) {
  const normalized = await prepareProfile(profile);
  console.log(`[SSH Connection] 正在与远程主机建立连接 ${normalized.host}:${normalized.port} as ${normalized.username}...`);

  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;

    client
      .on('ready', () => {
        settled = true;
        console.log(`[SSH Connection] 与远程主机 ${normalized.host}:${normalized.port} 建立连接成功`);
        resolve(client);
      })
      .on('error', (error) => {
        console.error(`[SSH Connection] 远程主机 ${normalized.host}:${normalized.port} 连接失败: ${error.message}`);
        if (!settled) reject(error);
      })
      .connect(toSsh2Config(normalized));
  });
}

async function prepareProfile(profile) {
  const normalized = normalizeServerProfile(profile);
  validateServerProfile(normalized);

  let privateKeyContent = undefined;
  if (normalized.privateKey) {
    // 如果是直接粘贴的私钥内容（包含头部标识），则直接使用；否则视为文件路径进行读取
    if (normalized.privateKey.includes('-----BEGIN')) {
      privateKeyContent = normalized.privateKey;
    } else {
      privateKeyContent = await readFile(normalized.privateKey, 'utf8');
    }
  }

  return {
    ...normalized,
    privateKeyContent
  };
}

function validateServerProfile(profile) {
  if (!profile.name || !profile.host || !profile.username || !profile.rootPath) {
    throw new Error('请先完整填写服务器名称、地址、用户名和根目录。');
  }

  if (!profile.password && !profile.privateKey) {
    throw new Error('请填写密码或私钥路径后再连接服务器。');
  }
}

function toSsh2Config(profile) {
  const config = {
    host: profile.host,
    port: profile.port,
    username: profile.username,
    readyTimeout: 20000
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
    return undefined;
  }
}

function sortFiles(left, right) {
  if (left.type !== right.type) {
    return left.type === 'd' ? -1 : 1;
  }
  return left.name.localeCompare(right.name, 'zh-CN');
}

export function buildUploadTargetPath(currentPath, localPath) {
  return posix.join(currentPath, basename(localPath));
}
