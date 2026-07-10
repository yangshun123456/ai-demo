<script setup>
import { computed, onActivated, onMounted, onUnmounted, ref, shallowRef, watch, nextTick } from 'vue';
import { useRouter } from 'vue-router';
import { 
  Bell, HelpCircle, FilePlus, FolderPlus, RefreshCw, X, Save, ChevronDown, Trash2, Download, FolderOpen, Loader2
} from '@lucide/vue';
import * as monaco from 'monaco-editor';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useWorkspaceStore } from '../stores/workspace';
import AppSidebar from '../components/AppSidebar.vue';
import FileTreeItem from '../components/FileTreeItem.vue';

defineOptions({ name: 'FileBrowserView' });

const router = useRouter();
const workspace = useWorkspaceStore();

const editorContainer = ref(null);
const editorInstance = shallowRef(null);
const xtermContainer = ref(null);
const terminalSessionId = ref(null);

const pathInputValue = ref(workspace.remotePath || '/');
const rootNode = ref({ name: '/', path: '/', type: 'd', children: [], childrenLoaded: false });
const treeVersion = ref(0);
const downloadItems = ref([]);
const operationLoading = ref(false);
const operationLoadingText = ref('');
const savingFile = ref(false);
const hasActiveConnection = computed(() => Boolean(workspace.connected && workspace.activeServer?.host));
const activeServerKey = computed(() => (
  workspace.activeServer?.id ||
  `${workspace.activeServer?.username || ''}@${workspace.activeServer?.host || ''}:${workspace.activeServer?.port || 22}`
));
const shouldRefreshFilesOnMount = computed(() => (
  hasActiveConnection.value &&
  (
    workspace.fileListServerKey !== activeServerKey.value ||
    !workspace.hasCachedFiles(workspace.activeServer, workspace.remotePath || '/')
  )
));
const dialogState = ref({
  show: false,
  mode: 'confirm',
  title: '',
  message: '',
  label: '',
  value: '',
  placeholder: '',
  confirmText: '确认',
  danger: false,
  resolver: null
});

watch(() => workspace.remotePath, (newPath) => {
  pathInputValue.value = newPath;
});

const normalizeRemotePath = (path) => {
  const trimmedPath = String(path || '').trim();
  if (!trimmedPath) return '/';
  return trimmedPath.startsWith('/') ? trimmedPath : `/${trimmedPath}`;
};

const jumpToPath = async () => {
  if (!hasActiveConnection.value) {
    workspace.status = '暂无连接';
    return;
  }
  const nextPath = normalizeRemotePath(pathInputValue.value);
  pathInputValue.value = nextPath;
  if (nextPath === workspace.remotePath) return;
  await workspace.refreshFiles(workspace.activeServer, nextPath);
};

const joinRemotePath = (base = '/', name = '') => {
  const normalizedBase = base === '/' ? '' : String(base).replace(/\/$/, '');
  return `${normalizedBase}/${String(name).replace(/^\//, '')}`;
};

const dirname = (path = '/') => {
  const cleanPath = String(path || '/').replace(/\/+$/, '') || '/';
  if (cleanPath === '/') return '/';
  const parent = cleanPath.split('/').slice(0, -1).join('/');
  return parent || '/';
};

const getTargetDirectory = (node) => {
  if (!node) return workspace.remotePath || '/';
  return node.type === 'd' ? node.path : dirname(node.path);
};

const resetTree = () => {
  rootNode.value = { name: '/', path: '/', type: 'd', children: [], childrenLoaded: false };
  treeVersion.value += 1;
};

const refreshCurrentFiles = async (path = workspace.remotePath || '/') => {
  if (!hasActiveConnection.value) {
    workspace.status = '暂无连接';
    return;
  }
  await workspace.refreshFiles(workspace.activeServer, path);
  resetTree();
};

const openDialog = (options) => new Promise((resolve) => {
  dialogState.value = {
    show: true,
    mode: options.mode || 'confirm',
    title: options.title || '',
    message: options.message || '',
    label: options.label || '',
    value: options.value || '',
    placeholder: options.placeholder || '',
    confirmText: options.confirmText || '确认',
    danger: Boolean(options.danger),
    resolver: resolve
  };
});

const closeDialog = (result) => {
  const resolver = dialogState.value.resolver;
  dialogState.value.show = false;
  dialogState.value.resolver = null;
  resolver?.(result);
};

