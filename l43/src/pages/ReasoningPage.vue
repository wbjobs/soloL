<script setup lang="ts">
import { ref, computed } from 'vue'
import { useCaseStore } from '@/stores/case'
import { reasoningApi } from '@/composables/useApi'
import { ElMessage } from 'element-plus'
import {
  GitBranch, Play, RotateCcw, ArrowRight, Scale,
  FileText, BookOpen, TrendingUp, AlertTriangle, CheckCircle2
} from 'lucide-vue-next'

const caseStore = useCaseStore()

const selectedCaseId = ref('')
const customCaseId = ref('')
const useCustomId = ref(false)
const reasoningDepth = ref(3)
const isReasoning = ref(false)

interface ModifiedElement {
  id: string
  name: string
  type: string
  originalValue: any
  modifiedValue: any
  editable: boolean
}

const editableElements = ref<ModifiedElement[]>([])

interface ReasoningStep {
  description: string
  law_reference: string
  confidence: number
}

interface Difference {
  field: string
  original: string
  alternative: string
}

interface ReasoningResultData {
  original_verdict: string
  alternative_verdict: string
  reasoning_path: ReasoningStep[]
  differences: Difference[]
  confidence: number
}

const reasoningResult = ref<ReasoningResultData | null>(null)

const currentCaseId = computed(() => {
  if (useCustomId.value && customCaseId.value.trim()) {
    return customCaseId.value.trim()
  }
  return selectedCaseId.value
})

const hasElements = computed(() => editableElements.value.length > 0)

const modifiedElementsPayload = computed(() =>
  editableElements.value
    .filter(el => el.modifiedValue !== el.originalValue && el.modifiedValue !== '')
    .map(el => ({
      id: el.id,
      name: el.name,
      type: el.type,
      original_value: el.originalValue,
      modified_value: el.modifiedValue,
    }))
)

const overallConfidence = computed(() => {
  if (!reasoningResult.value) return 0
  return reasoningResult.value.confidence
})

const confidenceLevel = computed(() => {
  const c = overallConfidence.value
  if (c >= 0.8) return { label: '高', color: 'text-green-600', bg: 'bg-green-100' }
  if (c >= 0.5) return { label: '中', color: 'text-amber-600', bg: 'bg-amber-100' }
  return { label: '低', color: 'text-red-600', bg: 'bg-red-100' }
})

async function loadCase() {
  if (!currentCaseId.value) {
    ElMessage.warning('请选择或输入案件ID')
    return
  }

  try {
    await caseStore.fetchCase(currentCaseId.value)
    if (caseStore.currentCase) {
      editableElements.value = caseStore.currentCase.elements
        .filter(el => el.editable)
        .map(el => ({
          id: el.id,
          name: el.name,
          type: el.type,
          originalValue: el.value,
          modifiedValue: el.value,
          editable: el.editable,
        }))
      reasoningResult.value = null
      ElMessage.success('案件加载成功')
    }
  } catch {
    ElMessage.error('加载案件失败，请检查案件ID')
  }
}

function resetElements() {
  editableElements.value.forEach(el => {
    el.modifiedValue = el.originalValue
  })
}

async function startReasoning() {
  if (!currentCaseId.value) {
    ElMessage.warning('请先选择案件')
    return
  }

  if (modifiedElementsPayload.value.length === 0) {
    ElMessage.warning('请至少修改一个要素')
    return
  }

  isReasoning.value = true
  reasoningResult.value = null

  try {
    const res: any = await reasoningApi.counterfactual({
      case_id: currentCaseId.value,
      modified_elements: modifiedElementsPayload.value,
      reasoning_depth: reasoningDepth.value,
    })

    reasoningResult.value = {
      original_verdict: res.original_verdict || '',
      alternative_verdict: res.alternative_verdict || '',
      reasoning_path: res.reasoning_path || [],
      differences: res.differences || [],
      confidence: res.confidence || 0,
    }

    ElMessage.success('推理完成')
  } catch (e: any) {
    ElMessage.error(e.message || '推理请求失败')
  } finally {
    isReasoning.value = false
  }
}

