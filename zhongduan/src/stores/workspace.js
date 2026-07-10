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
  model: 'gpt-4.1'
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
  const activeServer = reactive({ ...fallbackServer });
  const serverDraft = reactive({ ...fallbackServer });
  const aiDraft = reactive({ ...fallbackAi });
  const remotePath = ref(fallbackServer.rootPath);
  const files = ref(demoFiles);
  const selectedFile = ref('nginx.conf');
  const editorContent = ref(demoContent);
  const dirty = ref(false);
  const connected = ref(false);
  const status = ref('离线预览模式');
  const busy = ref(false);
  const prompt = ref('');
  const systemPrompt = ref('你是一个高级 Linux 系统管理员 AI 助手。请提供准确、安全且高效的 Bash 脚本和系统配置建议。回答应简洁专业。');
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
        assign(activeServer, currentServer);
        assign(serverDraft, currentServer);
        remotePath.value = config.preferences?.lastRemotePath || currentServer.rootPath;
      } else {
        // 如果没有服务器，清空当前激活服务器状态
        Object.keys(activeServer).forEach((key) => delete activeServer[key]);
        Object.keys(serverDraft).forEach((key) => delete serverDraft[key]);
        remotePath.value = '/';
      }
      assign(aiDraft, currentAi);
      if (loadedServers.length && currentServer) {
        refreshFiles(currentServer, remotePath.value).catch(() => {});
      }
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
      assign(activeServer, next);
      remotePath.value = next.rootPath;
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
      connected.value = result.ok;
      status.value = result.message;
      if (result.ok) {
        assign(activeServer, serverDraft);
        await refreshFiles(activeServer, activeServer.rootPath);
      }
    } catch (error) {
      connected.value = false;
      status.value = readableError(error, '连接失败');
    } finally {
      busy.value = false;
    }
  }

  async function refreshFiles(profile = activeServer, path = remotePath.value) {
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      files.value = await bridge.listFiles({ ...profile }, path);
      remotePath.value = path;
      status.value = `已刷新 ${path}`;
    } catch (error) {
      status.value = readableError(error, '读取目录失败，保留预览数据');
    } finally {
      busy.value = false;
    }
  }

  async function openFile(file) {
    if (file.type === 'd') {
      await refreshFiles(activeServer, joinRemotePath(remotePath.value, file.name));
      return;
    }
    selectedFile.value = file.name;
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      editorContent.value = await bridge.readFile({ ...activeServer }, joinRemotePath(remotePath.value, file.name));
      dirty.value = false;
      status.value = `已打开 ${file.name}`;
    } catch {
      editorContent.value = file.name === 'nginx.conf' ? demoContent : `# ${file.name}\n\n`;
      dirty.value = false;
      status.value = '远程文件读取失败，已打开本地预览内容';
    } finally {
      busy.value = false;
    }
  }

  async function saveFile() {
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      await bridge.writeFile({ ...activeServer }, fullSelectedPath.value, editorContent.value);
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
          { ...activeServer },
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
      const result = await bridge.downloadFile({ ...activeServer }, fullSelectedPath.value);
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
      await bridge.renameFile({ ...activeServer }, joinRemotePath(remotePath.value, oldName), joinRemotePath(remotePath.value, newName));
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
        await bridge.deleteDirectory({ ...activeServer }, path);
      } else {
        await bridge.deleteFile({ ...activeServer }, path);
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

  async function createDirectory(name) {
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      await bridge.createDirectory({ ...activeServer }, joinRemotePath(remotePath.value, name));
      await refreshFiles();
      status.value = `已创建文件夹 ${name}`;
    } catch (error) {
      status.value = readableError(error, '创建文件夹失败');
    } finally {
      busy.value = false;
    }
  }

  async function saveAiProfile() {
    try {
      const bridge = getRuntimeBridge();
      const next = { ...aiDraft, id: aiDraft.id || crypto.randomUUID() };
      aiProfiles.value = await bridge.saveAiProfile(next);
      assign(aiDraft, next);
      status.value = '模型配置已保存';
    } catch (error) {
      status.value = readableError(error, '当前未连接 Electron 后台，无法保存模型配置。');
    }
  }

  async function sendMessage() {
    if (!prompt.value.trim()) return;
    const outgoing = { role: 'user', content: prompt.value.trim() };
    const context = {
      role: 'system',
      content: `${systemPrompt.value}\n\n当前服务器: ${activeServer.name} ${activeServer.host}. 当前路径: ${remotePath.value}. 当前文件: ${fullSelectedPath.value}.\n\n文件内容:\n${editorContent.value.slice(0, 6000)}`
    };
    messages.value.push(outgoing);
    prompt.value = '';
    busy.value = true;
    try {
      const bridge = getRuntimeBridge();
      const reply = await bridge.chat(
        { ...aiDraft },
        [context, ...messages.value.filter((item) => item.role !== 'system')]
      );
      messages.value.push({ role: 'assistant', content: reply });
      status.value = 'AI 已回复';
    } catch {
      messages.value.push({
        role: 'assistant',
        content: 'AI 接口还没有连通。保存模型的 Base URL、API Key 和模型名后，就可以直接对话。'
      });
      status.value = 'AI 请求未完成，已返回本地提示';
    } finally {
      busy.value = false;
    }
  }

  function selectServer(server) {
    assign(activeServer, server);
    assign(serverDraft, server);
    remotePath.value = server.rootPath;
    const bridge = getRuntimeBridge();
    bridge?.activateServer(server.id).catch(() => {});
    refreshFiles(server, server.rootPath).catch(() => {});
  }

  function selectAiProfile(profile) {
    assign(aiDraft, profile);
    const bridge = getRuntimeBridge();
    bridge?.activateAiProfile(profile.id).catch(() => {});
  }

  function markDirty() {
    dirty.value = true;
  }

  return {
    servers,
    aiProfiles,
    activeServer,
    serverDraft,
    aiDraft,
    remotePath,
    files,
    selectedFile,
    editorContent,
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
    openFile,
    saveFile,
    uploadLocalFiles,
    downloadSelected,
    renameFile,
    deleteFile,
    createDirectory,
    saveAiProfile,
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

function readableError(error, fallback) {
  return error instanceof Error ? error.message : fallback;
}
