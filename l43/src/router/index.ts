import { createRouter, createWebHistory } from 'vue-router'
import HomePage from '@/pages/HomePage.vue'
import CaseInputPage from '@/pages/CaseInputPage.vue'
import CaseListPage from '@/pages/CaseListPage.vue'
import GraphPage from '@/pages/GraphPage.vue'
import ReasoningPage from '@/pages/ReasoningPage.vue'
import SearchPage from '@/pages/SearchPage.vue'

const routes = [
  {
    path: '/',
    name: 'home',
    component: HomePage,
    meta: { title: '系统首页', icon: 'LayoutDashboard' }
  },
  {
    path: '/case/input',
    name: 'case-input',
    component: CaseInputPage,
    meta: { title: '案件输入', icon: 'FileText' }
  },
  {
    path: '/case/list',
    name: 'case-list',
    component: CaseListPage,
    meta: { title: '案件管理', icon: 'FolderOpen' }
  },
  {
    path: '/graph',
    name: 'graph',
    component: GraphPage,
    meta: { title: '知识图谱', icon: 'Network' }
  },
  {
    path: '/reasoning',
    name: 'reasoning',
    component: ReasoningPage,
    meta: { title: '反事实推理', icon: 'GitBranch' }
  },
  {
    path: '/search',
    name: 'search',
    component: SearchPage,
    meta: { title: '法律检索', icon: 'Search' }
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to, _from, next) => {
  document.title = `${to.meta.title || '法律辅助系统'} - 多模态知识图谱反事实推理`
  next()
})

export default router