const submitDialog = () => {
  if (dialogState.value.mode === 'prompt') {
    const value = dialogState.value.value.trim();
    if (!value) return;
    closeDialog(value);
    return;
  }
  closeDialog(true);
};

const withLoading = async (message, task) => {
  operationLoading.value = true;
  operationLoadingText.value = message;
  try {
    return await task();
  } catch (error) {
    workspace.status = error instanceof Error ? error.message : '操作失败';
    return null;
  } finally {
    operationLoading.value = false;
    operationLoadingText.value = '';
  }
};

const closeConnection = () => {
  cleanupTerminal();
  workspace.connected = false;
  router.push('/servers');
};

const initEditor = () => {
  if (!editorContainer.value) return;
  editorInstance.value = monaco.editor.create(editorContainer.value, {
    value: workspace.activeTab?.content || '',
    language: 'javascript',
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace'
  });

  editorInstance.value.onDidChangeModelContent(() => {
    if (workspace.activeTab) {
      workspace.activeTab.content = editorInstance.value.getValue();
      workspace.activeTab.dirty = workspace.activeTab.content !== workspace.activeTab.originalContent;
    }
  });
};

watch(() => workspace.activeTab, (newTab) => {
  if (editorInstance.value && newTab) {
    if (editorInstance.value.getValue() !== newTab.content) {
      editorInstance.value.setValue(newTab.content);
    }
    // Set language based on extension
    const ext = newTab.name.split('.').pop()?.toLowerCase();
    const langMap = {
      'js': 'javascript', 'json': 'json', 'vue': 'html', 'html': 'html', 
      'css': 'css', 'ts': 'typescript', 'yaml': 'yaml', 'yml': 'yaml'
    };
    monaco.editor.setModelLanguage(editorInstance.value.getModel(), langMap[ext] || 'plaintext');
  } else if (editorInstance.value && !newTab) {
    editorInstance.value.setValue('');
  }
});

const saveActiveFile = async () => {
  if (!workspace.activeTab || savingFile.value) return;
  const bridge = window.linuxAi;
  if (!bridge) return;
  savingFile.value = true;
  workspace.status = `正在保存 ${workspace.activeTab.name}...`;
  try {
    await bridge.writeFile(JSON.parse(JSON.stringify(workspace.activeServer)), workspace.activeTab.path, workspace.activeTab.content);
    workspace.activeTab.originalContent = workspace.activeTab.content;
    workspace.activeTab.dirty = false;
    workspace.status = `已保存 ${workspace.activeTab.name}`;
  } catch (error) {
    workspace.status = error instanceof Error ? error.message : '保存失败';
  } finally {
    savingFile.value = false;
  }
};

let term;
let fitAddon;

const cleanupTerminal = () => {
  if (term) {
    term.dispose();
    term = null;
  }
  if (terminalSessionId.value && window.linuxAi) {
    window.linuxAi.removeTerminalListeners(terminalSessionId.value);
    window.linuxAi.closeTerminalSession(terminalSessionId.value);
    terminalSessionId.value = null;
  }
};

const initTerminal = async () => {
  if (!xtermContainer.value || !window.linuxAi) return;
  term = new Terminal({
    cursorBlink: true,
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace',
    fontSize: 13,
    theme: {
      background: '#0d1117',
      foreground: '#c9d1d9',
      cursor: '#00d2ff'
    }
  });
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);
  term.open(xtermContainer.value);
  fitAddon.fit();

  try {
    terminalSessionId.value = await window.linuxAi.startTerminalSession(JSON.parse(JSON.stringify(workspace.activeServer)));
    
    term.onData((data) => {
      window.linuxAi.writeTerminalSession(terminalSessionId.value, data);
    });

    term.onResize(({ cols, rows }) => {
      window.linuxAi.resizeTerminalSession(terminalSessionId.value, cols, rows);
    });

    window.linuxAi.onTerminalData(terminalSessionId.value, (data) => {
      term.write(data);
    });

    window.addEventListener('resize', () => {
      fitAddon.fit();
    });
  } catch (error) {
    term.write(`\x1b[31mFailed to start terminal: ${error.message}\x1b[0m\n`);
  }
};

const contextMenu = ref({ show: false, x: 0, y: 0, node: null });

const showContextMenu = (e, node) => {
  contextMenu.value = {
    show: true,
    x: e.clientX,
    y: e.clientY,
    node
  };
};

