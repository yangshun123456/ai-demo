import { createRouter, createWebHashHistory } from 'vue-router';
import LinuxConnectorView from '../views/LinuxConnectorView.vue';
import FileBrowserView from '../views/FileBrowserView.vue';
import AiModelConfigView from '../views/AiModelConfigView.vue';

const routes = [
  {
    path: '/',
    redirect: '/servers'
  },
  {
    path: '/servers',
    name: 'linux-connector',
    component: LinuxConnectorView
  },
  {
    path: '/files',
    name: 'file-browser',
    component: FileBrowserView
  },
  {
    path: '/ai',
    name: 'ai-model-config',
    component: AiModelConfigView
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
