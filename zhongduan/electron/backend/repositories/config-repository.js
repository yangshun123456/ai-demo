import { app } from 'electron';
import { mkdir, readFile, writeFile, readdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

export const defaultConfig = {
  servers: [],
  aiProfiles: [
    {
      id: 'openai-compatible',
      name: 'OpenAI Compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4.1',
      models: []
    }
  ],
  preferences: {
    activeServerId: '',
    activeAiProfileId: 'openai-compatible',
    lastRemotePath: ''
  }
};

// 自定义服务器配置文件目录
function serversConfigDirPath() {
  return join(process.cwd(), 'servers_config');
}

function configPath() {
  return join(app.getPath('userData'), 'linux-ai-connector.json');
}

export async function readConfig() {
  // 1. 读取主配置（首选项和 AI 配置）
  let mainConfig = {};
  try {
    const raw = await readFile(configPath(), 'utf8');
    mainConfig = JSON.parse(raw);
  } catch {
    mainConfig = structuredClone(defaultConfig);
  }

  // 2. 从自定义的 servers_config 目录中读取所有服务器配置文件
  const dirPath = serversConfigDirPath();
  const loadedServers = [];
  try {
    if (existsSync(dirPath)) {
      const files = await readdir(dirPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
          try {
            const rawServer = await readFile(join(dirPath, file), 'utf8');
            const serverProfile = JSON.parse(rawServer);
            if (serverProfile && serverProfile.id) {
              loadedServers.push(serverProfile);
            }
          } catch (e) {
            console.error(`读取服务器配置文件 ${file} 失败:`, e);
          }
        }
      }
    }
  } catch (err) {
    console.error('读取 servers_config 目录失败:', err);
  }

  // 3. 将加载的服务器列表合并入主配置中
  mainConfig.servers = loadedServers;
  return mergeConfig(mainConfig);
}

export async function writeConfig(config) {
  // 1. 保存首选项和 AI 配置到主配置文件（主配置文件中置空 servers，避免冗余）
  const mainConfigToSave = {
    ...config,
    servers: []
  };
  await mkdir(app.getPath('userData'), { recursive: true });
  await writeFile(configPath(), JSON.stringify(mergeConfig(mainConfigToSave), null, 2), 'utf8');

  // 2. 持久化服务器到自定义的 servers_config 目录
  const dirPath = serversConfigDirPath();
  await mkdir(dirPath, { recursive: true });

  // 获取最新的服务器 ID 集合
  const serverIds = (config.servers || []).map(s => s.id);

  // 清理在 `servers_config` 中已不存在于列表里的 JSON 文件
  try {
    if (existsSync(dirPath)) {
      const files = await readdir(dirPath);
      for (const file of files) {
        if (file.endsWith('.json')) {
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
    console.error('清理已删除的服务器文件失败:', err);
  }

  // 写入或更新现存服务器配置文件
  for (const server of config.servers || []) {
    const filePath = join(dirPath, `server-${server.id}.json`);
    try {
      await writeFile(filePath, JSON.stringify(server, null, 2), 'utf8');
    } catch (e) {
      console.error(`保存服务器配置文件 ${server.id} 失败:`, e);
    }
  }
}

export async function updateConfig(updater) {
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
