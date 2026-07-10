<script setup>
import { ChevronRight, CloudUpload, FileText, Folder, HardDrive } from '@lucide/vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspace = useWorkspaceStore();

function onDrop(event) {
  event.preventDefault();
  workspace.uploadLocalFiles(Array.from(event.dataTransfer.files).map((file) => file.path).filter(Boolean));
}

function formatSize(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <section class="files-panel">
    <div class="pathbar">
      <HardDrive :size="18" />
      <template v-for="part in workspace.pathParts" :key="part">
        <ChevronRight :size="15" />
        <span>{{ part }}</span>
      </template>
    </div>
    <div class="drop-zone" @click="workspace.uploadLocalFiles()" @dragover.prevent @drop="onDrop">
      <CloudUpload :size="28" />
      <span>拖动文件到这里上传，或点击选择本地文件</span>
    </div>
    <div class="table-shell">
      <div class="file-row head"><span></span><span>名称</span><span>大小</span><span>修改时间</span></div>
      <button
        v-for="file in workspace.files"
        :key="file.name"
        :class="['file-row', { selected: workspace.selectedFile === file.name }]"
        @click="workspace.selectFileEntry(file)"
        @dblclick="workspace.openFileEntry(file)"
      >
        <Folder v-if="file.type === 'd'" :size="18" />
        <FileText v-else :size="18" />
        <span>{{ file.name }}</span>
        <span>{{ formatSize(file.size) }}</span>
        <span>{{ new Date(file.modifyTime).toLocaleString() }}</span>
      </button>
    </div>
  </section>
</template>
