<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { BarChart3, Download, Upload, Users, TrendingUp, Clock, Server, Flame, Globe } from 'lucide-vue-next'
import SpeedChart from '@/components/SpeedChart.vue'
import PeerHealthPanel from '@/components/PeerHealthPanel.vue'
import HeatmapView from '@/components/HeatmapView.vue'
import HotnessRanking from '@/components/HotnessRanking.vue'
import * as echarts from 'echarts'
import { fetchFiles } from '@/utils/api'
import type { FileInfo, SpeedRecord } from '@/types'
import { formatBytes, formatSpeed } from '@/utils/format'

const files = ref<FileInfo[]>([])
const selectedFileId = ref<string | null>(null)
const speedRecords = ref<SpeedRecord[]>([])
const peersChartRef = ref<HTMLDivElement | null>(null)
let peersChartInstance: echarts.ECharts | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null

const selectedFile = computed(() => {
  return files.value.find(f => f.file_id === selectedFileId.value) || null
})

const summary = computed(() => {
  if (speedRecords.value.length === 0) {
    return {
      total_download: 0,
      total_upload: 0,
      avg_download_speed: 0,
      avg_upload_speed: 0,
      peak_download_speed: 0,
      peak_upload_speed: 0,
      avg_peers: 0,
    }
  }

  const downloadSpeeds = speedRecords.value.map(r => r.download_speed)
  const uploadSpeeds = speedRecords.value.map(r => r.upload_speed)
  const peersList = speedRecords.value.map(r => r.peers_connected)

  return {
    total_download: downloadSpeeds.reduce((a, b) => a + b, 0) * (speedRecords.value.length > 1 ? 2 : 0),
    total_upload: uploadSpeeds.reduce((a, b) => a + b, 0) * (speedRecords.value.length > 1 ? 2 : 0),
    avg_download_speed: downloadSpeeds.reduce((a, b) => a + b, 0) / downloadSpeeds.length,
    avg_upload_speed: uploadSpeeds.reduce((a, b) => a + b, 0) / uploadSpeeds.length,
    peak_download_speed: Math.max(...downloadSpeeds),
    peak_upload_speed: Math.max(...uploadSpeeds),
    avg_peers: peersList.reduce((a, b) => a + b, 0) / peersList.length,
  }
})

const loadFiles = async () => {
  try {
    const data = await fetchFiles()
    files.value = data.files
    if (!selectedFileId.value && files.value.length > 0) {
      selectedFileId.value = files.value[0].file_id
    }
  } catch (err) {
    console.error('Load files failed:', err)
  }
}

const generateMockData = () => {
  const baseDownload = 2 + Math.random() * 3
  const baseUpload = 0.5 + Math.random() * 1
  const basePeers = selectedFile.value?.seeders || 3

  speedRecords.value.push({
    timestamp: Date.now(),
    download_speed: (baseDownload + Math.random() * 2 - 1) * 1024 * 1024,
    upload_speed: (baseUpload + Math.random() * 0.5 - 0.25) * 1024 * 1024,
    peers_connected: Math.max(0, Math.round(basePeers + Math.random() * 4 - 2)),
  })

  if (speedRecords.value.length > 60) {
    speedRecords.value.shift()
  }

  updatePeersChart()
}

const initPeersChart = () => {
  if (!peersChartRef.value) return
  peersChartInstance = echarts.init(peersChartRef.value, 'dark')
  updatePeersChart()
  window.addEventListener('resize', handleResize)
}

const handleResize = () => {
  peersChartInstance?.resize()
}

const updatePeersChart = () => {
  if (!peersChartInstance) return

  const times = speedRecords.value.map(r => {
    const date = new Date(r.timestamp)
    return date.toLocaleTimeString('zh-CN', { hour12: false })
  })
  const peers = speedRecords.value.map(r => r.peers_connected)

  const option: echarts.EChartsOption = {
    backgroundColor: 'transparent',
    title: {
      text: '连接节点数趋势',
      textStyle: { color: '#E2E8F0', fontSize: 14, fontWeight: 500 },
      left: 10,
      top: 10,
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(15, 30, 54, 0.95)',
      borderColor: 'rgba(124, 58, 237, 0.3)',
      textStyle: { color: '#E2E8F0' },
    },
    grid: { left: 60, right: 20, top: 60, bottom: 40 },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: times,
      axisLine: { lineStyle: { color: '#1E3560' } },
      axisLabel: { color: '#64748B', fontSize: 10 },
    },
    yAxis: {
      type: 'value',
      axisLine: { lineStyle: { color: '#1E3560' } },
      axisLabel: { color: '#64748B', fontSize: 10 },
      splitLine: { lineStyle: { color: 'rgba(30, 53, 96, 0.3)' } },
    },
    series: [
      {
        name: '连接节点',
        type: 'line',
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        data: peers,
        lineStyle: { color: '#00FFA3', width: 2 },
        itemStyle: { color: '#00FFA3' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(0, 255, 163, 0.3)' },
            { offset: 1, color: 'rgba(0, 255, 163, 0.02)' },
          ]),
        },
      },
    ],
    animationDuration: 500,
  }

  peersChartInstance.setOption(option)
}