const hideContextMenu = () => {
  contextMenu.value.show = false;
};

// Context Menu Actions
const createNewFile = async (node = contextMenu.value.node) => {
  if (!hasActiveConnection.value) return;
  hideContextMenu();
  const targetDir = getTargetDirectory(node);
  const name = await openDialog({
    mode: 'prompt',
    title: '新建文件',
    message: `将在 ${targetDir} 下创建文件`,
    label: '文件名',
    placeholder: '例如 index.js',
    confirmText: '创建'
  });
  if (!name) return;
  const remotePath = joinRemotePath(targetDir, name);
  await withLoading('正在新建文件...', async () => {
    const bridge = window.linuxAi;
    await bridge.createFile(JSON.parse(JSON.stringify(workspace.activeServer)), remotePath);
    workspace.status = `文件已创建: ${remotePath}`;
    await refreshCurrentFiles(targetDir);
  });
};

const createNewFolder = async (node = contextMenu.value.node) => {
  if (!hasActiveConnection.value) return;
  hideContextMenu();
  const targetDir = getTargetDirectory(node);
  const name = await openDialog({
    mode: 'prompt',
    title: '新建文件夹',
    message: `将在 ${targetDir} 下创建文件夹`,
    label: '文件夹名',
    placeholder: '例如 uploads',
    confirmText: '创建'
  });
  if (!name) return;
  const remotePath = joinRemotePath(targetDir, name);
  await withLoading('正在新建文件夹...', async () => {
    const bridge = window.linuxAi;
    await bridge.createDirectory(JSON.parse(JSON.stringify(workspace.activeServer)), remotePath);
    workspace.status = `文件夹已创建: ${remotePath}`;
    await refreshCurrentFiles(targetDir);
  });
};

const renameNode = async () => {
  if (!hasActiveConnection.value) return;
  if (!contextMenu.value.node) return;
  hideContextMenu();
  const oldPath = contextMenu.value.node.path;
  const name = await openDialog({
    mode: 'prompt',
    title: '重命名',
    message: `修改 ${oldPath} 的名称`,
    label: '新名称',
    value: contextMenu.value.node.name,
    confirmText: '保存'
  });
  if (!name) return;
  const newPath = joinRemotePath(dirname(oldPath), name);
  await withLoading('正在重命名...', async () => {
    const bridge = window.linuxAi;
    await bridge.renameFile(JSON.parse(JSON.stringify(workspace.activeServer)), oldPath, newPath);
    workspace.status = `已重命名为 ${newPath}`;
    await refreshCurrentFiles();
  });
};
const copyPath = () => {
  if (!contextMenu.value.node) return;
  navigator.clipboard.writeText(contextMenu.value.node.path);
  hideContextMenu();
};
const downloadNode = async () => {
  if (!hasActiveConnection.value) return;
  if (!contextMenu.value.node) return;
  hideContextMenu();
  const node = contextMenu.value.node;
  if (node.type === 'd') {
    workspace.status = '暂不支持直接下载文件夹，请选择文件下载';
    return;
  }
  await withLoading('正在下载文件...', async () => {
    const result = await window.linuxAi?.downloadFile(JSON.parse(JSON.stringify(workspace.activeServer)), node.path);
    if (!result?.ok) {
      workspace.status = '已取消下载';
      return;
    }
    downloadItems.value.unshift({
      id: `${Date.now()}-${node.path}`,
      name: node.name,
      remotePath: node.path,
      localPath: result.path,
      downloadedAt: new Date().toLocaleString()
    });
    workspace.status = `已下载到 ${result.path}`;
  });
};
const deleteNode = async () => {
  if (!hasActiveConnection.value) return;
  if (!contextMenu.value.node) return;
  hideContextMenu();
  const node = contextMenu.value.node;
  const currentPathBeforeDelete = workspace.remotePath || '/';
  const fallbackPath = dirname(node.path);
  const returnPath = node.type === 'd' && (
    currentPathBeforeDelete === node.path ||
    currentPathBeforeDelete.startsWith(`${node.path}/`)
  ) ? fallbackPath : currentPathBeforeDelete;
  const confirmed = await openDialog({
    title: '确认删除',
    message: `确定要删除 ${node.path} 吗？此操作不可恢复。`,
    confirmText: '删除',
    danger: true
  });
  if (!confirmed) return;
  await withLoading('正在删除...', async () => {
    const bridge = window.linuxAi;
    if (node.type === 'd') {
      await bridge.deleteDirectory(JSON.parse(JSON.stringify(workspace.activeServer)), node.path);
    } else {
      await bridge.deleteFile(JSON.parse(JSON.stringify(workspace.activeServer)), node.path);
    }
    workspace.status = `已删除 ${node.path}`;
    await refreshCurrentFiles(returnPath);
  });
};

