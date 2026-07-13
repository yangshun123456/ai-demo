import { computed, reactive, ref } from 'vue';
import { defineStore } from 'pinia';
import { getRuntimeBridge, isElectronRuntime } from '../services/runtime-bridge';

const fallbackServer = {
  id: 'demo-server',
  name: '生产网关',
  host: '192.168.10.24',
  port: 22,
  username: 'root',
  password: '',
  privateKey: '',
  rootPath: '/var/www/html'
};

const fallbackAi = {
  id: 'openai-compatible',
  name: 'OpenAI Compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4.1',
  models: []
};

const demoFiles = [
  { type: 'd', name: 'apps', size: 4096, modifyTime: Date.now() - 1000 * 60 * 20, accessTime: Date.now() },
  { type: 'd', name: 'logs', size: 4096, modifyTime: Date.now() - 1000 * 60 * 90, accessTime: Date.now() },
  { type: '-', name: 'nginx.conf', size: 3120, modifyTime: Date.now() - 1000 * 60 * 12, accessTime: Date.now() },
  { type: '-', name: 'deploy.sh', size: 1480, modifyTime: Date.now() - 1000 * 60 * 8, accessTime: Date.now() },
  { type: '-', name: 'README.md', size: 2417, modifyTime: Date.now() - 1000 * 60 * 240, accessTime: Date.now() }
];

const demoContent = `server {
  listen 80;
  server_name app.example.com;

  root /var/www/html/apps/current;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:8080/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}`;

