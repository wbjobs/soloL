<script setup lang="ts">
import { ref, computed } from 'vue'
import { UploadCloud, FileUp, CheckCircle, XCircle, Loader2 } from 'lucide-vue-next'
import type { UploadProgress } from '@/types'
import { formatBytes } from '@/utils/format'
import { useUpload } from '@/composables/useUpload'

const { activeUploads, completedUploads, startUpload } = useUpload()

const isDragOver = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

const handleDragOver = (e: DragEvent) => {
  e.preventDefault()
  isDragOver.value = true
}

const handleDragLeave = () => {
  isDragOver.value = false
}

const handleDrop = async (e: DragEvent) => {
  e.preventDefault()
  isDragOver.value = false
  const files = e.dataTransfer?.files
  if (files && files.length > 0) {
    await processFiles(Array.from(files))
  }
}

const handleFileSelect = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const files = target.files
  if (files && files.length > 0) {
    await processFiles(Array.from(files))
    target.value = ''
  }
}

const processFiles = async (files: File[]) => {
  for (const file of files) {
    try {
      await startUpload(file)
    } catch (err) {
      console.error('Upload failed:', err)
    }
  }
}

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'completed': return CheckCircle
    case 'error': return XCircle
    default: return Loader2
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'completed': return 'text-neon-green'
    case 'error': return 'text-neon-red'
    case 'uploading':
    case 'verifying':
    case 'preparing': return 'text-neon-blue'
    default: return 'text-gray-400'
  }
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    preparing: '准备中',
    uploading: '上传中',
    verifying: '校验中',
    completed: '已完成',
    error: '失败',
  }
  return map[status] || status
}

const activeList = computed(() => Array.from(activeUploads.values()))
</script>

<template>
  <div class="space-y-6">
    <div
      class="upload-zone p-12 text-center cursor-pointer transition-all"
      :class="{ 'drag-over': isDragOver }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="fileInputRef?.click()"
    >
      <input
        ref="fileInputRef"
        type="file"
        multiple
        class="hidden"
        @change="handleFileSelect"
      />
      <UploadCloud class="w-16 h-16 mx-auto mb-4 text-neon-blue animate-pulse-slow" />
      <h3 class="text-xl font-semibold text-white mb-2">拖拽文件到此处上传</h3>
      <p class="text-gray-400 mb-4">或点击选择文件</p>
      <div class="text-sm text-gray-500">
        支持任意类型文件 · 自动分块 · SHA-256校验 · 自动生成种子
      </div>
    </div>

    <div v-if="activeList.length > 0" class="space-y-4">
      <h3 class="text-lg font-semibold text-white">上传进度</h3>
      <div v-for="upload in activeList" :key="upload.file_id" class="glass-card p-4">
        <div class="flex items-start justify-between mb-3">
          <div class="flex items-center gap-3">
            <FileUp class="w-5 h-5 text-neon-blue" />
            <div>
              <div class="font-medium text-white">{{ upload.file_name }}</div>
              <div class="text-sm text-gray-400">{{ formatBytes(upload.total_size) }} · {{ upload.total_chunks }} 块</div>
            </div>
          </div>
          <div class="flex items-center gap-2" :class="getStatusColor(upload.status)">
            <component :is="getStatusIcon(upload.status)" class="w-5 h-5" :class="{ 'animate-spin': upload.status === 'uploading' || upload.status === 'verifying' }" />
            <span class="text-sm font-medium">{{ getStatusText(upload.status) }}</span>
          </div>
        </div>
        <div class="mb-2">
          <div class="h-2 bg-bg-700 rounded-full overflow-hidden">
            <div
              class="progress-bar h-full"
              :style="{ width: `${(upload.verified_chunks / upload.total_chunks) * 100}%` }"
            ></div>
          </div>
        </div>
        <div class="flex justify-between text-sm text-gray-400">
          <span>分块: {{ upload.verified_chunks }} / {{ upload.total_chunks }}</span>
          <span>{{ formatBytes(upload.verified_chunks * 256 * 1024) }} / {{ formatBytes(upload.total_size) }}</span>
        </div>
        <div v-if="upload.error" class="mt-2 text-sm text-neon-red">
          错误: {{ upload.error }}
        </div>
      </div>
    </div>

    <div v-if="completedUploads.length > 0" class="space-y-4">
      <h3 class="text-lg font-semibold text-white">已完成</h3>
      <div v-for="upload in completedUploads" :key="upload.file_id" class="glass-card p-4">
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-3">
            <CheckCircle class="w-5 h-5 text-neon-green" />
            <div>
              <div class="font-medium text-white">{{ upload.file_name }}</div>
              <div class="text-sm text-gray-400">{{ formatBytes(upload.total_size) }} · SHA-256 校验通过</div>
            </div>
          </div>
          <span class="text-neon-green text-sm font-medium">做种中</span>
        </div>
        <div class="mt-3 p-3 bg-bg-900 rounded-lg">
          <div class="text-xs text-gray-400 mb-1">Magnet 链接</div>
          <code class="text-xs text-neon-blue break-all font-mono">{{ upload.magnet_uri }}</code>
        </div>
      </div>
    </div>
  </div>
</template>