const openDownloadLocation = async (item) => {
  try {
    await window.linuxAi?.revealFileInFolder(item.localPath);
  } catch (error) {
    workspace.status = error instanceof Error ? error.message : '打开下载位置失败';
  }
};

onMounted(() => {
  document.addEventListener('click', hideContextMenu);
  if (shouldRefreshFilesOnMount.value) {
    workspace.refreshFiles(workspace.activeServer, workspace.remotePath || '/');
  } else if (hasActiveConnection.value) {
    workspace.applyCachedFiles(workspace.activeServer, workspace.remotePath || '/');
  }
  
  nextTick(() => {
    initEditor();
    if (hasActiveConnection.value) {
      initTerminal();
    }
  });
});

onActivated(() => {
  nextTick(() => {
    editorInstance.value?.layout();
    fitAddon?.fit();
  });
});

onUnmounted(() => {
  document.removeEventListener('click', hideContextMenu);
  if (editorInstance.value) {
    editorInstance.value.dispose();
  }
  cleanupTerminal();
});

</script>

<template>
  <div class="layout">
    <AppSidebar active-nav="files" subtext="ADMINISTRATOR" />

    <main class="main-content">
      <header class="app-header">
        <div class="header-right">
          <button class="disconnect-btn" @click="closeConnection">
            <X :size="16" /> 关闭连接
          </button>
        </div>
      </header>

      <div class="ide-layout">
        <!-- Sidebar -->
        <aside class="file-sidebar">
          <div class="sidebar-header">
            <span>文件浏览器</span>
            <div class="sidebar-actions">
              <button class="sidebar-action-btn" title="新建文件" :disabled="!hasActiveConnection || operationLoading" @click="createNewFile(null)">
                <FilePlus :size="16" />
              </button>
              <button class="sidebar-action-btn" title="新建文件夹" :disabled="!hasActiveConnection || operationLoading" @click="createNewFolder(null)">
                <FolderPlus :size="16" />
              </button>
              <button class="sidebar-action-btn" title="刷新" :disabled="!hasActiveConnection || operationLoading || workspace.busy" @click="refreshCurrentFiles">
                <Loader2 v-if="workspace.busy" :size="16" class="spin" />
                <RefreshCw v-else :size="16" />
              </button>
            </div>
          </div>
          <div class="path-input-container">
            <input
              type="text"
              v-model="pathInputValue"
              :disabled="!hasActiveConnection"
              @keydown.enter.prevent="jumpToPath"
              @blur="jumpToPath"
              placeholder="/root/path..."
            />
          </div>
          <div class="file-tree-container">
            <FileTreeItem 
              v-if="hasActiveConnection"
              :key="treeVersion"
              :node="rootNode" 
              :level="0"
              :current-path="workspace.remotePath"
              @contextmenu="showContextMenu"
            />
            <div v-else class="no-connection-state">
              <X :size="18" />
              <span>暂无连接</span>
            </div>
          </div>
          <div class="download-panel">
            <div class="download-header">
              <span>下载列表</span>
              <span class="download-count">{{ downloadItems.length }}</span>
            </div>
            <div v-if="downloadItems.length" class="download-list">
              <div v-for="item in downloadItems" :key="item.id" class="download-item">
                <div class="download-main">
                  <Download :size="14" />
                  <div class="download-text">
                    <span class="download-name">{{ item.name }}</span>
                    <span class="download-path">{{ item.localPath }}</span>
                  </div>
                </div>
                <button class="open-location-btn" @click="openDownloadLocation(item)">
                  <FolderOpen :size="13" />
                  打开位置
                </button>
              </div>
            </div>
            <div v-else class="download-empty">暂无下载文件</div>
          </div>
        </aside>

        <!-- Main Editor Area -->
        <div class="editor-main">
          <!-- Editor Tabs -->
          <div class="editor-tabs-bar">
            <div class="tabs-list">
              <div 
                v-for="tab in workspace.openTabs" 
                :key="tab.path"
                class="editor-tab"
                :class="{ active: workspace.activeTab?.path === tab.path }"
                @click="workspace.activeTab = tab"
              >
                <span class="tab-icon">📄</span>
                <span class="tab-name">{{ tab.name }}</span>
                <span v-if="tab.dirty" class="tab-dirty">●</span>
                <X :size="14" class="close-tab" @click.stop="workspace.closeTab(tab.path)" />
              </div>
            </div>
            <div class="tab-actions">
              <button class="action-btn ghost" :disabled="savingFile || !workspace.activeTab" @click="saveActiveFile">
                <Loader2 v-if="savingFile" :size="14" class="spin" />
                <Save v-else :size="14" />
                {{ savingFile ? '保存中' : '保存' }}
              </button>
            </div>
          </div>

          <!-- Monaco Editor -->
          <div class="monaco-container" ref="editorContainer" v-show="workspace.activeTab"></div>
          <div class="empty-editor" v-if="!workspace.activeTab">
            <p>选择一个文件进行编辑</p>
          </div>

          <!-- Terminal Panel -->
          <div class="terminal-panel">
            <div class="terminal-header">
              <div class="term-title">
                <span class="status-dot"></span>
                <span>TERMINAL: bash</span>
              </div>
              <div class="term-actions">
                <ChevronDown :size="16" class="action-icon" />
                <X :size="16" class="action-icon" />
              </div>
            </div>
            <div class="terminal-body" ref="xtermContainer"></div>
          </div>
        </div>
      </div>
    </main>

    <!-- Context Menu -->
    <div 
      v-if="contextMenu.show" 
      class="context-menu" 
      :style="{ left: contextMenu.x + 'px', top: contextMenu.y + 'px' }"
    >
      <div class="menu-item" @click="createNewFile()"><FilePlus :size="16"/> 新建文件</div>
      <div class="menu-item" @click="createNewFolder()"><FolderPlus :size="16"/> 新建文件夹</div>
      <div class="divider"></div>
      <div class="menu-item" @click="renameNode"><span class="icon-text">✎</span> 重命名</div>
      <div class="menu-item" @click="copyPath"><span class="icon-text">📄</span> 复制路径</div>
      <div class="divider"></div>
      <div class="menu-item" :class="{ disabled: contextMenu.node?.type === 'd' }" @click="downloadNode">
        <Download :size="16" /> 下载
      </div>
      <div class="menu-item danger" @click="deleteNode"><Trash2 :size="16"/> 删除</div>
    </div>

    <div v-if="dialogState.show" class="dialog-backdrop" @click.self="closeDialog(false)">
      <div class="dialog-card">
        <div class="dialog-title">{{ dialogState.title }}</div>
        <div class="dialog-message">{{ dialogState.message }}</div>
        <label v-if="dialogState.mode === 'prompt'" class="dialog-field">
          <span>{{ dialogState.label }}</span>
          <input
            v-model="dialogState.value"
            :placeholder="dialogState.placeholder"
            @keydown.enter.prevent="submitDialog"
          />
        </label>
        <div v-if="operationLoading" class="dialog-loading">
          <Loader2 :size="15" class="spin" />
          <span>{{ operationLoadingText }}</span>
        </div>
        <div class="dialog-actions">
          <button class="dialog-btn ghost" :disabled="operationLoading" @click="closeDialog(false)">取消</button>
          <button
            class="dialog-btn"
            :class="{ danger: dialogState.danger }"
            :disabled="operationLoading || (dialogState.mode === 'prompt' && !dialogState.value.trim())"
            @click="submitDialog"
          >
            {{ dialogState.confirmText }}
          </button>
        </div>
      </div>
    </div>

    <div v-if="operationLoading && !dialogState.show" class="operation-toast">
      <Loader2 :size="15" class="spin" />
      <span>{{ operationLoadingText }}</span>
    </div>
  </div>
