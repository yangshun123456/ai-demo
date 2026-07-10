<script setup>
import { Bot, Code2, FolderOpen, Server, Settings, TerminalSquare } from '@lucide/vue';
import { useRoute } from 'vue-router';
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
</script>

<template>
  <aside class="sidebar">
    <div class="brand">
      <TerminalSquare :size="26" />
      <div>
        <h1>智联 Linux</h1>
        <p>{{ props.subtext }}</p>
      </div>
    </div>
    <nav>
      <RouterLink :class="getNavClass('servers')" to="/servers"><Server :size="18" />服务器</RouterLink>
      <RouterLink :class="getNavClass('files')" to="/files"><FolderOpen :size="18" />文件</RouterLink>
      <a :class="getNavClass('editor')"><Code2 :size="18" />编辑器</a>
      <RouterLink :class="getNavClass('ai')" to="/ai"><Bot :size="18" />AI 助手</RouterLink>
      <a :class="getNavClass('settings')"><Settings :size="18" />设置</a>
    </nav>
    <div v-if="props.showSessionCard" class="session-card">
      <span :class="workspace.connected ? 'pulse online' : 'pulse'" />
      <div>
        <strong>{{ workspace.connected ? 'Active Session' : 'Preview Session' }}</strong>
        <p>{{ workspace.activeServer.username }}@{{ workspace.activeServer.host }}</p>
      </div>
    </div>
  </aside>
</template>

