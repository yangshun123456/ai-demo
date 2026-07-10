import { readFile } from 'node:fs/promises';
import { basename, posix } from 'node:path';
import crypto from 'node:crypto';
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
  const connection = await createConnection(profile);
  connection.end();
  return { ok: true, message: '连接成功' };
}

async function connectSftp(sftp, profile) {
  const normalized = await prepareProfile(profile);
  await sftp.connect(toSsh2Config(normalized));
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

export async function createRemoteFile(profile, remotePath) {
  const sftp = new SftpClient();
  try {
    await connectSftp(sftp, profile);
    await sftp.put(Buffer.from(''), remotePath);
    return { ok: true };
  } finally {
    await closeSftp(sftp);
  }
}

export async function executeRemoteCommand(profile, command, cwd, onStdout, onStderr, onClose) {
  const normalized = await prepareProfile(profile);
  const client = new Client();
  
  return new Promise((resolve, reject) => {
    client.on('ready', () => {
      const execOptions = cwd ? { env: { PWD: cwd } } : {};
      const fullCommand = cwd ? `cd "${cwd}" && ${command}` : command;
      
      client.exec(fullCommand, execOptions, (err, stream) => {
        if (err) {
          client.end();
          return reject(err);
        }
        stream.on('close', (code, signal) => {
          client.end();
          if (onClose) onClose(code);
        }).on('data', (data) => {
          if (onStdout) onStdout(data.toString('utf8'));
        }).stderr.on('data', (data) => {
          if (onStderr) onStderr(data.toString('utf8'));
        });
        resolve({ ok: true });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect(toSsh2Config(normalized));
  });
}

const activeTerminals = new Map();

export async function startTerminalSession(profile, onData) {
  const normalized = await prepareProfile(profile);
  const client = new Client();
  const sessionId = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    client.on('ready', () => {
      client.shell((err, stream) => {
        if (err) {
          client.end();
          return reject(err);
        }
        
        activeTerminals.set(sessionId, { client, stream });

        stream.on('close', () => {
          client.end();
          activeTerminals.delete(sessionId);
        }).on('data', (data) => {
          if (onData) onData(sessionId, data.toString('utf8'));
        });
        
        resolve(sessionId);
      });
    }).on('error', (err) => {
      reject(err);
    }).connect(toSsh2Config(normalized));
  });
}

export function writeTerminalSession(sessionId, data) {
  const session = activeTerminals.get(sessionId);
  if (session && session.stream) {
    session.stream.write(data);
  }
}

export function resizeTerminalSession(sessionId, cols, rows) {
  const session = activeTerminals.get(sessionId);
  if (session && session.stream && typeof session.stream.setWindow === 'function') {
    session.stream.setWindow(rows, cols, 0, 0); // SSH2 setWindow signature: (rows, cols, height, width)
  }
}

export function closeTerminalSession(sessionId) {
  const session = activeTerminals.get(sessionId);
  if (session) {
    if (session.client) session.client.end();
    activeTerminals.delete(sessionId);
  }
}

async function createConnection(profile) {
  const normalized = await prepareProfile(profile);

  return new Promise((resolve, reject) => {
    const client = new Client();
    let settled = false;

    client
      .on('ready', () => {
        settled = true;
        resolve(client);
      })
      .on('error', (error) => {
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
