<script setup>
import { computed, onMounted, ref } from 'vue';
import { Bot, CheckCircle2, DatabaseZap, Loader2, Save, ShieldCheck } from '@lucide/vue';
import { useWorkspaceStore } from '../stores/workspace';
import AppSidebar from '../components/AppSidebar.vue';
import StatusBar from '../components/StatusBar.vue';

const workspace = useWorkspaceStore();
const testing = ref(false);
const saving = ref(false);

const modelOptions = computed(() => (
  Array.isArray(workspace.aiDraft.models) ? workspace.aiDraft.models : []
));

const canConnect = computed(() => (
  Boolean(workspace.aiDraft.baseUrl?.trim() && workspace.aiDraft.apiKey?.trim())
));

const canSave = computed(() => (
  Boolean(workspace.aiDraft.baseUrl?.trim() && workspace.aiDraft.apiKey?.trim() && workspace.aiDraft.model?.trim())
));

onMounted(() => {
  workspace.initConfig();
});

async function connectAndSave() {
  if (!canConnect.value || testing.value) return;
  testing.value = true;
  try {
    await workspace.connectAndSaveAiProfile(workspace.aiDraft);
  } finally {
    testing.value = false;
  }
}

async function saveConfig() {
  if (!canSave.value || saving.value) return;
  saving.value = true;
  try {
    await workspace.saveAiProfileConfig(workspace.aiDraft);
  } finally {
    saving.value = false;
  }
}

function selectProfile(profile) {
  workspace.selectAiProfile(profile);
}
</script>

<template>
  <div class="app-shell">
    <AppSidebar active-nav="ai" />

    <main class="workspace">
      <header class="topbar">
        <div>
          <p class="label">OpenAI Compatible</p>
          <h2>大模型配置</h2>
        </div>
        <div class="top-actions">
          <button class="ghost-btn" :disabled="testing || !canSave" @click="saveConfig">
            <Loader2 v-if="saving" class="spin" :size="16" />
            <Save v-else :size="16" />
            保存配置
          </button>
          <button class="primary-btn" :disabled="testing || !canConnect" @click="connectAndSave">
            <Loader2 v-if="testing" class="spin" :size="16" />
            <DatabaseZap v-else :size="16" />
            连接并获取模型
          </button>
        </div>
      </header>

      <section class="llm-config-page">
        <section class="llm-config-card">
          <div class="panel-title">
            <Bot :size="18" />
            <strong>连接信息</strong>
          </div>

          <div class="llm-form-grid">
            <label class="field">
              <span>Provider</span>
              <input v-model="workspace.aiDraft.name" placeholder="OpenAI Compatible" />
            </label>
            <label class="field">
              <span>Base URL</span>
              <input v-model="workspace.aiDraft.baseUrl" placeholder="https://api.openai.com/v1" />
            </label>
            <label class="field llm-secret-field">
              <span>API Key</span>
              <input v-model="workspace.aiDraft.apiKey" type="password" placeholder="sk-..." />
            </label>
            <label class="field">
              <span>当前聊天模型</span>
              <select v-if="modelOptions.length" v-model="workspace.aiDraft.model" class="field-select">
                <option v-for="model in modelOptions" :key="model" :value="model">{{ model }}</option>
              </select>
              <input v-else v-model="workspace.aiDraft.model" placeholder="连接后自动获取模型列表" />
            </label>
          </div>

          <div class="llm-note">
            <ShieldCheck :size="16" />
            <span>按 OpenAI 标准方式连接：Base URL 指向 /v1，密钥通过 Bearer Token 发送，模型列表来自 /models。</span>
          </div>
        </section>

        <section class="llm-config-card">
          <div class="panel-title">
            <DatabaseZap :size="18" />
            <strong>可用模型</strong>
          </div>

          <div v-if="modelOptions.length" class="llm-model-grid">
            <button
              v-for="model in modelOptions"
              :key="model"
              :class="{ active: model === workspace.aiDraft.model }"
              @click="workspace.aiDraft.model = model"
            >
              <span>{{ model }}</span>
              <CheckCircle2 v-if="model === workspace.aiDraft.model" :size="15" />
            </button>
          </div>
          <div v-else class="llm-empty-state">
            <Bot :size="22" />
            <p>填写 URL 和密钥后点击“连接并获取模型”，AI 聊天下拉会同步显示这里获取到的模型。</p>
          </div>
        </section>

        <section class="llm-config-card">
          <div class="panel-title">
            <Save :size="18" />
            <strong>已保存配置</strong>
          </div>

          <div class="llm-profile-list">
            <button
              v-for="profile in workspace.aiProfiles"
              :key="profile.id"
              :class="{ active: profile.id === workspace.aiDraft.id }"
              @click="selectProfile(profile)"
            >
              <strong>{{ profile.name || profile.model || '未命名配置' }}</strong>
              <span>{{ profile.baseUrl || '-' }}</span>
              <small>{{ profile.models?.length || 0 }} 个模型</small>
            </button>
          </div>
        </section>
      </section>

      <StatusBar />
    </main>
  </div>
</template>