function isDiffHighlight(field: string): boolean {
  return reasoningResult.value?.differences.some(d => d.field === field) ?? false
}
</script>

<template>
  <div class="flex flex-col h-full gap-4">
    <div class="card-base p-4">
      <div class="flex items-center gap-4 flex-wrap">
        <div class="flex items-center gap-2">
          <GitBranch class="w-4 h-4 text-blue-900" />
          <span class="text-sm font-medium text-gray-700">案件选择</span>
        </div>

        <div class="flex items-center gap-2 flex-1 min-w-[240px]">
          <template v-if="!useCustomId">
            <select
              v-model="selectedCaseId"
              class="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400 bg-white"
            >
              <option value="" disabled>选择已有案件</option>
              <option v-for="c in caseStore.cases" :key="c.id" :value="c.id">
                {{ c.title }}
              </option>
            </select>
          </template>
          <template v-else>
            <input
              v-model="customCaseId"
              type="text"
              placeholder="输入案件ID"
              class="flex-1 px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
          </template>
          <button
            @click="useCustomId = !useCustomId"
            class="text-xs text-blue-600 hover:text-blue-800 whitespace-nowrap"
          >
            {{ useCustomId ? '选择案件' : '输入ID' }}
          </button>
        </div>

        <button @click="loadCase" class="btn-primary text-sm" :disabled="caseStore.loading">
          加载案件
        </button>
      </div>
    </div>

    <div v-if="hasElements" class="card-base p-4">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-2">
          <Scale class="w-4 h-4 text-blue-900" />
          <span class="section-title text-base">要素编辑</span>
          <span class="text-xs text-gray-400">修改要素值以进行反事实推理</span>
        </div>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <span class="text-xs text-gray-500">推理深度</span>
            <input
              v-model.number="reasoningDepth"
              type="number"
              min="1"
              max="10"
              class="w-16 px-2 py-1 text-sm border border-gray-200 rounded-md text-center focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
          </div>
          <button @click="resetElements" class="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-md" title="重置">
            <RotateCcw class="w-4 h-4" />
          </button>
          <button
            @click="startReasoning"
            class="btn-accent text-sm flex items-center gap-1.5"
            :disabled="isReasoning || modifiedElementsPayload.length === 0"
          >
            <Play class="w-3.5 h-3.5" />
            {{ isReasoning ? '推理中...' : '开始推理' }}
          </button>
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        <div
          v-for="el in editableElements"
          :key="el.id"
          class="border rounded-lg p-3 transition-colors"
          :class="el.modifiedValue !== el.originalValue ? 'border-amber-300 bg-amber-50/50' : 'border-gray-200 bg-white'"
        >
          <div class="flex items-center justify-between mb-2">
            <span class="text-sm font-medium text-gray-700 truncate">{{ el.name }}</span>
            <span class="text-xs text-gray-400">{{ el.type }}</span>
          </div>
          <div class="text-xs text-gray-500 mb-1.5">
            当前值: <span class="text-gray-700 font-medium">{{ el.originalValue }}</span>
          </div>
          <input
            v-model="el.modifiedValue"
            type="text"
            :placeholder="String(el.originalValue)"
            class="w-full px-2 py-1 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-amber-400/30 focus:border-amber-400"
          />
        </div>
      </div>
    </div>

    <div v-if="!hasElements && currentCaseId" class="card-base p-8 flex flex-col items-center justify-center text-gray-400">
      <FileText class="w-10 h-10 mb-2 opacity-50" />
      <p class="text-sm">点击"加载案件"查看可编辑要素</p>
    </div>

    <div v-if="!currentCaseId && !hasElements" class="card-base p-8 flex flex-col items-center justify-center text-gray-400">
      <GitBranch class="w-10 h-10 mb-2 opacity-50" />
      <p class="text-sm">请先选择一个案件开始反事实推理</p>
    </div>

    <div v-if="reasoningResult" class="flex-1 min-h-0 flex flex-col gap-4 overflow-y-auto">
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div class="card-base p-4">
          <div class="flex items-center gap-2 mb-3">
            <FileText class="w-4 h-4 text-gray-600" />
            <span class="text-sm font-semibold text-gray-700">原判决</span>
          </div>
          <div class="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap p-3 bg-gray-50 rounded-lg">
            {{ reasoningResult.original_verdict }}
          </div>
        </div>

        <div class="card-base p-4 border-amber-200">
          <div class="flex items-center gap-2 mb-3">
            <AlertTriangle class="w-4 h-4 text-amber-600" />
            <span class="text-sm font-semibold text-amber-700">替代判决</span>
            <span
              class="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium"
              :class="[confidenceLevel.bg, confidenceLevel.color]"
            >
              <TrendingUp class="w-3 h-3" />
              置信度: {{ (overallConfidence * 100).toFixed(1) }}% ({{ confidenceLevel.label }})
            </span>
          </div>
          <div class="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap p-3 bg-amber-50 rounded-lg">
            {{ reasoningResult.alternative_verdict }}
          </div>
        </div>
      </div>

      <div v-if="reasoningResult.differences.length > 0" class="card-base p-4">
        <div class="flex items-center gap-2 mb-3">
          <AlertTriangle class="w-4 h-4 text-amber-500" />
          <span class="text-sm font-semibold text-gray-700">差异对比</span>
        </div>
        <div class="space-y-2">
          <div
            v-for="(diff, idx) in reasoningResult.differences"
            :key="idx"
            class="flex items-start gap-3 p-3 rounded-lg bg-gray-50 text-sm"
          >
            <span class="font-medium text-gray-700 w-24 flex-shrink-0">{{ diff.field }}</span>
            <div class="flex-1 flex items-center gap-2">
              <span class="px-2 py-0.5 bg-red-50 text-red-700 rounded text-xs">{{ diff.original }}</span>
              <ArrowRight class="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span class="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs">{{ diff.alternative }}</span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="reasoningResult.reasoning_path.length > 0" class="card-base p-4">
        <div class="flex items-center gap-2 mb-3">
          <BookOpen class="w-4 h-4 text-blue-900" />
          <span class="text-sm font-semibold text-gray-700">推理路径</span>
        </div>
        <div class="space-y-0">
          <div
            v-for="(step, idx) in reasoningResult.reasoning_path"
            :key="idx"
            class="flex gap-3 relative"
          >
            <div class="flex flex-col items-center">
              <div
                class="w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold flex-shrink-0"
                :class="step.confidence >= 0.8
                  ? 'bg-green-100 text-green-700'
                  : step.confidence >= 0.5
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-red-100 text-red-700'"
              >
                {{ idx + 1 }}
              </div>
              <div
                v-if="idx < reasoningResult.reasoning_path.length - 1"
                class="w-px flex-1 bg-gray-200 my-1"
              />
            </div>
            <div class="flex-1 pb-4">
              <p class="text-sm text-gray-700">{{ step.description }}</p>
              <div class="flex items-center gap-3 mt-1.5">
                <span v-if="step.law_reference" class="inline-flex items-center gap-1 text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded">
                  <Scale class="w-3 h-3" />
                  {{ step.law_reference }}
                </span>
                <span
                  class="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded"
                  :class="step.confidence >= 0.8
                    ? 'bg-green-50 text-green-700'
                    : step.confidence >= 0.5
                      ? 'bg-amber-50 text-amber-700'
                      : 'bg-red-50 text-red-700'"
                >
                  <CheckCircle2 class="w-3 h-3" />
                  {{ (step.confidence * 100).toFixed(1) }}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
