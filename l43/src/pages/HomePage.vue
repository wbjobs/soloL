<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useGraphStore } from '@/stores/graph'
import { Scale, Network, GitBranch, Search, FileText, ArrowRight, TrendingUp, BookOpen, Gavel } from 'lucide-vue-next'

const router = useRouter()
const graphStore = useGraphStore()

const statsCards = ref([
  { label: '案件总数', key: 'case_count', value: 0, icon: Gavel, color: 'from-blue-800 to-blue-600' },
  { label: '图谱实体数', key: 'entity_count', value: 0, icon: Network, color: 'from-indigo-800 to-indigo-600' },
  { label: '法条数', key: 'law_count', value: 0, icon: BookOpen, color: 'from-amber-700 to-amber-500' },
  { label: '判例数', key: 'precedent_count', value: 0, icon: Scale, color: 'from-emerald-700 to-emerald-500' },
])

const quickEntries = ref([
  { title: '案件输入', desc: '多模态录入案件信息', icon: FileText, route: '/case/input', gradient: 'from-blue-900 to-blue-700', accent: 'text-accent-400' },
  { title: '图谱可视化', desc: '浏览知识图谱关联', icon: Network, route: '/graph', gradient: 'from-indigo-900 to-indigo-700', accent: 'text-accent-300' },
  { title: '反事实推理', desc: '探索替代法律推理', icon: GitBranch, route: '/reasoning', gradient: 'from-slate-800 to-slate-600', accent: 'text-accent-400' },
  { title: '法律检索', desc: '智能搜索法条判例', icon: Search, route: '/search', gradient: 'from-amber-900 to-amber-700', accent: 'text-accent-200' },
])

const recentCases = ref<any[]>([])

function formatNumber(n: number) {
  if (n >= 10000) return (n / 10000).toFixed(1) + '万'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function navigateTo(route: string) {
  router.push(route)
}

onMounted(async () => {
  await graphStore.fetchStats()
  const s = graphStore.stats as Record<string, number>
  statsCards.value.forEach(card => {
    card.value = s[card.key] || 0
  })

  try {
    const { useCaseStore } = await import('@/stores/case')
    const caseStore = useCaseStore()
    await caseStore.fetchCases(1, 5)
    recentCases.value = caseStore.cases
  } catch {
    recentCases.value = []
  }
})
</script>

<template>
  <div class="space-y-6">
    <!-- 欢迎横幅 -->
    <div class="relative overflow-hidden rounded-xl bg-gradient-to-r from-primary-800 via-primary-700 to-primary-600 p-6 lg:p-8 text-white">
      <div class="relative z-10">
        <h1 class="font-serif text-2xl lg:text-3xl font-bold tracking-wide">
          多模态知识图谱驱动的反事实推理法律辅助系统
        </h1>
        <p class="mt-2 text-blue-200 text-sm lg:text-base max-w-2xl">
          基于知识图谱与反事实推理技术，为法律从业者提供智能化的案件分析、法条检索与判例推理服务。
        </p>
      </div>
      <div class="absolute top-0 right-0 w-64 h-64 opacity-10">
        <Scale class="w-full h-full" />
      </div>
    </div>

    <!-- 系统概览卡片 -->
    <section>
      <h2 class="section-title mb-4 flex items-center gap-2">
        <TrendingUp class="w-5 h-5 text-accent-500" />
        系统概览
      </h2>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          v-for="card in statsCards"
          :key="card.key"
          class="card-hover rounded-xl p-5 relative overflow-hidden"
        >
          <div class="absolute top-0 right-0 w-20 h-20 opacity-5">
            <component :is="card.icon" class="w-full h-full" />
          </div>
          <p class="text-sm text-gray-500 mb-1">{{ card.label }}</p>
          <p class="text-3xl font-bold font-serif" :class="card.color.includes('amber') ? 'text-amber-600' : 'text-primary-700'">
            {{ formatNumber(card.value) }}
          </p>
          <div class="mt-2 flex items-center gap-1 text-xs text-gray-400">
            <component :is="card.icon" class="w-3.5 h-3.5" />
            <span>实时数据</span>
          </div>
        </div>
      </div>
    </section>

    <!-- 快捷入口 -->
    <section>
      <h2 class="section-title mb-4 flex items-center gap-2">
        <ArrowRight class="w-5 h-5 text-accent-500" />
        快捷入口
      </h2>
      <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          v-for="entry in quickEntries"
          :key="entry.route"
          @click="navigateTo(entry.route)"
          class="group relative overflow-hidden rounded-xl p-6 text-left text-white transition-all duration-300 hover:scale-[1.02] hover:shadow-lg"
          :class="`bg-gradient-to-br ${entry.gradient}`"
        >
          <component :is="entry.icon" class="w-10 h-10 mb-3 transition-transform group-hover:scale-110" :class="entry.accent" />
          <h3 class="font-serif text-lg font-semibold mb-1">{{ entry.title }}</h3>
          <p class="text-sm text-gray-300">{{ entry.desc }}</p>
          <div class="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity">
            <ArrowRight class="w-5 h-5 text-accent-400" />
          </div>
        </button>
      </div>
    </section>

    <!-- 最近案件列表 -->
    <section>
      <div class="flex items-center justify-between mb-4">
        <h2 class="section-title flex items-center gap-2">
          <FileText class="w-5 h-5 text-accent-500" />
          最近案件
        </h2>
        <button @click="navigateTo('/case/list')" class="text-sm text-primary-600 hover:text-primary-800 flex items-center gap-1 transition-colors">
          查看全部 <ArrowRight class="w-4 h-4" />
        </button>
      </div>
      <div v-if="recentCases.length === 0" class="card-base rounded-xl p-8 text-center text-gray-400">
        <FileText class="w-12 h-12 mx-auto mb-3 text-gray-300" />
        <p>暂无案件数据</p>
      </div>
      <div v-else class="card-base rounded-xl overflow-hidden">
        <table class="w-full text-sm">
          <thead class="bg-gray-50 text-gray-500">
            <tr>
              <th class="text-left px-5 py-3 font-medium">案件标题</th>
              <th class="text-left px-5 py-3 font-medium hidden sm:table-cell">类型</th>
              <th class="text-left px-5 py-3 font-medium hidden md:table-cell">状态</th>
              <th class="text-left px-5 py-3 font-medium hidden lg:table-cell">创建时间</th>
              <th class="text-right px-5 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="c in recentCases"
              :key="c.id"
              class="border-t border-gray-100 hover:bg-blue-50/50 transition-colors"
            >
              <td class="px-5 py-3.5">
                <span class="font-medium text-gray-800">{{ c.title }}</span>
              </td>
              <td class="px-5 py-3.5 hidden sm:table-cell">
                <span class="badge-case">{{ c.case_type }}</span>
              </td>
              <td class="px-5 py-3.5 hidden md:table-cell">
                <span class="badge-law">{{ c.status }}</span>
              </td>
              <td class="px-5 py-3.5 text-gray-500 hidden lg:table-cell">
                {{ formatDate(c.created_at) }}
              </td>
              <td class="px-5 py-3.5 text-right">
                <button @click="navigateTo(`/case/input`)" class="text-primary-600 hover:text-primary-800 text-xs transition-colors">
                  详情
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
