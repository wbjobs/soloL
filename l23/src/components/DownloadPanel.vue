<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { Link, Play, Pause, Users, Download, Upload, HardDrive, Clock, AlertTriangle } from 'lucide-vue-next'
import SpeedChart from './SpeedChart.vue'
import ChunkGrid from './ChunkGrid.vue'
import PeerHealthPanel from './PeerHealthPanel.vue'
import { useTorrent } from '@/composables/useTorrent'
import { useStats } from '@/composables/useStats'
import { formatBytes, formatSpeed, formatTime, parseMagnetUri } from '@/utils/format'
import type { SpeedRecord } from '@/types'

const { downloads, speedHistory, isClientReady, initClient, downloadTorrent, stopDownload } = useTorrent()
const { addWebTorrentRecord, getSummary } = useStats()

const magnetInput = ref('')
const errorMessage = ref('')

const downloadsList = computed(() => Array.from(downloads.values()))
const historyForActive = computed((): SpeedRecord[] => {
  const active = downloadsList.value[0]
  if (!active) return []
  return speedHistory.get(active.info_hash) || []
})

const summary = computed(() => getSummary())

let statsInterval: ReturnType<typeof setInterval> | null = null

const startDownload = () => {
  if (!magnetInput.value.trim()) {
    errorMessage.value = '请输入 Magnet 链接'
    return
  }

  const parsed = parseMagnetUri(magnetInput.value.trim())
  if (!parsed) {
    errorMessage.value = '无效的 Magnet 链接'
    return
  }

  errorMessage.value = ''
  initClient()

  try {
    downloadTorrent(magnetInput.value.trim())
    magnetInput.value = ''

    if (statsInterval) clearInterval(statsInterval)
    statsInterval = setInterval(() => {
      downloadsList.value.forEach(dl => {
        addWebTorrentRecord(dl.download_speed, dl.upload_speed, dl.peers)
      })
    }, 1000)
  } catch (err: any) {
    errorMessage.value = err.message
  }
}

const getStatusColor = (status: string) => {
  switch (status) {
    case 'seeding': return 'text-neon-green'
    case 'downloading': return 'text-neon-blue'
    case 'paused': return 'text-gray-400'
    case 'error': return 'text-neon-red'
    default: return 'text-gray-400'
  }
}

const getStatusText = (status: string) => {
  const map: Record<string, string> = {
    idle: '等待中',
    downloading: '下载中',
    seeding: '做种中',
    paused: '已暂停',
    error: '错误',
  }
  return map[status] || status
}

const handleTorrentFile = async (e: Event) => {
  const target = e.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    if (text.includes('magnet:')) {
      magnetInput.value = text.trim()
    }
  } catch (err) {
    errorMessage.value = '无法读取 torrent 文件'
  }
  target.value = ''
}

onUnmounted(() => {
  if (statsInterval) clearInterval(statsInterval)
})
</script>

