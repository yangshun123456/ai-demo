<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { ChevronRight, ChevronDown, Folder, FolderOpen, FileJson, FileCode, FileImage, Archive, FileText, File as FileIcon, Loader2 } from '@lucide/vue';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps({
  node: { type: Object, required: true },
  level: { type: Number, default: 0 },
  currentPath: { type: String, default: '/' },
});

const emit = defineEmits(['contextmenu', 'upload-drop']);

const workspace = useWorkspaceStore();
const isOpen = ref(props.level === 0);
const isLoading = ref(false);

const isPathInsideNode = computed(() => {
  if (props.node.type !== 'd') return false;
  const nodePath = props.node.path || '/';
  const currentPath = props.currentPath || '/';
  if (nodePath === '/') return currentPath.startsWith('/');
  return currentPath === nodePath || currentPath.startsWith(`${nodePath}/`);
});

const joinRemotePath = (base = '/', name = '') => {
  const normalizedBase = base === '/' ? '' : String(base).replace(/\/$/, '');
  return `${normalizedBase}/${String(name).replace(/^\//, '')}`;
};

const toTreeNode = (child) => ({
  ...child,
  path: joinRemotePath(props.node.path || '/', child.name),
  children: child.type === 'd' ? [] : undefined,
  childrenLoaded: false
});

const getFileIcon = (file) => {
  if (file.type === 'd') return isOpen.value ? FolderOpen : Folder;
  const name = file.name.toLowerCase();
  if (name.endsWith('.json')) return FileJson;
  if (name.endsWith('.js') || name.endsWith('.vue') || name.endsWith('.html') || name.endsWith('.css') || name.endsWith('.yaml')) return FileCode;
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg') || name.endsWith('.svg')) return FileImage;
  if (name.endsWith('.zip') || name.endsWith('.tar') || name.endsWith('.gz')) return Archive;
  if (name.endsWith('.md') || name.endsWith('.txt')) return FileText;
  return FileIcon;
};

const iconComponent = computed(() => getFileIcon(props.node));

const setChildren = (children) => {
  props.node.children = children
    .map(toTreeNode)
    .sort((a, b) => {
      if (a.type === 'd' && b.type !== 'd') return -1;
      if (a.type !== 'd' && b.type === 'd') return 1;
      return a.name.localeCompare(b.name);
    });
  props.node.childrenLoaded = true;
};

const loadChildren = async (setAsCurrentPath = false) => {
  if (props.node.type !== 'd' || props.node.childrenLoaded || isLoading.value) return;
  const nodePath = props.node.path || '/';
  const cachedChildren = workspace.getCachedFiles(workspace.activeServer, nodePath);
  if (cachedChildren) {
    if (setAsCurrentPath) {
      workspace.applyCachedFiles(workspace.activeServer, nodePath);
    }
    setChildren(cachedChildren);
    return;
  }

  isLoading.value = true;
  try {
    const children = await workspace.refreshFiles(workspace.activeServer, nodePath, !setAsCurrentPath);
    setChildren(children);
  } catch (err) {
    workspace.status = err instanceof Error ? err.message : '目录加载失败';
  } finally {
    isLoading.value = false;
  }
};

const handleClick = async () => {
  if (props.node.type === 'd') {
    isOpen.value = !isOpen.value;
    if (isOpen.value && !props.node.childrenLoaded) {
      await loadChildren(true);
      return;
    }
    if (!workspace.applyCachedFiles(workspace.activeServer, props.node.path || '/')) {
      await workspace.refreshFiles(workspace.activeServer, props.node.path || '/');
    }
  } else {
    workspace.openFile(workspace.activeServer, props.node.path);
  }
};

const handleContextMenu = (e) => {
  emit('contextmenu', e, props.node);
};

const handleDrop = (event) => {
  emit('upload-drop', event, props.node);
};

const isSelected = computed(() => {
  return workspace.activeTab?.path === props.node.path;
});

onMounted(() => {
  if (isOpen.value || isPathInsideNode.value) {
    isOpen.value = true;
    loadChildren();
  }
});

watch(isPathInsideNode, (shouldOpen) => {
  if (!shouldOpen) return;
  isOpen.value = true;
  loadChildren();
});

</script>

<template>
  <div class="tree-item-container">
    <div 
      class="tree-node" 
      :class="{ 'is-selected': isSelected }"
      :style="{ paddingLeft: `${level * 12 + 8}px` }"
      @click.stop="handleClick"
      @contextmenu.prevent.stop="handleContextMenu"
      @dragover.prevent.stop
      @drop.prevent.stop="handleDrop"
    >
      <div class="expand-icon-wrap" :class="{ invisible: node.type !== 'd' }">
        <Loader2 v-if="isLoading" :size="14" class="spin" />
        <template v-else>
          <ChevronDown v-if="isOpen" :size="14" />
          <ChevronRight v-else :size="14" />
        </template>
      </div>
      <component :is="iconComponent" :size="16" class="node-icon" :class="{ 'folder-icon': node.type === 'd', 'file-icon': node.type !== 'd' }" />
      <span class="node-name">{{ node.name }}</span>
    </div>
    
    <div v-if="isOpen && node.children && node.children.length > 0" class="tree-children">
      <FileTreeItem 
        v-for="child in node.children" 
        :key="child.path" 
        :node="child" 
        :level="level + 1"
        :current-path="currentPath"
        @contextmenu="(e, n) => emit('contextmenu', e, n)"
        @upload-drop="(e, n) => emit('upload-drop', e, n)"
      />
    </div>
  </div>
</template>

<style scoped>
.tree-item-container {
  display: flex;
  flex-direction: column;
}
.tree-node {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  cursor: pointer;
  border-radius: 4px;
  color: #c9d1d9;
  user-select: none;
  font-size: 14px;
}
.tree-node:hover {
  background-color: #21262d;
}
.tree-node.is-selected {
  background-color: #30363d;
  color: #ffffff;
}
.expand-icon-wrap {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: #8b949e;
}
.invisible {
  visibility: hidden;
}
.node-icon {
  flex-shrink: 0;
}
.folder-icon {
  color: #00d2ff;
}
.file-icon {
  color: #8b949e;
}
.node-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
