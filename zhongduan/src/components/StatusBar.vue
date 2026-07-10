<script setup>
import { CheckCircle2, Loader2 } from '@lucide/vue';
import { useWorkspaceStore } from '../stores/workspace';

const workspace = useWorkspaceStore();
</script>

<template>
  <footer class="statusbar">
    <Loader2 v-if="workspace.busy" class="spin" :size="14" />
    <CheckCircle2 v-else :size="14" />
    <span>{{ workspace.status }}</span>
  </footer>
</template>
