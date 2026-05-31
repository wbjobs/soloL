<script setup lang="ts">
import { ref } from 'vue'
import { useCaseStore } from '@/stores/case'
import { ElMessage } from 'element-plus'
import { FileText, ImagePlus, Mic, Upload, Sparkles, ChevronRight, X, Loader2 } from 'lucide-vue-next'

const caseStore = useCaseStore()

const form = ref({
  title: '',
  description: '',
  case_type: 'civil',
})

const caseTypes = [
  { label: '民事案件', value: 'civil' },
  { label: '刑事案件', value: 'criminal' },
  { label: '行政案件', value: 'administrative' },
  { label: '经济案件', value: 'economic' },
]

const textContent = ref('')
const imageFile = ref<File | null>(null)
const imagePreview = ref('')
const audioFile = ref<File | null>(null)
const audioFileName = ref('')
const isDraggingImage = ref(false)
const isDraggingAudio = ref(false)
const isSubmitting = ref(false)
const createdCaseId = ref('')

const extractedElements = ref<any[]>([])

function handleImageDrop(e: DragEvent) {
  isDraggingImage.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('image/')) {
    setImageFile(file)
  }
}

function handleImageSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) setImageFile(file)
}

function setImageFile(file: File) {
  imageFile.value = file
  imagePreview.value = URL.createObjectURL(file)
}

function clearImage() {
  imageFile.value = null
  imagePreview.value = ''
}

function handleAudioDrop(e: DragEvent) {
  isDraggingAudio.value = false
  const file = e.dataTransfer?.files?.[0]
  if (file && file.type.startsWith('audio/')) {
    audioFile.value = file
    audioFileName.value = file.name
  }
}

function handleAudioSelect(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (file) {
    audioFile.value = file
    audioFileName.value = file.name
  }
}

function clearAudio() {
  audioFile.value = null
  audioFileName.value = ''
}

async function handleSubmit() {
  if (!form.value.title.trim()) {
    ElMessage.warning('请输入案件标题')
    return
  }
  if (!form.value.description.trim()) {
    ElMessage.warning('请输入案件描述')
    return
  }

  isSubmitting.value = true
  try {
    const result = await caseStore.createCase({
      title: form.value.title,
      description: form.value.description,
      case_type: form.value.case_type,
    })
    createdCaseId.value = result.id
    ElMessage.success('案件创建成功')

    const uploads: Promise<any>[] = []

    if (textContent.value.trim()) {
      uploads.push(caseStore.uploadText(result.id, textContent.value))
    }
    if (imageFile.value) {
      uploads.push(caseStore.uploadImage(result.id, imageFile.value))
    }
    if (audioFile.value) {
      uploads.push(caseStore.uploadAudio(result.id, audioFile.value))
    }

    if (uploads.length > 0) {
      const results = await Promise.allSettled(uploads)
      const fulfilled = results.filter(r => r.status === 'fulfilled')
      const rejected = results.filter(r => r.status === 'rejected')

      if (rejected.length > 0) {
        ElMessage.warning(`${rejected.length} 个文件上传失败`)
      }

      fulfilled.forEach(r => {
        if (r.status === 'fulfilled' && r.value?.elements) {
          extractedElements.value.push(...r.value.elements)
        }
      })
    }

    if (result.elements?.length) {
      extractedElements.value = [...result.elements, ...extractedElements.value]
    }

    if (extractedElements.value.length === 0 && uploads.length === 0) {
      ElMessage.info('案件已创建，请上传材料以提取要素')
    }
  } catch {
    ElMessage.error('案件创建失败，请重试')
  } finally {
    isSubmitting.value = false
  }
}

function resetForm() {
  form.value = { title: '', description: '', case_type: 'civil' }
  textContent.value = ''
  clearImage()
  clearAudio()
  extractedElements.value = []
  createdCaseId.value = ''
}

