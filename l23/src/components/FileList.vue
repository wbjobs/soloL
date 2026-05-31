<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { File, Users, HardDrive, Calendar, Download, Copy, Check } from 'lucide-vue-next'
import type { FileInfo } from '@/types'
import { fetchFiles, fetchTorrent } from '@/utils/api'
import { formatBytes, copyToClipboard } from '@/utils/format'

const files = ref<FileInfo[]>([])
const copiedId = ref<string | null>(null)

const loadFiles = async () => {
  try {
    const data = await fetchFiles()
    files.value = data.files
  } catch (err) {
    console.error('Load files failed:', err)
  }
}

const downloadTorrent = async (fileId: string, fileName: string) => {
  try {
    const blob = await fetchTorrent(fileId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileName}.torrent`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  } catch (err) {
    console.error('Download torrent failed:', err)
  }
}

const copyMagnet = async (fileId: string, magnetUri: string) => {
  try {
    await copyToClipboard(magnetUri)
    copiedId.value = fileId
    setTimeout(() => {
      copiedId.value = null
    }, 2000)
  } catch (err) {
    console.error('Copy failed:', err)
  }
}

onMounted(() => {
  loadFiles()
  const interval = setInterval(loadFiles, 5000)
  return () => clearInterval(interval)
})
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <h3 class="text-lg font-semibold text-white">种子文件列表</h3>
      <span class="text-sm text-gray-400">共 {{ files.length }} 个文件</span>
    </div>

    <div v-if="files.length === 0" class="glass-card p-12 text-center">
      <File class="w-16 h-16 mx-auto mb-4 text-gray-500" />
      <p class="text-gray-400">暂无上传的文件</p>
      <p class="text-sm text-gray-500 mt-1">上传文件后会自动在这里显示</p>
    </div>

    <div v-else class="grid gap-4">
      <div v-for="file in files" :key="file.file_id" class="glass-card p-5">
        <div class="flex items-start justify-between">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-neon-blue/20 to-neon-purple/20 flex items-center justify-center">
              <File class="w-6 h-6 text-neon-blue" />
            </div>
            <div>
              <div class="font-semibold text-white text-lg">{{ file.file_name }}</div>
              <div class="flex items-center gap-4 mt-1 text-sm text-gray-400">
                <span class="flex items-center gap-1">
                  <HardDrive class="w-4 h-4" />
                  {{ formatBytes(file.total_size) }}
                </span>
                <span class="flex items-center gap-1">
                  <Users class="w-4 h-4" />
                  {{ file.seeders }} 个种子
                </span>
                <span class="flex items-center gap-1">
                  <Calendar class="w-4 h-4" />
                  {{ new Date(file.created_at).toLocaleString('zh-CN') }}
                </span>
              </div>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="btn-outline flex items-center gap-2 text-sm"
              @click="copyMagnet(file.file_id, file.magnet_uri)"
            >
              <component :is="copiedId === file.file_id ? Check : Copy" class="w-4 h-4" />
              {{ copiedId === file.file_id ? '已复制' : '复制链接' }}
            </button>
            <button
              class="btn-neon flex items-center gap-2 text-sm"
              @click="downloadTorrent(file.file_id, file.file_name)"
            >
              <Download class="w-4 h-4" />
              下载种子
            </button>
          </div>
        </div>
        <div class="mt-4 p-3 bg-bg-900 rounded-lg">
          <div class="text-xs text-gray-500 mb-1">Info Hash</div>
          <code class="text-xs text-neon-purple font-mono">{{ file.info_hash }}</code>
        </div>
      </div>
    </div>
  </div>
</template>
