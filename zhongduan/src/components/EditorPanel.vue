<script setup>
import { Download, File, Save, Upload } from '@lucide/vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspace = useWorkspaceStore();
</script>

<template>
  <section class="editor-panel">
    <div class="editor-header">
      <div>
        <File :size="17" />
        {{ workspace.fullSelectedPath }}
        <b v-if="workspace.dirty">MODIFIED</b>
      </div>
      <div class="button-row">
        <button class="icon-btn" title="下载" @click="workspace.downloadSelected">
          <Download :size="17" />
        </button>
        <button class="icon-btn" title="上传" @click="workspace.uploadLocalFiles()">
          <Upload :size="17" />
        </button>
        <button class="primary-btn" @click="workspace.saveFile">
          <Save :size="16" />
          保存
        </button>
      </div>
    </div>
    <textarea
      v-model="workspace.editorContent"
      class="code-editor"
      spellcheck="false"
      @input="workspace.markDirty"
    />
  </section>
</template>
