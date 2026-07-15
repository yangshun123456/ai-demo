<script setup>
import { computed, ref } from 'vue';
import { Bot, FolderOpen, Server, Settings, TerminalSquare, ChevronLeft, ChevronRight } from '@lucide/vue';
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

const isCollapsed = ref(false);
const toggleCollapse = () => {
  isCollapsed.value = !isCollapsed.value;
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
  <aside class="sidebar" :class="{ 'collapsed': isCollapsed }">
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
    <div v-if="props.showSessionCard" class="session-card">
      <span :class="workspace.connected ? 'pulse online' : 'pulse'" />
      <div>
        <strong>{{ workspace.connected ? 'Active Session' : 'Preview Session' }}</strong>
        <p>{{ serverLabel }}</p>
      </div>
    </div>
    
    <button class="collapse-toggle-btn" @click="toggleCollapse" title="展开/折叠">
      <ChevronRight v-if="isCollapsed" :size="16" />
      <ChevronLeft v-else :size="16" />
    </button>
  </aside>
</template>

<style scoped>
.collapse-toggle-btn {
  position: absolute;
  bottom: 24px;
  right: -12px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: #00dbe9;
  color: #0b1326;
  border: 4px solid #0b1326;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  z-index: 10;
  transition: all 0.2s;
  padding: 0;
}

.collapse-toggle-btn:hover {
  transform: scale(1.1);
  background: #3ee6f1;
}
</style>
