import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import DownloadPage from '@/pages/DownloadPage.vue'
import StatsPage from '@/pages/StatsPage.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
  },
  {
    path: '/download',
    name: 'download',
    component: DownloadPage,
  },
  {
    path: '/stats',
    name: 'stats',
    component: StatsPage,
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