</template>

<style scoped>
.layout {
  display: flex;
  height: 100vh;
  background-color: #0d1117;
  color: #c9d1d9;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
  overflow: hidden;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

/* Header */
.app-header {
  height: 60px;
  background-color: #0d1117;
  border-bottom: 1px solid #30363d;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 20px;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 30px;
}

.header-left h2 {
  font-size: 18px;
  color: #00d2ff;
  margin: 0;
}

.header-tabs {
  display: flex;
  gap: 20px;
}

.header-tabs a {
  color: #8b949e;
  text-decoration: none;
  font-size: 14px;
}

.header-tabs a.active {
  color: #c9d1d9;
  border-bottom: 2px solid #00d2ff;
  padding-bottom: 4px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.search-box {
  display: flex;
  align-items: center;
  background-color: #161b22;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 4px 10px;
}

.search-box input {
  background: transparent;
  border: none;
  color: #c9d1d9;
  outline: none;
  margin-left: 8px;
  width: 200px;
}

.icon-btn {
  color: #8b949e;
  cursor: pointer;
}
.icon-btn:hover {
  color: #c9d1d9;
}

.disconnect-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  background-color: transparent;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 6px 12px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}
.disconnect-btn:hover {
  background-color: #21262d;
  border-color: #8b949e;
}

/* IDE Layout */
.ide-layout {
  display: flex;
  flex: 1;
  overflow: hidden;
}

/* File Sidebar */
.file-sidebar {
  width: 280px;
  background-color: #0d1117;
  border-right: 1px solid #30363d;
  display: flex;
  flex-direction: column;
}

.sidebar-header {
  padding: 12px 16px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #8b949e;
  text-transform: uppercase;
  font-weight: 600;
  border-bottom: 1px solid #30363d;
}

.sidebar-actions {
  display: flex;
  gap: 8px;
}

.sidebar-action-btn {
  width: 24px;
  height: 24px;
  border: none;
  background: transparent;
  color: #8b949e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 4px;
}
.sidebar-action-btn:hover:not(:disabled) {
  color: #c9d1d9;
  background-color: #21262d;
}
.sidebar-action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.action-icon {
  cursor: pointer;
}
.action-icon:hover {
  color: #c9d1d9;
}

.file-tree-container {
  flex: 1;
  overflow-y: auto;
  padding: 8px 4px;
}

.download-panel {
  border-top: 1px solid #30363d;
  background-color: #0d1117;
  max-height: 220px;
  display: flex;
  flex-direction: column;
}

.download-header {
  padding: 10px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #8b949e;
  font-size: 12px;
  text-transform: uppercase;
  font-weight: 600;
}

.download-count {
  min-width: 18px;
  height: 18px;
  border-radius: 9px;
  background-color: #21262d;
  color: #c9d1d9;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
}

.download-list {
  overflow-y: auto;
  padding: 0 8px 8px;
}

.download-item {
  border: 1px solid #30363d;
  background-color: #161b22;
  border-radius: 6px;
  padding: 8px;
  margin-bottom: 8px;
}

.download-main {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  color: #c9d1d9;
}

.download-main svg {
  color: #00d2ff;
  flex-shrink: 0;
  margin-top: 2px;
}

.download-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.download-name,
.download-path {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.download-name {
  font-size: 13px;
}

.download-path {
  color: #8b949e;
  font-size: 11px;
}

.open-location-btn {
  margin-top: 8px;
  width: 100%;
  border: 1px solid #30363d;
  background-color: #0d1117;
  color: #c9d1d9;
  border-radius: 4px;
  padding: 5px 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
}

.open-location-btn:hover {
  background-color: #21262d;
}

.download-empty {
  color: #6e7681;
  font-size: 12px;
  padding: 0 12px 12px;
}

.path-input-container {
  padding: 8px;
  background-color: #0d1117;
  border-bottom: 1px solid #30363d;
}
.path-input-container input {
  width: 100%;
  background: #161b22;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 4px 8px;
  border-radius: 4px;
  outline: none;
  font-family: monospace;
  font-size: 12px;
}
.path-input-container input:focus {
  border-color: #00d2ff;
}
.path-input-container input:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.no-connection-state {
  height: 100%;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #6e7681;
  font-size: 13px;
}

/* Main Editor Area */
.editor-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  background-color: #161b22;
}

/* Editor Tabs */
.editor-tabs-bar {
  display: flex;
  justify-content: space-between;
  background-color: #0d1117;
  border-bottom: 1px solid #30363d;
  padding-right: 16px;
}

.tabs-list {
  display: flex;
  overflow-x: auto;
}

.editor-tab {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background-color: #0d1117;
  border-right: 1px solid #30363d;
  border-bottom: 1px solid transparent;
  cursor: pointer;
  color: #8b949e;
  font-size: 13px;
  min-width: 120px;
}

.editor-tab.active {
  background-color: #161b22;
  color: #c9d1d9;
  border-top: 2px solid #00d2ff;
  border-bottom-color: transparent;
}

.tab-dirty {
  color: #00d2ff;
}

.close-tab {
  opacity: 0;
  margin-left: auto;
}
.editor-tab:hover .close-tab {
  opacity: 1;
}

.tab-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 13px;
  cursor: pointer;
  border: 1px solid transparent;
}

