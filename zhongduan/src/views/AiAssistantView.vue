<script setup>
import { onMounted } from 'vue';
import { Loader2, Power } from '@lucide/vue';
import { useWorkspaceStore } from '../stores/workspace';
import AppSidebar from '../components/AppSidebar.vue';
import AiAssistantPanel from '../components/AiAssistantPanel.vue';
import StatusBar from '../components/StatusBar.vue';

const workspace = useWorkspaceStore();

onMounted(() => {
  workspace.initConfig();
});
</script>

<template>
  <div class="app-shell">
    <AppSidebar />

    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="label">Kernel & Pulse</p>
          <h2>Kernel AI</h2>
        </div>
        <div class="top-actions">
          <button class="primary-btn" :disabled="workspace.busy" @click="workspace.testConnection">
            <Loader2 v-if="workspace.busy" class="spin" :size="17" />
            <Power v-else :size="17" />
            连接服务器
          </button>
        </div>
      </header>

      <section class="ai-page-grid">
        <AiAssistantPanel />
      </section>

      <StatusBar />
    </main>
  </div>
</template>
