<script setup>
import { DatabaseZap, KeyRound, Save, Server } from '@lucide/vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspace = useWorkspaceStore();
</script>

<template>
  <section class="server-panel">
    <div class="panel-title">
      <DatabaseZap :size="18" />
      <strong>服务器连接</strong>
    </div>
    <label class="field">
      <span>名称</span>
      <input v-model="workspace.serverDraft.name" />
    </label>
    <div class="split">
      <label class="field">
        <span>Host</span>
        <input v-model="workspace.serverDraft.host" />
      </label>
      <label class="field">
        <span>Port</span>
        <input v-model.number="workspace.serverDraft.port" />
      </label>
    </div>
    <label class="field">
      <span>Username</span>
      <input v-model="workspace.serverDraft.username" />
    </label>
    <label class="field">
      <span>Password</span>
      <input v-model="workspace.serverDraft.password" type="password" />
    </label>
    <label class="field">
      <span>Private Key Path</span>
      <input v-model="workspace.serverDraft.privateKey" />
    </label>
    <label class="field">
      <span>Root Path</span>
      <input v-model="workspace.serverDraft.rootPath" />
    </label>
    <div class="button-row">
      <button class="ghost-btn" @click="workspace.saveServer"><Save :size="16" />保存</button>
      <button class="primary-btn" @click="workspace.testConnection"><KeyRound :size="16" />测试</button>
    </div>
    <div class="server-list">
      <button v-for="server in workspace.servers" :key="server.id" @click="workspace.selectServer(server)">
        <Server :size="16" />
        <span>{{ server.name }}</span>
        <small>{{ server.host }}</small>
      </button>
    </div>
  </section>
</template>