.action-btn.ghost {
  background-color: #21262d;
  border-color: #30363d;
  color: #c9d1d9;
}
.action-btn.ghost:hover {
  background-color: #30363d;
}

.action-btn.primary {
  background-color: #00d2ff;
  color: #000;
  font-weight: 500;
}
.action-btn.primary:hover {
  background-color: #00c0eb;
}

.action-btn:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

/* Monaco Editor */
.monaco-container {
  flex: 1;
  width: 100%;
}

.empty-editor {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8b949e;
  font-size: 16px;
}

/* Terminal Panel */
.terminal-panel {
  height: 250px;
  background-color: #0d1117;
  border-top: 1px solid #30363d;
  display: flex;
  flex-direction: column;
}

.terminal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid #30363d;
}

.term-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #8b949e;
  text-transform: uppercase;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #00d2ff;
}

.term-input-box input {
  background: transparent;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 4px 12px;
  border-radius: 4px;
  width: 300px;
  outline: none;
  font-family: monospace;
}

.term-actions {
  display: flex;
  gap: 12px;
}

.terminal-body {
  flex: 1;
  padding: 8px;
  overflow: hidden;
}

.term-line {
  white-space: pre-wrap;
  word-wrap: break-word;
}
.term-line.info {
  color: #00d2ff;
}
.term-line.stdout {
  color: #c9d1d9;
}
.term-line.stderr {
  color: #f85149;
}

