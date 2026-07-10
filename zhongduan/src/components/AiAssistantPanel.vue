<script setup>
import { CheckCircle2, Plus, Send, Sparkles, Terminal, Wrench } from '@lucide/vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspace = useWorkspaceStore();

const presets = ['排查高负载', 'Nginx 优化', 'Docker 调试'];

function usePreset(preset) {
  workspace.prompt = preset;
}
</script>

<template>
  <section class="ai-workspace">
    <aside class="ai-config-panel">
      <div class="panel-title">
        <Wrench :size="18" />
        <strong>模型配置</strong>
      </div>
      <label class="field">
        <span>Provider</span>
        <input v-model="workspace.aiDraft.name" />
      </label>
      <label class="field">
        <span>Base URL</span>
        <input v-model="workspace.aiDraft.baseUrl" />
      </label>
      <label class="field">
        <span>API Key</span>
        <input v-model="workspace.aiDraft.apiKey" type="password" />
      </label>
      <label class="field">
        <span>Model</span>
        <input v-model="workspace.aiDraft.model" />
      </label>
      <label class="field ai-system-field">
        <span>System Prompt</span>
        <textarea v-model="workspace.systemPrompt" />
      </label>
      <div class="preset-group">
        <span>运维常用预设</span>
        <div>
          <button v-for="preset in presets" :key="preset" @click="usePreset(preset)">
            {{ preset }}
          </button>
        </div>
      </div>
      <button class="primary-btn ai-save-btn" @click="workspace.saveAiProfile">
        <Plus :size="15" />
        保存配置
      </button>
      <div class="model-tabs">
        <button v-for="profile in workspace.aiProfiles" :key="profile.id" @click="workspace.selectAiProfile(profile)">
          {{ profile.model }}
        </button>
      </div>
    </aside>

    <section class="ai-chat-panel">
      <div class="ai-chat-head">
        <div>
          <Sparkles :size="18" />
          <strong>AI 助手</strong>
        </div>
        <span>{{ workspace.aiDraft.model }}</span>
      </div>
      <div class="messages">
        <div v-for="(message, index) in workspace.messages" :key="`${message.role}-${index}`" :class="['message', message.role]">
          <div class="message-meta">
            <Sparkles v-if="message.role === 'assistant'" :size="16" />
            <Terminal v-else :size="16" />
            <span>{{ message.role === 'assistant' ? '系统助手' : '系统管理员' }}</span>
            <small>{{ message.role === 'assistant' ? workspace.aiDraft.model : workspace.activeServer.name }}</small>
          </div>
          <p>{{ message.content }}</p>
        </div>
      </div>
      <div class="composer ai-composer">
        <textarea
          v-model="workspace.prompt"
          placeholder="输入指令，或输入 '/' 唤出快捷命令..."
          rows="1"
          @keydown.enter.exact.prevent="workspace.sendMessage"
        />
        <button class="primary-btn" @click="workspace.sendMessage"><Send :size="16" /></button>
      </div>
      <div class="ai-composer-foot">
        <span>Shift + Enter 换行 | Enter 发送</span>
        <span><CheckCircle2 :size="14" />API 状态正常</span>
      </div>
    </section>
  </section>
</template>