<template>
  <div class="space-y-6">
    <div class="glass-card p-6">
      <h3 class="text-lg font-semibold text-white mb-4">开始P2P下载</h3>
      <div class="space-y-4">
        <div>
          <label class="block text-sm text-gray-400 mb-2">输入 Magnet 链接</label>
          <div class="flex gap-3">
            <div class="flex-1 relative">
              <Link class="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" />
              <input
                v-model="magnetInput"
                type="text"
                placeholder="magnet:?xt=urn:btih:..."
                class="w-full pl-12 pr-4 py-3 bg-bg-900 border border-bg-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-neon-blue transition-colors font-mono text-sm"
                @keyup.enter="startDownload"
              />
            </div>
            <button class="btn-neon flex items-center gap-2" @click="startDownload">
              <Play class="w-5 h-5" />
              开始下载
            </button>
          </div>
          <div v-if="errorMessage" class="mt-2 flex items-center gap-2 text-neon-red text-sm">
            <AlertTriangle class="w-4 h-4" />
            {{ errorMessage }}
          </div>
        </div>

        <div class="flex items-center gap-4">
          <div class="text-sm text-gray-500">或上传 .torrent 文件：</div>
          <label class="btn-outline cursor-pointer">
            <input type="file" accept=".torrent" class="hidden" @change="handleTorrentFile" />
            选择文件
          </label>
          <div v-if="!isClientReady" class="flex items-center gap-2 text-sm text-yellow-400">
            <AlertTriangle class="w-4 h-4" />
            WebTorrent 客户端初始化中...
          </div>
        </div>
      </div>
    </div>

    <div v-if="downloadsList.length > 0">
      <div v-for="dl in downloadsList" :key="dl.info_hash" class="glass-card p-6 mb-6">
        <div class="flex items-start justify-between mb-4">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-neon-purple/20 to-neon-blue/20 flex items-center justify-center">
              <Download class="w-6 h-6 text-neon-purple" />
            </div>
            <div>
              <div class="font-semibold text-white text-lg">{{ dl.file_name }}</div>
              <div class="flex items-center gap-2 text-sm" :class="getStatusColor(dl.status)">
                <span class="led-dot" :class="dl.status === 'downloading' || dl.status === 'seeding' ? 'online' : 'offline'"></span>
                {{ getStatusText(dl.status) }}
              </div>
            </div>
          </div>
          <button
            class="btn-outline"
            @click="stopDownload(dl.info_hash)"
          >
            <Pause class="w-5 h-5" />
          </button>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div class="p-3 bg-bg-900 rounded-lg">
            <div class="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <Download class="w-4 h-4 text-neon-blue" />
              下载速度
            </div>
            <div class="font-mono text-xl text-neon-blue">{{ formatSpeed(dl.download_speed) }}</div>
          </div>
          <div class="p-3 bg-bg-900 rounded-lg">
            <div class="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <Upload class="w-4 h-4 text-neon-purple" />
              上传速度
            </div>
            <div class="font-mono text-xl text-neon-purple">{{ formatSpeed(dl.upload_speed) }}</div>
          </div>
          <div class="p-3 bg-bg-900 rounded-lg">
            <div class="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <Users class="w-4 h-4 text-neon-green" />
              连接节点
            </div>
            <div class="font-mono text-xl text-neon-green">{{ dl.peers }}</div>
          </div>
          <div class="p-3 bg-bg-900 rounded-lg">
            <div class="flex items-center gap-2 text-gray-400 text-sm mb-1">
              <HardDrive class="w-4 h-4 text-yellow-400" />
              已下载
            </div>
            <div class="font-mono text-xl text-yellow-400">{{ formatBytes(dl.downloaded) }} / {{ formatBytes(dl.total_size) }}</div>
          </div>
        </div>

        <div class="mb-4">
          <div class="flex items-center justify-between text-sm text-gray-400 mb-2">
            <span>下载进度</span>
            <span>{{ (dl.progress * 100).toFixed(1) }}%</span>
          </div>
          <div class="h-3 bg-bg-900 rounded-full overflow-hidden">
            <div
              class="progress-bar h-full transition-all duration-500"
              :style="{ width: `${dl.progress * 100}%` }"
            ></div>
          </div>
        </div>

        <ChunkGrid :chunks="dl.chunks_status" />
      </div>

      <div v-if="historyForActive.length > 0" class="glass-card p-6">
        <SpeedChart :records="historyForActive" title="实时传输速度" />
      </div>

      <PeerHealthPanel v-if="downloadsList[0]?.info_hash?.length > 0 && !downloadsList[0]?.info_hash?.startsWith('magnet:')" :info-hash="downloadsList[0].info_hash" />
    </div>

    <div v-else class="glass-card p-12 text-center">
      <Download class="w-16 h-16 mx-auto mb-4 text-gray-500" />
      <p class="text-gray-400">暂无下载任务</p>
      <p class="text-sm text-gray-500 mt-1">输入 Magnet 链接或上传 torrent 文件开始P2P下载</p>
    </div>
  </div>
</template>