/* Context Menu */
.context-menu {
  position: fixed;
  background-color: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  padding: 8px 0;
  min-width: 180px;
  box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  z-index: 1000;
}

.menu-item {
  padding: 8px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  font-size: 13px;
  color: #c9d1d9;
}

.menu-item:hover {
  background-color: #21262d;
}

.menu-item.disabled {
  color: #6e7681;
  cursor: not-allowed;
}

.menu-item.disabled:hover {
  background-color: transparent;
}

.menu-item.danger {
  color: #f85149;
}
.menu-item.danger:hover {
  background-color: rgba(248, 81, 73, 0.1);
}

.divider {
  height: 1px;
  background-color: #30363d;
  margin: 4px 0;
}

.icon-text {
  display: inline-block;
  width: 16px;
  text-align: center;
}

.dialog-backdrop {
  position: fixed;
  inset: 0;
  background-color: rgba(1, 4, 9, 0.7);
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.dialog-card {
  width: min(420px, 100%);
  background-color: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  box-shadow: 0 18px 48px rgba(0,0,0,0.45);
  padding: 18px;
}

.dialog-title {
  color: #f0f6fc;
  font-weight: 600;
  font-size: 16px;
}

.dialog-message {
  color: #8b949e;
  line-height: 1.5;
  font-size: 13px;
  margin-top: 8px;
  word-break: break-all;
}

.dialog-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
  color: #8b949e;
  font-size: 12px;
}

.dialog-field input {
  background-color: #0d1117;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 6px;
  outline: none;
  padding: 9px 10px;
  font-size: 13px;
}

.dialog-field input:focus {
  border-color: #00d2ff;
}

.dialog-loading {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #00d2ff;
  margin-top: 14px;
  font-size: 13px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 18px;
}

.dialog-btn {
  border: 1px solid #00d2ff;
  background-color: #00d2ff;
  color: #000;
  border-radius: 6px;
  padding: 7px 14px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.dialog-btn.ghost {
  border-color: #30363d;
  background-color: #21262d;
  color: #c9d1d9;
}

.dialog-btn.danger {
  border-color: #f85149;
  background-color: #f85149;
  color: #fff;
}

.dialog-btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.operation-toast {
  position: fixed;
  right: 20px;
  bottom: 20px;
  z-index: 1300;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border: 1px solid #30363d;
  background-color: #161b22;
  color: #c9d1d9;
  border-radius: 6px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  font-size: 13px;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: transparent;
}
::-webkit-scrollbar-thumb {
  background: #30363d;
  border-radius: 4px;
}
::-webkit-scrollbar-thumb:hover {
  background: #8b949e;
}
</style>