const elementTypeMap: Record<string, { label: string; cls: string }> = {
  law: { label: '法条', cls: 'badge-law' },
  case: { label: '判例', cls: 'badge-case' },
  circumstance: { label: '情节', cls: 'badge-circumstance' },
  person: { label: '人物', cls: 'badge-person' },
}
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <!-- 案件基本信息表单 -->
    <section class="card-base rounded-xl p-6">
      <h2 class="section-title mb-5 flex items-center gap-2">
        <FileText class="w-5 h-5 text-accent-500" />
        案件基本信息
      </h2>
      <div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">案件标题</label>
          <input
            v-model="form.title"
            type="text"
            placeholder="请输入案件标题"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">案件描述</label>
          <textarea
            v-model="form.description"
            rows="3"
            placeholder="请简要描述案件情况"
            class="w-full px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors resize-none"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">案件类型</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="ct in caseTypes"
              :key="ct.value"
              @click="form.case_type = ct.value"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200"
              :class="form.case_type === ct.value
                ? 'bg-primary-700 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'"
            >
              {{ ct.label }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 多模态上传区域 -->
    <section class="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <!-- 文本输入 -->
      <div class="card-base rounded-xl p-5 flex flex-col">
        <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <FileText class="w-4 h-4 text-primary-600" />
          文本输入
        </h3>
        <textarea
          v-model="textContent"
          rows="8"
          placeholder="粘贴案件相关文本内容，系统将自动提取关键要素..."
          class="flex-1 w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors resize-none"
        />
      </div>

      <!-- 图片上传 -->
      <div class="card-base rounded-xl p-5 flex flex-col">
        <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <ImagePlus class="w-4 h-4 text-emerald-600" />
          图片上传
        </h3>
        <div
          v-if="!imagePreview"
          @dragover.prevent="isDraggingImage = true"
          @dragleave="isDraggingImage = false"
          @drop.prevent="handleImageDrop"
          @click="($refs.imageInput as HTMLInputElement)?.click()"
          class="flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-colors"
          :class="isDraggingImage ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'"
        >
          <Upload class="w-8 h-8 text-gray-300 mb-2" />
          <p class="text-xs text-gray-400">拖拽图片到此处或点击上传</p>
          <p class="text-xs text-gray-300 mt-1">支持 JPG / PNG / PDF</p>
          <input
            ref="imageInput"
            type="file"
            accept="image/*,.pdf"
            class="hidden"
            @change="handleImageSelect"
          />
        </div>
        <div v-else class="flex-1 relative">
          <img :src="imagePreview" alt="预览" class="w-full h-full object-contain rounded-lg" />
          <button
            @click="clearImage"
            class="absolute top-2 right-2 w-7 h-7 flex items-center justify-center bg-black/50 text-white rounded-full hover:bg-black/70 transition-colors"
          >
            <X class="w-4 h-4" />
          </button>
        </div>
      </div>

      <!-- 音频上传 -->
      <div class="card-base rounded-xl p-5 flex flex-col">
        <h3 class="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
          <Mic class="w-4 h-4 text-amber-600" />
          音频上传
        </h3>
        <div
          v-if="!audioFileName"
          @dragover.prevent="isDraggingAudio = true"
          @dragleave="isDraggingAudio = false"
          @drop.prevent="handleAudioDrop"
          @click="($refs.audioInput as HTMLInputElement)?.click()"
          class="flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-lg cursor-pointer transition-colors"
          :class="isDraggingAudio ? 'border-amber-500 bg-amber-50' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'"
        >
          <Upload class="w-8 h-8 text-gray-300 mb-2" />
          <p class="text-xs text-gray-400">拖拽音频到此处或点击上传</p>
          <p class="text-xs text-gray-300 mt-1">支持 MP3 / WAV / M4A</p>
          <input
            ref="audioInput"
            type="file"
            accept="audio/*"
            class="hidden"
            @change="handleAudioSelect"
          />
        </div>
        <div v-else class="flex-1 flex items-center justify-center">
          <div class="text-center">
            <Mic class="w-10 h-10 text-amber-500 mx-auto mb-2" />
            <p class="text-sm font-medium text-gray-700 truncate max-w-full">{{ audioFileName }}</p>
            <button
              @click="clearAudio"
              class="mt-2 text-xs text-red-500 hover:text-red-700 flex items-center gap-1 mx-auto transition-colors"
            >
              <X class="w-3 h-3" /> 移除
            </button>
          </div>
        </div>
      </div>
    </section>

    <!-- 提交按钮 -->
    <div class="flex items-center gap-3">
      <button
        @click="handleSubmit"
        :disabled="isSubmitting"
        class="btn-primary flex items-center gap-2 px-6 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <Loader2 v-if="isSubmitting" class="w-4 h-4 animate-spin" />
        <Sparkles v-else class="w-4 h-4" />
        {{ isSubmitting ? '提交中...' : '创建案件并分析' }}
      </button>
      <button @click="resetForm" class="px-4 py-2.5 text-sm text-gray-500 hover:text-gray-700 transition-colors">
        重置
      </button>
    </div>

    <!-- 要素提取结果 -->
    <section v-if="extractedElements.length > 0" class="card-base rounded-xl p-6">
      <h2 class="section-title mb-4 flex items-center gap-2">
        <Sparkles class="w-5 h-5 text-accent-500" />
        要素提取结果
      </h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div
          v-for="(el, idx) in extractedElements"
          :key="el.id || idx"
          class="flex items-start gap-3 p-3 bg-gray-50 rounded-lg"
        >
          <span :class="elementTypeMap[el.type]?.cls || 'badge-law'" class="mt-0.5 flex-shrink-0">
            {{ elementTypeMap[el.type]?.label || el.type }}
          </span>
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-800">{{ el.name }}</p>
            <p v-if="el.value" class="text-xs text-gray-500 mt-0.5 truncate">{{ el.value }}</p>
          </div>
        </div>
      </div>
      <div v-if="createdCaseId" class="mt-4 pt-4 border-t border-gray-100 flex items-center justify-end">
        <button
          @click="$router.push(`/reasoning`)"
          class="btn-accent flex items-center gap-1.5 text-sm"
        >
          进入反事实推理 <ChevronRight class="w-4 h-4" />
        </button>
      </div>
    </section>
  </div>
</template>
