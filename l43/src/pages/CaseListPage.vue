<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useCaseStore } from '@/stores/case'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search, Plus, Eye, Trash2, FolderOpen } from 'lucide-vue-next'

const caseStore = useCaseStore()
const router = useRouter()

const searchQuery = ref('')
const selectedType = ref('')
const currentPage = ref(1)
const pageSize = ref(20)

const caseTypeOptions = [
  { label: '全部', value: '' },
  { label: '刑事', value: 'criminal' },
  { label: '民事', value: 'civil' },
  { label: '行政', value: 'administrative' },
]

const typeTagMap: Record<string, { label: string; class: string }> = {
  criminal: { label: '刑事', class: 'bg-red-100 text-red-700' },
  civil: { label: '民事', class: 'bg-blue-100 text-blue-700' },
  administrative: { label: '行政', class: 'bg-green-100 text-green-700' },
}

const statusTagMap: Record<string, { label: string; class: string }> = {
  processing: { label: '处理中', class: 'bg-orange-100 text-orange-700' },
  completed: { label: '已完成', class: 'bg-green-100 text-green-700' },
}

function getTypeTag(type: string) {
  return typeTagMap[type] || { label: type, class: 'bg-gray-100 text-gray-700' }
}

function getStatusTag(status: string) {
  return statusTagMap[status] || { label: status, class: 'bg-gray-100 text-gray-700' }
}

async function loadCases() {
  await caseStore.fetchCases(currentPage.value, pageSize.value, selectedType.value || undefined)
}

function handleSearch() {
  currentPage.value = 1
  loadCases()
}

function handleTypeChange() {
  currentPage.value = 1
  loadCases()
}

function handlePageChange(page: number) {
  currentPage.value = page
  loadCases()
}

function handleSizeChange(size: number) {
  pageSize.value = size
  currentPage.value = 1
  loadCases()
}

function viewCase(id: string) {
  router.push({ name: 'case-input', query: { id } })
}

async function handleDelete(id: string, title: string) {
  try {
    await ElMessageBox.confirm(
      `确定要删除案件「${title}」吗？此操作不可恢复。`,
      '删除确认',
      { confirmButtonText: '确定删除', cancelButtonText: '取消', type: 'warning' }
    )
    await caseStore.deleteCase(id)
    ElMessage.success('删除成功')
    loadCases()
  } catch {
    // 用户取消
  }
}

const filteredCases = ref<any[]>([])

function updateFilteredCases() {
  let list = caseStore.cases
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.trim().toLowerCase()
    list = list.filter(
      (c: any) =>
        c.title?.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
    )
  }
  filteredCases.value = list
}

onMounted(() => {
  loadCases()
})
</script>

<template>
  <div class="space-y-4">
    <!-- 搜索与筛选 -->
    <div class="card-base p-4">
      <div class="flex flex-col sm:flex-row gap-3">
        <div class="relative flex-1">
          <Search class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索案件标题或描述..."
            class="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
            @keyup.enter="handleSearch"
          />
        </div>
        <div class="flex gap-2 items-center">
          <button
            v-for="opt in caseTypeOptions"
            :key="opt.value"
            @click="selectedType = opt.value; handleTypeChange()"
            class="px-3 py-1.5 rounded-lg text-sm transition-colors duration-200"
            :class="selectedType === opt.value
              ? 'bg-blue-900 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
          >
            {{ opt.label }}
          </button>
        </div>
        <button @click="handleSearch" class="btn-primary flex items-center gap-1.5 text-sm whitespace-nowrap">
          <Search class="w-4 h-4" />
          搜索
        </button>
        <button
          @click="router.push({ name: 'case-input' })"
          class="btn-accent flex items-center gap-1.5 text-sm whitespace-nowrap"
        >
          <Plus class="w-4 h-4" />
          新建案件
        </button>
      </div>
    </div>

    <!-- 案件列表 -->
    <div class="card-base overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-50 border-b border-gray-100">
              <th class="text-left px-4 py-3 font-medium text-gray-600">案件标题</th>
              <th class="text-left px-4 py-3 font-medium text-gray-600">类型</th>
              <th class="text-left px-4 py-3 font-medium text-gray-600">状态</th>
              <th class="text-left px-4 py-3 font-medium text-gray-600">创建时间</th>
              <th class="text-center px-4 py-3 font-medium text-gray-600">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in caseStore.cases"
              :key="item.id"
              class="border-b border-gray-50 hover:bg-blue-50/40 transition-colors"
            >
              <td class="px-4 py-3">
                <span class="font-medium text-gray-800">{{ item.title }}</span>
              </td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="getTypeTag(item.case_type).class"
                >
                  {{ getTypeTag(item.case_type).label }}
                </span>
              </td>
              <td class="px-4 py-3">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :class="getStatusTag(item.status).class"
                >
                  {{ getStatusTag(item.status).label }}
                </span>
              </td>
              <td class="px-4 py-3 text-gray-500">
                {{ new Date(item.created_at).toLocaleString('zh-CN') }}
              </td>
              <td class="px-4 py-3">
                <div class="flex items-center justify-center gap-2">
                  <button
                    @click="viewCase(item.id)"
                    class="p-1.5 rounded-md text-blue-600 hover:bg-blue-100 transition-colors"
                    title="查看详情"
                  >
                    <Eye class="w-4 h-4" />
                  </button>
                  <button
                    @click="handleDelete(item.id, item.title)"
                    class="p-1.5 rounded-md text-red-500 hover:bg-red-100 transition-colors"
                    title="删除"
                  >
                    <Trash2 class="w-4 h-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 空状态 -->
      <div
        v-if="!caseStore.loading && caseStore.cases.length === 0"
        class="flex flex-col items-center justify-center py-16 text-gray-400"
      >
        <FolderOpen class="w-12 h-12 mb-3" />
        <p class="text-sm">暂无案件数据</p>
      </div>

      <!-- 加载状态 -->
      <div v-if="caseStore.loading" class="flex items-center justify-center py-8">
        <div class="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <span class="ml-2 text-sm text-gray-500">加载中...</span>
      </div>
    </div>

    <!-- 分页控件 -->
    <div
      v-if="caseStore.total > 0"
      class="card-base p-4 flex items-center justify-between"
    >
      <span class="text-sm text-gray-500">
        共 {{ caseStore.total }} 条记录
      </span>
      <div class="flex items-center gap-2">
        <button
          :disabled="currentPage <= 1"
          @click="handlePageChange(currentPage - 1)"
          class="px-3 py-1.5 rounded text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          上一页
        </button>
        <span class="text-sm text-gray-600 px-2">
          {{ currentPage }} / {{ Math.max(1, Math.ceil(caseStore.total / pageSize)) }}
        </span>
        <button
          :disabled="currentPage >= Math.ceil(caseStore.total / pageSize)"
          @click="handlePageChange(currentPage + 1)"
          class="px-3 py-1.5 rounded text-sm border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          下一页
        </button>
      </div>
    </div>
  </div>
</template>
