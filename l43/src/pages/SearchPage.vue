<script setup lang="ts">
import { ref } from 'vue'
import { searchApi } from '@/composables/useApi'
import type { SearchResult } from '@/composables/useApi'
import { ElMessage } from 'element-plus'
import { Search, BookOpen, Scale, FileText, AlertCircle } from 'lucide-vue-next'

const query = ref('')
const searchType = ref('all')
const results = ref<SearchResult[]>([])
const loading = ref(false)
const hasSearched = ref(false)

const searchTypeOptions = [
  { label: '全部', value: 'all', icon: Search },
  { label: '法条', value: 'law', icon: BookOpen },
  { label: '判例', value: 'case', icon: Scale },
  { label: '情节', value: 'circumstance', icon: FileText },
]

const typeTagMap: Record<string, { label: string; class: string }> = {
  law: { label: '法条', class: 'bg-blue-100 text-blue-700' },
  case: { label: '判例', class: 'bg-green-100 text-green-700' },
  circumstance: { label: '情节', class: 'bg-amber-100 text-amber-700' },
}

function getTypeTag(type: string) {
  return typeTagMap[type] || { label: type, class: 'bg-gray-100 text-gray-700' }
}

function getSimilarityColor(similarity: number): string {
  if (similarity >= 0.8) return 'bg-green-500'
  if (similarity >= 0.6) return 'bg-blue-500'
  if (similarity >= 0.4) return 'bg-yellow-500'
  return 'bg-orange-500'
}

async function handleSearch() {
  if (!query.value.trim()) {
    ElMessage.warning('请输入检索关键词')
    return
  }

  loading.value = true
  hasSearched.value = true
  try {
    const res: any = await searchApi.legal({
      query: query.value.trim(),
      search_type: searchType.value,
      limit: 20,
    })
    results.value = res.results || []
  } catch (e: any) {
    ElMessage.error(e.message || '检索失败，请稍后重试')
    results.value = []
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- 搜索区域 -->
    <div class="card-base p-6">
      <div class="max-w-2xl mx-auto space-y-4">
        <div class="text-center mb-2">
          <h2 class="section-title">法律检索</h2>
          <p class="text-sm text-gray-500 mt-1">搜索法条、判例、情节相关内容</p>
        </div>

        <!-- 搜索类型选择 -->
        <div class="flex justify-center gap-2">
          <button
            v-for="opt in searchTypeOptions"
            :key="opt.value"
            @click="searchType = opt.value"
            class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-colors duration-200"
            :class="searchType === opt.value
              ? 'bg-blue-900 text-white shadow-sm'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
          >
            <component :is="opt.icon" class="w-4 h-4" />
            {{ opt.label }}
          </button>
        </div>

        <!-- 搜索框 -->
        <div class="relative">
          <Search class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            v-model="query"
            type="text"
            placeholder="输入关键词进行法律检索..."
            class="w-full pl-12 pr-28 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 shadow-sm"
            @keyup.enter="handleSearch"
          />
          <button
            @click="handleSearch"
            :disabled="loading"
            class="absolute right-2 top-1/2 -translate-y-1/2 px-5 py-1.5 bg-blue-900 text-white rounded-lg text-sm hover:bg-blue-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {{ loading ? '检索中...' : '检索' }}
          </button>
        </div>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="loading" class="flex items-center justify-center py-12">
      <div class="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <span class="ml-3 text-gray-500">正在检索中...</span>
    </div>

    <!-- 搜索结果 -->
    <div v-else-if="results.length > 0" class="space-y-3">
      <div class="text-sm text-gray-500 mb-2">
        共找到 {{ results.length }} 条结果
      </div>
      <transition-group name="result-fade" tag="div" class="space-y-3">
        <div
          v-for="(item, index) in results"
          :key="item.id"
          class="card-hover p-4"
          :style="{ transitionDelay: `${index * 60}ms` }"
        >
          <div class="flex items-start gap-3">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1.5">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="getTypeTag(item.type).class"
                >
                  {{ getTypeTag(item.type).label }}
                </span>
                <h3 class="text-sm font-medium text-gray-800 truncate">
                  {{ item.title }}
                </h3>
              </div>
              <p class="text-sm text-gray-500 line-clamp-2 leading-relaxed">
                {{ item.content }}
              </p>
            </div>
            <div class="flex-shrink-0 w-28">
              <div class="flex items-center gap-1.5 mb-1">
                <span class="text-xs text-gray-400">相似度</span>
                <span class="text-xs font-medium text-gray-700">
                  {{ (item.similarity * 100).toFixed(1) }}%
                </span>
              </div>
              <div class="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-700"
                  :class="getSimilarityColor(item.similarity)"
                  :style="{ width: `${item.similarity * 100}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </transition-group>
    </div>

    <!-- 空状态 -->
    <div
      v-else-if="hasSearched"
      class="flex flex-col items-center justify-center py-20 text-gray-400"
    >
      <AlertCircle class="w-14 h-14 mb-4 text-gray-300" />
      <p class="text-base font-medium text-gray-500">未找到相关结果</p>
      <p class="text-sm mt-1">请尝试更换关键词或调整检索类型</p>
    </div>

    <!-- 初始状态 -->
    <div
      v-else
      class="flex flex-col items-center justify-center py-20 text-gray-400"
    >
      <Search class="w-14 h-14 mb-4 text-gray-300" />
      <p class="text-base font-medium text-gray-500">输入关键词开始检索</p>
      <p class="text-sm mt-1">支持搜索法条、判例、情节等法律内容</p>
    </div>
  </div>
</template>

<style scoped>
.result-fade-enter-active {
  transition: all 0.4s ease-out;
}
.result-fade-enter-from {
  opacity: 0;
  transform: translateY(12px);
}
.result-fade-leave-active {
  transition: all 0.2s ease-in;
}
.result-fade-leave-to {
  opacity: 0;
}

.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
