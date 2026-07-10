const STORAGE_KEY = 'linux-ai-connector-config';

const defaultConfig = {
  servers: [],
  aiProfiles: [
    {
      id: 'openai-compatible',
      name: 'OpenAI Compatible',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4.1'
    }
  ],
  preferences: {
    activeServerId: '',
    activeAiProfileId: 'openai-compatible',
    lastRemotePath: ''
  }
};

export function getRuntimeBridge() {
  if (typeof window !== 'undefined' && window.linuxAi) {
    return window.linuxAi;
  }

  return browserBridge;
}

export function isElectronRuntime() {
  return Boolean(typeof window !== 'undefined' && window.linuxAiRuntime?.isElectron);
}

const browserBridge = {
  async getConfig() {
    return readBrowserConfig();
  },
  async saveServer(profile) {
    const config = readBrowserConfig();
    const nextProfile = { ...profile };
    const servers = config.servers.some((item) => item.id === nextProfile.id)
      ? config.servers.map((item) => (item.id === nextProfile.id ? nextProfile : item))
      : [...config.servers, nextProfile];

    writeBrowserConfig({
      ...config,
      servers,
      preferences: {
        ...config.preferences,
        activeServerId: nextProfile.id,
        lastRemotePath: nextProfile.rootPath || config.preferences.lastRemotePath
      }
    });

    return servers;
  },
  async deleteServer(serverId) {
    const config = readBrowserConfig();
    const servers = config.servers.filter((item) => item.id !== serverId);
    writeBrowserConfig({
      ...config,
      servers,
      preferences: {
        ...config.preferences,
        activeServerId: config.preferences.activeServerId === serverId ? '' : config.preferences.activeServerId
      }
    });
    return servers;
  },
  async deleteServers(serverIds) {
    const config = readBrowserConfig();
    const servers = config.servers.filter((item) => !serverIds.includes(item.id));
    writeBrowserConfig({
      ...config,
      servers,
      preferences: {
        ...config.preferences,
        activeServerId: serverIds.includes(config.preferences.activeServerId) ? '' : config.preferences.activeServerId
      }
    });
    return servers;
  },
  async activateServer(serverId) {
    const config = readBrowserConfig();
    writeBrowserConfig({
      ...config,
      preferences: {
        ...config.preferences,
        activeServerId: serverId
      }
    });
    return readBrowserConfig().preferences;
  },
  async saveAiProfile(profile) {
    const config = readBrowserConfig();
    const nextProfile = { ...profile };
    const aiProfiles = config.aiProfiles.some((item) => item.id === nextProfile.id)
      ? config.aiProfiles.map((item) => (item.id === nextProfile.id ? nextProfile : item))
      : [...config.aiProfiles, nextProfile];

    writeBrowserConfig({
      ...config,
      aiProfiles,
      preferences: {
        ...config.preferences,
        activeAiProfileId: nextProfile.id
      }
    });

    return aiProfiles;
  },
  async activateAiProfile(profileId) {
    const config = readBrowserConfig();
    writeBrowserConfig({
      ...config,
      preferences: {
        ...config.preferences,
        activeAiProfileId: profileId
      }
    });
    return readBrowserConfig().preferences;
  },
  async chat(profile, messages) {
    const response = await fetch(`${profile.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${profile.apiKey}`
      },
      body: JSON.stringify({
        model: profile.model,
        messages,
        temperature: 0.2
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text || `AI 请求失败: ${response.status}`);
    }

    const payload = await response.json();
    return payload.choices?.[0]?.message?.content ?? '';
  },
  async testServer() {
    throw new Error('当前运行在浏览器预览模式，服务器连接、文件读写、上传下载需要从 Electron 桌面窗口启动。');
  },
  async listFiles() {
    throw new Error('当前运行在浏览器预览模式，文件列表需要从 Electron 桌面窗口启动。');
  },
  async readFile() {
    throw new Error('当前运行在浏览器预览模式，远程文件读取需要从 Electron 桌面窗口启动。');
  },
  async writeFile() {
    throw new Error('当前运行在浏览器预览模式，远程文件保存需要从 Electron 桌面窗口启动。');
  },
  async uploadFile() {
    throw new Error('当前运行在浏览器预览模式，文件上传需要从 Electron 桌面窗口启动。');
  },
  async downloadFile() {
    throw new Error('当前运行在浏览器预览模式，文件下载需要从 Electron 桌面窗口启动。');
  },
  async pickLocalFiles() {
    throw new Error('当前运行在浏览器预览模式，本地文件选择器需要从 Electron 桌面窗口启动。');
  },
  async revealFileInFolder() {
    throw new Error('当前运行在浏览器预览模式，无法打开本地下载位置。');
  },
  async renameFile() {
    throw new Error('当前运行在浏览器预览模式，重命名操作需要从 Electron 桌面窗口启动。');
  },
  async deleteFile() {
    throw new Error('当前运行在浏览器预览模式，删除文件操作需要从 Electron 桌面窗口启动。');
  },
  async deleteDirectory() {
    throw new Error('当前运行在浏览器预览模式，删除文件夹操作需要从 Electron 桌面窗口启动。');
  },
  async createDirectory() {
    throw new Error('当前运行在浏览器预览模式，新建文件夹操作需要从 Electron 桌面窗口启动。');
  },
  async createFile() {
    throw new Error('当前运行在浏览器预览模式，新建文件操作需要从 Electron 桌面窗口启动。');
  },
  executeCommand() {
    console.warn('浏览器预览模式不支持命令执行');
  },
  async startTerminalSession() {
    throw new Error('当前运行在浏览器预览模式，交互式终端需要从 Electron 桌面窗口启动。');
  },
  writeTerminalSession() {},
  resizeTerminalSession() {},
  closeTerminalSession() {},
  onTerminalData() {},
  removeTerminalListeners() {},
  onCommandStdout() {},
  onCommandStderr() {},
  onCommandClose() {},
  onCommandError() {},
  removeCommandListeners() {}
};

function readBrowserConfig() {
  if (typeof window === 'undefined') {
    return structuredClone(defaultConfig);
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(defaultConfig);
    return mergeConfig(JSON.parse(raw));
  } catch {
    return structuredClone(defaultConfig);
  }
}

function writeBrowserConfig(config) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mergeConfig(config)));
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
