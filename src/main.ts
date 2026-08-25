import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { createRouter, createWebHashHistory } from 'vue-router'
import App from './App.vue'
import WorkspaceView from './views/WorkspaceView.vue'

import 'katex/dist/katex.min.css'
import 'lxgw-wenkai-screen-webfont/lxgwwenkaiscreen.css'
import './themes/tokens.css'
import './themes/app.css'
import './themes/reading.css'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', component: WorkspaceView }],
})

createApp(App).use(createPinia()).use(router).mount('#app')
