<script setup>
import { computed } from 'vue';
import { Bot, FolderOpen, Server, Settings, TerminalSquare, PanelLeftClose, PanelLeftOpen } from '@lucide/vue';
import { useRoute, useRouter } from 'vue-router';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps({
  activeNav: {
    type: String,
    default: ''
  },
  subtext: {
    type: String,
    default: '系统管理员'
  },
  showSessionCard: {
    type: Boolean,
    default: true
  }
});

const workspace = useWorkspaceStore();
const route = useRoute();

const toggleCollapse = () => {
  workspace.isSidebarCollapsed = !workspace.isSidebarCollapsed;
};
const router = useRouter();
const serverLabel = computed(() => {
  const username = workspace.activeServer?.username || '-';
  const host = workspace.activeServer?.host || '未连接';
  return `${username}@${host}`;
});

function getNavClass(itemKey) {
  if (props.activeNav) {
    return props.activeNav === itemKey ? 'active' : '';
  }
  if (route) {
    if (itemKey === 'servers' && route.path === '/servers') return 'active';
    if (itemKey === 'files' && route.path === '/files') return 'active';
    if (itemKey === 'ai' && route.path === '/ai') return 'active';
  }
  return '';
}

function selectSession(sessionId) {
  workspace.activeSessionId = sessionId;
  if (route.path !== '/files') {
    router.push('/files');
  }
}
</script>

<template>
  <aside class="sidebar" :class="{ 'collapsed': workspace.isSidebarCollapsed }">
    <div class="brand">
      <TerminalSquare :size="26" />
      <div>
        <h1>Kernel AI</h1>
        <p>{{ props.subtext }}</p>
      </div>
    </div>
    <nav>
      <RouterLink :class="getNavClass('servers')" to="/servers" title="服务器"><Server :size="18" /><span>服务器</span></RouterLink>
      <template v-if="workspace.connected">
        <RouterLink :class="getNavClass('files')" to="/files" @click.prevent title="连接列表"><FolderOpen :size="18" /><span>连接列表</span></RouterLink>
        <div class="sub-nav">
          <div
            v-for="session in workspace.sessions"
            :key="session.id"
            class="sub-nav-item"
            :class="{ 'sub-active': workspace.activeSessionId === session.id && getNavClass('files') === 'active' }"
            @click="selectSession(session.id)"
          >
            <span class="session-dot" :class="{ 'is-active': workspace.activeSessionId === session.id }"></span>
            <span class="text-truncate" :title="`${session.server.name} (${session.server.host})`">{{ session.server.name }} ({{ session.server.host }})</span>
          </div>
        </div>
      </template>
      <RouterLink :class="getNavClass('ai')" to="/ai" title="大模型配置"><Bot :size="18" /><span>大模型配置</span></RouterLink>
      <a :class="getNavClass('settings')" title="设置"><Settings :size="18" /><span>设置</span></a>
    </nav>
    <div style="flex: 1;"></div>
    
    <div class="sidebar-bottom-section">
      <div v-if="props.showSessionCard" class="session-card">
        <span :class="workspace.connected ? 'pulse online' : 'pulse'" />
        <div>
          <strong>{{ workspace.connected ? 'Active Session' : 'Preview Session' }}</strong>
          <p>{{ serverLabel }}</p>
        </div>
      </div>
      
      <div class="sidebar-footer">
        <button class="collapse-footer-btn" @click="toggleCollapse" :title="workspace.isSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'">
          <PanelLeftOpen v-if="workspace.isSidebarCollapsed" :size="20" />
          <PanelLeftClose v-else :size="20" />
          <span class="collapse-text">收起侧边栏</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.sidebar-bottom-section {
  display: flex;
  flex-direction: column;
}
.sidebar-footer {
  padding: 12px 16px;
  border-top: 1px solid #3b494b;
}
.sidebar.collapsed .sidebar-footer {
  padding: 12px 0;
  display: flex;
  justify-content: center;
}
.collapse-footer-btn {
  width: 100%;
  background: transparent;
  border: none;
  color: #8b949e;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 12px;
  padding: 10px 12px;
  border-radius: 6px;
  transition: all 0.2s ease;
  font-size: 14px;
}
.sidebar.collapsed .collapse-footer-btn {
  width: auto;
  justify-content: center;
  padding: 10px;
}
.sidebar.collapsed .collapse-text {
  display: none;
}
.collapse-footer-btn:hover {
  background: rgba(255, 255, 255, 0.05);
  color: #c9d1d9;
}
</style>
