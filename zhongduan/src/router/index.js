import { createRouter, createWebHashHistory } from 'vue-router';
import LinuxConnectorView from '../views/LinuxConnectorView.vue';
import AiAssistantView from '../views/AiAssistantView.vue';

import FileBrowserView from '../views/FileBrowserView.vue';

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
    name: 'ai-assistant',
    component: AiAssistantView
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
