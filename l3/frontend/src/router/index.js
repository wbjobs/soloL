import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  {
    path: '/',
    name: 'Upload',
    component: () => import('../views/UploadView.vue')
  },
  {
    path: '/tasks',
    name: 'Tasks',
    component: () => import('../views/TasksView.vue')
  },
  {
    path: '/visualization/:taskId?',
    name: 'Visualization',
    component: () => import('../views/VisualizationView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

export default router