onMounted(() => {
  loadFiles()
  initPeersChart()
  pollInterval = setInterval(() => {
    loadFiles()
    generateMockData()
  }, 2000)
})

onUnmounted(() => {
  if (pollInterval) clearInterval(pollInterval)
  window.removeEventListener('resize', handleResize)
  peersChartInstance?.dispose()
})
</script>

<template>
  <div class="p-8 space-y-8">
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-3xl font-bold text-white mb-2">数据统计</h1>
        <p class="text-gray-400">实时监控P2P传输速度、节点状态与资源热度分布</p>
      </div>
      <div class="flex items-center gap-2">
        <Globe class="w-5 h-5 text-neon-blue" />
        <span class="text-sm text-gray-400">全球节点监控</span>
      </div>
    </div>

    <div class="glass-card p-4">
      <div class="flex items-center gap-4 flex-wrap">
        <span class="text-sm text-gray-400">选择文件:</span>
        <select
          v-model="selectedFileId"
          class="px-4 py-2 bg-bg-900 border border-bg-600 rounded-lg text-white focus:outline-none focus:border-neon-blue"
        >
          <option v-for="file in files" :key="file.file_id" :value="file.file_id">
            {{ file.file_name }}
          </option>
        </select>
        <span v-if="selectedFile" class="text-sm text-gray-500">
          {{ formatBytes(selectedFile.total_size) }} · {{ selectedFile.seeders }} 个种子
        </span>
        <span v-if="selectedFile?.hotness_score && selectedFile.hotness_score > 0.3" class="flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-neon-red/20 text-neon-red">
          <Flame class="w-3 h-3" />
          热度 {{ (selectedFile.hotness_score * 100).toFixed(0) }}%
        </span>
      </div>
    </div>

    <HeatmapView height="500px" />

    <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div class="glass-card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-neon-blue/20 to-neon-blue/5 flex items-center justify-center">
            <Download class="w-6 h-6 text-neon-blue" />
          </div>
          <div>
            <div class="text-sm text-gray-400">总下载量</div>
            <div class="font-mono text-2xl font-bold text-neon-blue">{{ formatBytes(summary.total_download) }}</div>
          </div>
        </div>
        <div class="text-sm text-gray-500">
          峰值: {{ formatSpeed(summary.peak_download_speed) }}
        </div>
      </div>

      <div class="glass-card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-neon-purple/20 to-neon-purple/5 flex items-center justify-center">
            <Upload class="w-6 h-6 text-neon-purple" />
          </div>
          <div>
            <div class="text-sm text-gray-400">总上传量</div>
            <div class="font-mono text-2xl font-bold text-neon-purple">{{ formatBytes(summary.total_upload) }}</div>
          </div>
        </div>
        <div class="text-sm text-gray-500">
          峰值: {{ formatSpeed(summary.peak_upload_speed) }}
        </div>
      </div>

      <div class="glass-card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-neon-green/20 to-neon-green/5 flex items-center justify-center">
            <Users class="w-6 h-6 text-neon-green" />
          </div>
          <div>
            <div class="text-sm text-gray-400">平均连接节点</div>
            <div class="font-mono text-2xl font-bold text-neon-green">{{ summary.avg_peers.toFixed(1) }}</div>
          </div>
        </div>
        <div class="text-sm text-gray-500">
          当前: {{ selectedFile?.seeders || 0 }} 个种子
        </div>
      </div>

      <div class="glass-card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-yellow-400/20 to-yellow-400/5 flex items-center justify-center">
            <TrendingUp class="w-6 h-6 text-yellow-400" />
          </div>
          <div>
            <div class="text-sm text-gray-400">平均下载速度</div>
            <div class="font-mono text-2xl font-bold text-yellow-400">{{ formatSpeed(summary.avg_download_speed) }}</div>
          </div>
        </div>
      </div>

      <div class="glass-card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-pink-400/20 to-pink-400/5 flex items-center justify-center">
            <Server class="w-6 h-6 text-pink-400" />
          </div>
          <div>
            <div class="text-sm text-gray-400">平均上传速度</div>
            <div class="font-mono text-2xl font-bold text-pink-400">{{ formatSpeed(summary.avg_upload_speed) }}</div>
          </div>
        </div>
      </div>

      <div class="glass-card p-6">
        <div class="flex items-center gap-3 mb-4">
          <div class="w-12 h-12 rounded-lg bg-gradient-to-br from-cyan-400/20 to-cyan-400/5 flex items-center justify-center">
            <Clock class="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <div class="text-sm text-gray-400">监控时长</div>
            <div class="font-mono text-2xl font-bold text-cyan-400">{{ Math.floor(speedRecords.length * 2 / 60) }}分{{ (speedRecords.length * 2) % 60 }}秒</div>
          </div>
        </div>
        <div class="text-sm text-gray-500">
          数据点: {{ speedRecords.length }} 个
        </div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div class="glass-card p-6">
        <SpeedChart :records="speedRecords" title="下载/上传速度趋势" height="350px" />
      </div>
      <div class="glass-card p-6">
        <div
          ref="peersChartRef"
          class="w-full rounded-lg bg-bg-800/50 border border-bg-600"
          style="height: 350px;"
        ></div>
      </div>
    </div>

    <HotnessRanking />

    <PeerHealthPanel v-if="selectedFile?.info_hash" :info-hash="selectedFile.info_hash" />

    <div class="glass-card p-6">
      <div class="flex items-center gap-3 mb-6">
        <BarChart3 class="w-6 h-6 text-neon-blue" />
        <h3 class="text-lg font-semibold text-white">文件传输概览</h3>
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-400 border-b border-bg-600">
              <th class="pb-3 font-medium">文件名</th>
              <th class="pb-3 font-medium">大小</th>
              <th class="pb-3 font-medium">分块数</th>
              <th class="pb-3 font-medium">种子数</th>
              <th class="pb-3 font-medium">热度</th>
              <th class="pb-3 font-medium">副本</th>
              <th class="pb-3 font-medium">创建时间</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="file in files"
              :key="file.file_id"
              class="border-b border-bg-700/50 hover:bg-bg-700/30 transition-colors"
            >
              <td class="py-3 text-white font-medium">{{ file.file_name }}</td>
              <td class="py-3 font-mono text-gray-300">{{ formatBytes(file.total_size) }}</td>
              <td class="py-3 font-mono text-gray-300">{{ file.total_chunks }}</td>
              <td class="py-3">
                <span class="inline-flex items-center gap-1 text-neon-green">
                  <span class="led-dot online"></span>
                  {{ file.seeders }}
                </span>
              </td>
              <td class="py-3">
                <div class="flex items-center gap-2">
                  <div class="w-16 h-2 bg-bg-700 rounded-full overflow-hidden">
                    <div
                      class="h-full rounded-full transition-all"
                      :class="[
                        (file.hotness_score || 0) >= 0.8 ? 'bg-neon-red'
                        : (file.hotness_score || 0) >= 0.5 ? 'bg-neon-purple'
                        : (file.hotness_score || 0) >= 0.3 ? 'bg-neon-blue'
                        : 'bg-neon-green'
                      ]"
                      :style="{ width: `${(file.hotness_score || 0) * 100}%` }"
                    ></div>
                  </div>
                  <span class="font-mono text-xs" :class="[
                    (file.hotness_score || 0) >= 0.8 ? 'text-neon-red'
                    : (file.hotness_score || 0) >= 0.5 ? 'text-neon-purple'
                    : (file.hotness_score || 0) >= 0.3 ? 'text-neon-blue'
                    : 'text-neon-green'
                  ]">
                    {{ ((file.hotness_score || 0) * 100).toFixed(0) }}%
                  </span>
                </div>
              </td>
              <td class="py-3">
                <span class="font-mono text-neon-purple">{{ file.replicas_count || 0 }}/5</span>
              </td>
              <td class="py-3 text-gray-400">{{ new Date(file.created_at).toLocaleString('zh-CN') }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>