export const useWorkspaceStore = defineStore('workspace', () => {
  const servers = ref([]);
  const aiProfiles = ref([fallbackAi]);
  const serverDraft = reactive({ ...fallbackServer });
  const aiDraft = reactive({ ...fallbackAi });

  const sessions = ref([]);
  const activeSessionId = ref(null);
  const isSidebarCollapsed = ref(false);

  const activeSession = computed(() => sessions.value.find(s => s.id === activeSessionId.value));
  const activeServer = computed(() => activeSession.value?.server || null);
  const connected = computed(() => sessions.value.length > 0);

  const remotePath = computed({
    get: () => activeSession.value?.remotePath || '/',
    set: (val) => { if (activeSession.value) activeSession.value.remotePath = val; }
  });
  const files = computed({
    get: () => activeSession.value?.files || [],
    set: (val) => { if (activeSession.value) activeSession.value.files = val; }
  });
  const fileListServerKey = computed({
    get: () => activeSession.value?.fileListServerKey || '',
    set: (val) => { if (activeSession.value) activeSession.value.fileListServerKey = val; }
  });
  const selectedFile = computed({
    get: () => activeSession.value?.selectedFile || '',
    set: (val) => { if (activeSession.value) activeSession.value.selectedFile = val; }
  });
  const editorContent = computed({
    get: () => activeSession.value?.editorContent || '',
    set: (val) => { if (activeSession.value) activeSession.value.editorContent = val; }
  });
  const openTabs = computed({
    get: () => activeSession.value?.openTabs || [],
    set: (val) => { if (activeSession.value) activeSession.value.openTabs = val; }
  });
  const activeTab = computed({
    get: () => activeSession.value?.activeTab || null,
    set: (val) => { if (activeSession.value) activeSession.value.activeTab = val; }
  });
  const terminalLogs = computed({
    get: () => activeSession.value?.terminalLogs || [],
    set: (val) => { if (activeSession.value) activeSession.value.terminalLogs = val; }
  });
  const dirty = computed({
    get: () => activeSession.value?.dirty || false,
    set: (val) => { if (activeSession.value) activeSession.value.dirty = val; }
  });

  const directoryCache = ref({});
  const status = ref('离线预览模式');
  const busy = ref(false);
  const prompt = ref('');
  const systemPrompt = ref('你是 Kernel AI，一名高级 Linux 系统管理员助手。请提供准确、安全且高效的 Bash 脚本和系统配置建议。回答应简洁专业。');
  const messages = ref([
    {
      role: 'assistant',
      content: '我可以帮你解释配置、生成 shell 命令、检查日志异常，也可以结合当前打开的文件给出修改建议。'
    }
  ]);

  const fullSelectedPath = computed(() => joinRemotePath(remotePath.value, selectedFile.value));
  const pathParts = computed(() => remotePath.value.split('/').filter(Boolean));

  async function initConfig() {
    try {
      const bridge = getRuntimeBridge();
      const config = await bridge.getConfig();
      const loadedServers = config.servers || [];
      const loadedAi = config.aiProfiles.length ? config.aiProfiles : [fallbackAi];
      const activeServerId = config.preferences?.activeServerId;
      const activeAiProfileId = config.preferences?.activeAiProfileId;
      servers.value = loadedServers;
      aiProfiles.value = loadedAi;
      const currentServer = loadedServers.find((item) => item.id === activeServerId) || loadedServers[0] || null;
      const currentAi = loadedAi.find((item) => item.id === activeAiProfileId) || loadedAi[0];
      if (currentServer) {
        assign(serverDraft, currentServer);
      } else {
        // 如果没有服务器，清空当前激活服务器状态
        Object.keys(serverDraft).forEach((key) => delete serverDraft[key]);
      }
      assign(aiDraft, currentAi);
    } catch {
      status.value = isElectronRuntime()
        ? 'Electron 窗口已启动，但后台桥接没有挂载成功。'
        : 'Electron API 未连接，正在使用界面预览数据';
    }
  }

  async function saveServer() {
    try {
      const bridge = getRuntimeBridge();
      const next = { ...serverDraft, id: serverDraft.id || crypto.randomUUID(), port: Number(serverDraft.port) || 22 };
      servers.value = await bridge.saveServer(next);
      if (activeSession.value && activeSession.value.server.id === next.id) {
        activeSession.value.server = next;
      }
      status.value = '服务器配置已保存';
    } catch (error) {
      status.value = readableError(error, '当前未连接 Electron 后台，无法保存服务器配置。');
    }
  }

  async function testConnection() {
    busy.value = true;
    status.value = '正在连接服务器...';
    try {
      const bridge = getRuntimeBridge();
      const result = await bridge.testServer(JSON.parse(JSON.stringify(serverDraft)));
      status.value = result.message;
      if (result.ok) {
        const id = Date.now().toString() + Math.random().toString(16).slice(2, 6);
        const serverCopy = JSON.parse(JSON.stringify(serverDraft));
        const newSession = {
          id,
          server: serverCopy,
          remotePath: serverCopy.rootPath || '/',
          files: [],
          fileListServerKey: '',
          selectedFile: '',
          editorContent: '',
          openTabs: [],
          activeTab: null,
          terminalLogs: [],
          dirty: false,
          terminalSessionId: null
        };
        sessions.value.push(newSession);
        activeSessionId.value = id;
        await refreshFiles(newSession.server, newSession.remotePath);
      }
    } catch (error) {
      status.value = readableError(error, '连接失败');
    } finally {
      busy.value = false;
    }
  }

  function createSession(serverConfig) {
    const id = Date.now().toString() + Math.random().toString(16).slice(2, 6);
    const serverCopy = JSON.parse(JSON.stringify(serverConfig));
    const newSession = {
      id,
      server: serverCopy,
      remotePath: serverCopy.rootPath || '/',
      files: [],
      fileListServerKey: '',
      selectedFile: '',
      editorContent: '',
      openTabs: [],
      activeTab: null,
      terminalLogs: [],
      dirty: false,
      terminalSessionId: null
    };
    sessions.value.push(newSession);
    activeSessionId.value = id;
    return newSession;
  }

  function closeSession(id) {
    const idx = sessions.value.findIndex(s => s.id === id);
    if (idx !== -1) {
      sessions.value.splice(idx, 1);
      if (activeSessionId.value === id) {
        activeSessionId.value = sessions.value[idx]?.id || sessions.value[idx - 1]?.id || null;
      }
    }
  }

  async function refreshFiles(profile = activeServer.value, path = remotePath.value, returnOnly = false) {
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      const newFiles = await bridge.listFiles(JSON.parse(JSON.stringify(profile)), path);
      cacheFiles(profile, path, newFiles);
      if (returnOnly) {
        return newFiles;
      }
      files.value = newFiles;
      remotePath.value = path;
      fileListServerKey.value = getServerKey(profile);
      status.value = `已刷新 ${path}`;
      return newFiles;
    } catch (error) {
      status.value = readableError(error, '读取目录失败，保留预览数据');
      if (returnOnly) return [];
    } finally {
      busy.value = false;
    }
  }

  async function openFile(server, path, name) {
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      const content = await bridge.readFile(JSON.parse(JSON.stringify(server)), path);
      
      const existingTab = openTabs.value.find(t => t.path === path);
      if (existingTab) {
        existingTab.content = content;
        activeTab.value = existingTab;
      } else {
        const newTab = { name: name || path.split('/').pop(), path, content, originalContent: content, dirty: false };
        openTabs.value.push(newTab);
        activeTab.value = newTab;
      }
      status.value = `已打开 ${name || path}`;
    } catch {
      status.value = '远程文件读取失败，保留原状态';
    } finally {
      busy.value = false;
    }
  }

  async function openFileEntry(file) {
    if (!file?.name) return;

    const nextPath = joinRemotePath(remotePath.value, file.name);

    if (file.type === 'd') {
      await refreshFiles(activeServer.value, nextPath);
      selectedFile.value = '';
      return;
    }

    await openFile(activeServer.value, nextPath, file.name);
  }

  async function selectFileEntry(file) {
    if (!file?.name) return;

    if (file.type === 'd') {
      await openFileEntry(file);
      return;
    }

    selectedFile.value = file.name;
  }

  function closeTab(tabPath) {
    const idx = openTabs.value.findIndex(t => t.path === tabPath);
    if (idx !== -1) {
      openTabs.value.splice(idx, 1);
      if (activeTab.value?.path === tabPath) {
        activeTab.value = openTabs.value[idx] || openTabs.value[idx - 1] || null;
      }
    }
  }

  async function saveFile() {
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      await bridge.writeFile({ ...activeServer.value }, fullSelectedPath.value, editorContent.value);
      dirty.value = false;
      status.value = `已保存 ${fullSelectedPath.value}`;
    } catch (error) {
      status.value = readableError(error, '保存失败');
    } finally {
      busy.value = false;
    }
  }

  async function uploadLocalFiles(paths = []) {
    try {
      const bridge = getRuntimeBridge();
      const localPaths = paths.length ? paths : await bridge.pickLocalFiles();
      if (!localPaths.length) return;
      busy.value = true;
      for (const localPath of localPaths) {
        await bridge.uploadFile(
          { ...activeServer.value },
          localPath,
          joinRemotePath(remotePath.value, localPath.split('/').pop() || 'upload')
        );
      }
      await refreshFiles();
      status.value = `已上传 ${localPaths.length} 个文件`;
    } catch (error) {
      status.value = readableError(error, '上传失败');
    } finally {
      busy.value = false;
    }
  }

  async function downloadSelected() {
    if (!selectedFile.value) return;
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      const result = await bridge.downloadFile({ ...activeServer.value }, fullSelectedPath.value);
      status.value = result.ok ? `已下载到 ${result.path}` : '已取消下载';
    } catch (error) {
      status.value = readableError(error, '下载失败');
    } finally {
      busy.value = false;
    }
  }

  async function renameFile(oldName, newName) {
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      await bridge.renameFile({ ...activeServer.value }, joinRemotePath(remotePath.value, oldName), joinRemotePath(remotePath.value, newName));
      await refreshFiles();
      status.value = `已重命名 ${oldName} 为 ${newName}`;
    } catch (error) {
      status.value = readableError(error, '重命名失败');
    } finally {
      busy.value = false;
    }
  }

  async function deleteFile(file) {
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      const path = joinRemotePath(remotePath.value, file.name);
      if (file.type === 'd') {
        await bridge.deleteDirectory({ ...activeServer.value }, path);
      } else {
        await bridge.deleteFile({ ...activeServer.value }, path);
      }
      await refreshFiles();
      status.value = `已删除 ${file.name}`;
      if (selectedFile.value === file.name) selectedFile.value = '';
    } catch (error) {
      status.value = readableError(error, '删除失败');
    } finally {
      busy.value = false;
    }
  }

  async function createDirectory(server, remotePath) {
    if (!server?.host) return;
    busy.value = true;
    status.value = '正在创建目录...';
    try {
      const bridge = getRuntimeBridge();
      await bridge.createDirectory(JSON.parse(JSON.stringify(server)), remotePath);
      status.value = `目录已创建: ${remotePath}`;
    } catch (error) {
      status.value = `创建目录失败: ${readableError(error, '未知错误')}`;
    } finally {
      busy.value = false;
    }
  }

  async function createFile(server, remotePath) {
    if (!server?.host) return;
    busy.value = true;
    status.value = '正在创建文件...';
    try {
      const bridge = getRuntimeBridge();
      await bridge.createFile(JSON.parse(JSON.stringify(server)), remotePath);
      status.value = `文件已创建: ${remotePath}`;
    } catch (error) {
      status.value = `创建文件失败: ${readableError(error, '未知错误')}`;
    } finally {
      busy.value = false;
    }
  }

  function executeCommand(server, command, cwd, channelId) {
    if (!server?.host) return;
    const bridge = getRuntimeBridge();
    bridge.executeCommand(channelId, JSON.parse(JSON.stringify(server)), command, cwd);
  }

  async function saveAiProfile() {
    return saveAiProfileConfig(aiDraft);
  }

  async function saveAiProfileConfig(profile) {
    try {
      const bridge = getRuntimeBridge();
      const next = {
        ...profile,
        id: profile.id || crypto.randomUUID(),
        name: profile.name || profile.model,
        models: Array.isArray(profile.models) ? profile.models.filter(Boolean) : []
      };
      aiProfiles.value = await bridge.saveAiProfile(next);
      assign(aiDraft, next);
      status.value = '模型配置已保存';
      return next;
    } catch (error) {
      status.value = readableError(error, '当前未连接 Electron 后台，无法保存模型配置。');
      return null;
    }
  }

  async function fetchAiModels(profile = aiDraft) {
    busy.value = true;
    status.value = '正在连接大模型服务...';
    try {
      const bridge = getRuntimeBridge();
      const models = await bridge.listAiModels(JSON.parse(JSON.stringify(profile)));
      status.value = models.length ? `已获取 ${models.length} 个可用模型` : '连接成功，但没有返回可用模型';
      return models;
    } catch (error) {
      status.value = readableError(error, '获取模型失败');
      return [];
    } finally {
      busy.value = false;
    }
  }

  async function connectAndSaveAiProfile(profile = aiDraft) {
    const models = await fetchAiModels(profile);
    if (!models.length) return null;
    const selectedModel = models.includes(profile.model) ? profile.model : models[0];
    return saveAiProfileConfig({
      ...profile,
      model: selectedModel,
      name: profile.name || 'OpenAI Compatible',
      models
    });
  }

  async function sendMessage() {
    if (!prompt.value.trim()) return;
    const outgoing = { role: 'user', content: prompt.value.trim() };
    const context = {
      role: 'system',
      content: `${systemPrompt.value}\n\n当前服务器: ${activeServer.value?.name} ${activeServer.value?.host}. 当前路径: ${remotePath.value}. 当前文件: ${fullSelectedPath.value}.\n\n文件内容:\n${editorContent.value.slice(0, 6000)}`
    };
    messages.value.push(outgoing);
    prompt.value = '';
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      const reply = await bridge.chat(
        JSON.parse(JSON.stringify(aiDraft)),
        JSON.parse(JSON.stringify([
          context,
          ...messages.value.filter((item) => item.role !== 'system')
        ]))
      );
      messages.value.push({ role: 'assistant', content: reply });
      status.value = 'AI 已回复';
    } catch (error) {
      const errorMessage = readableError(error, '未知错误');
      messages.value.push({
        role: 'assistant',
        content: `AI 请求失败：${errorMessage}`
      });
      status.value = `AI 请求失败：${errorMessage}`;
    } finally {
      busy.value = false;
    }
  }

  function selectServer(server) {
    assign(serverDraft, server);
    const bridge = getRuntimeBridge();
    bridge?.activateServer(server.id).catch(() => {});
  }

  function getCachedFiles(profile = activeServer.value, path = remotePath.value) {
    return directoryCache.value[getCacheKey(profile, path)] || null;
  }

  function hasCachedFiles(profile = activeServer.value, path = remotePath.value) {
    return Boolean(getCachedFiles(profile, path));
  }

  function applyCachedFiles(profile = activeServer.value, path = remotePath.value) {
    const cachedFiles = getCachedFiles(profile, path);
    if (!cachedFiles) return false;
    files.value = cachedFiles;
    remotePath.value = path;
    fileListServerKey.value = getServerKey(profile);
    status.value = `已恢复 ${path}`;
    return true;
  }

  function selectAiProfile(profile) {
    assign(aiDraft, profile);
    const bridge = getRuntimeBridge();
    bridge?.activateAiProfile(profile.id).catch(() => {});
  }

  function markDirty() {
    dirty.value = true;
  }

  function cacheFiles(profile, path, nextFiles) {
    directoryCache.value[getCacheKey(profile, path)] = nextFiles;
  }

  return {
    servers,
    sessions,
    activeSessionId,
    activeSession,
    isSidebarCollapsed,
    createSession,
    closeSession,
    aiProfiles,
    activeServer,
    serverDraft,
    aiDraft,
    remotePath,
    files,
    fileListServerKey,
    selectedFile,
    editorContent,
    openTabs,
    activeTab,
    terminalLogs,
    dirty,
    connected,
    status,
    busy,
    prompt,
    systemPrompt,
    messages,
    fullSelectedPath,
    pathParts,
    initConfig,
    saveServer,
    testConnection,
    refreshFiles,
    getCachedFiles,
    hasCachedFiles,
    applyCachedFiles,
    openFile,
    openFileEntry,
    selectFileEntry,
    saveFile,
    uploadLocalFiles,
    downloadSelected,
    renameFile,
    deleteFile,
    createDirectory,
    createFile,
    executeCommand,
    closeTab,
    saveAiProfile,
    saveAiProfileConfig,
    fetchAiModels,
    connectAndSaveAiProfile,
    sendMessage,
    selectServer,
    selectAiProfile,
    markDirty
  };
});

function assign(target, source) {
  Object.keys(target).forEach((key) => delete target[key]);
  Object.assign(target, source);
}

function joinRemotePath(base, name) {
  return `${base.replace(/\/$/, '')}/${name.replace(/^\//, '')}`;
}

function getServerKey(profile = {}) {
  return profile.id || `${profile.username || ''}@${profile.host || ''}:${profile.port || 22}`;
}

function getCacheKey(profile, path) {
  return `${getServerKey(profile)}::${path || '/'}`;
}

function readableError(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}
