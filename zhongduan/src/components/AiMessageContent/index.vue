<script setup>
import { computed } from 'vue';
import { Terminal } from '@lucide/vue';

const props = defineProps({
  content: {
    type: String,
    default: ''
  },
  enableTerminalAction: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['copy-to-terminal']);

const shellLanguages = new Set(['bash', 'sh', 'shell', 'zsh', 'console', 'terminal', 'linux']);

const segments = computed(() => {
  const result = [];
  const codeBlockPattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  while ((match = codeBlockPattern.exec(props.content)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'text', content: props.content.slice(lastIndex, match.index) });
    }

    const language = match[1].trim().toLowerCase();
    result.push({
      type: 'code',
      language,
      content: match[2].replace(/\n$/, ''),
      canCopyToTerminal: !language || shellLanguages.has(language)
    });
    lastIndex = codeBlockPattern.lastIndex;
  }

  if (lastIndex < props.content.length) {
    result.push({ type: 'text', content: props.content.slice(lastIndex) });
  }

  return result.length ? result : [{ type: 'text', content: props.content }];
});
</script>

<template>
  <div class="ai-message-content">
    <template v-for="(segment, index) in segments" :key="index">
      <p v-if="segment.type === 'text'" class="message-text">{{ segment.content }}</p>
      <div v-else class="command-block">
        <div v-if="segment.language || (enableTerminalAction && segment.canCopyToTerminal)" class="command-head">
          <span>{{ segment.language || 'shell' }}</span>
          <button
            v-if="enableTerminalAction && segment.canCopyToTerminal"
            type="button"
            title="将命令写入当前终端"
            @click="emit('copy-to-terminal', segment.content)"
          >
            <Terminal :size="13" />
            复制到终端
          </button>
        </div>
        <pre><code>{{ segment.content }}</code></pre>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ai-message-content {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.message-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.command-block {
  overflow: hidden;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #0d1117;
}

.command-head {
  display: flex;
  min-height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 8px 4px 12px;
  border-bottom: 1px solid #30363d;
  color: #8b949e;
  font-size: 12px;
}

.command-head button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 8px;
  border: 1px solid #3d4650;
  border-radius: 4px;
  color: #c9d1d9;
  background: #161b22;
  cursor: pointer;
}

.command-head button:hover {
  border-color: #58a6ff;
  color: #58a6ff;
}

pre {
  margin: 0;
  padding: 12px;
  overflow-x: auto;
  color: #e6edf3;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
  white-space: pre;
}
</style>
