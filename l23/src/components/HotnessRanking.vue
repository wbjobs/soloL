<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'
import { Flame, TrendingUp, TrendingDown, Copy, Plus, X, Loader2 } from 'lucide-vue-next'
import type { HotnessInfo, SeederContainer } from '@/types'
import { fetchHotFiles, fetchReplicas, createReplicas, removeReplica } from '@/utils/api'
import { formatBytes, copyToClipboard } from '@/utils/format'

const hotFiles = ref<HotnessInfo[]>([])
const replicas = ref<SeederContainer[]>([])
const threshold = ref(100)
const autoReplicationEnabled = ref(true)
const totalReplicas = ref(0)
const copiedFileId = ref<string | null>(null)
const creatingReplicas = ref<Set<string>>(new Set())
const removingContainer = ref<Set<string>>(new Set())

let pollTimer: ReturnType<typeof setInterval> | null = null

const sortedHotFiles = computed(() => {
  return [...hotFiles.value].sort((a, b) => b.hotness_score - a.hotness_score)
})

const loadData = async () => {
  try {
    const [hotData, replicaData] = await Promise.all([
      fetchHotFiles(),
      fetchReplicas(),
    ])
    hotFiles.value = hotData.hot_files || []
    threshold.value = hotData.threshold || 100
    autoReplicationEnabled.value = hotData.auto_replication_enabled
    totalReplicas.value = hotData.total_replicas || replicaData.length
    replicas.value = replicaData || []
  } catch (err) {
    console.error('Load hotness data failed:', err)
  }
}

const handleCreateReplica = async (file: HotnessInfo) => {
  if (creatingReplicas.value.has(file.file_id)) return
  creatingReplicas.value.add(file.file_id)
  try {
    await createReplicas(file.file_id, 1)
    await loadData()
  } catch (err) {
    console.error('Create replica failed:', err)
  } finally {
    creatingReplicas.value.delete(file.file_id)
  }
}

const handleRemoveReplica = async (containerId: string) => {
  if (removingContainer.value.has(containerId)) return
  removingContainer.value.add(containerId)
  try {
    await removeReplica(containerId)
    await loadData()
  } catch (err) {
    console.error('Remove replica failed:', err)
  } finally {
    removingContainer.value.delete(containerId)
  }
}

const copyMagnet = async (file: HotnessInfo) => {
  try {
    const magnet = `magnet:?xt=urn:btih:${file.info_hash}`
    await copyToClipboard(magnet)
    copiedFileId.value = file.file_id
    setTimeout(() => {
      copiedFileId.value = null
    }, 2000)
  } catch (err) {
    console.error('Copy failed:', err)
  }
}

const getHotnessColor = (score: number) => {
  if (score >= 0.8) return 'text-neon-red'
  if (score >= 0.5) return 'text-neon-purple'
  if (score >= 0.3) return 'text-neon-blue'
  return 'text-neon-green'
}

const getHotnessBg = (score: number) => {
  if (score >= 0.8) return 'bg-neon-red/20'
  if (score >= 0.5) return 'bg-neon-purple/20'
  if (score >= 0.3) return 'bg-neon-blue/20'
  return 'bg-neon-green/20'
}

onMounted(() => {
  loadData()
  pollTimer = setInterval(loadData, 5000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <div class="space-y-6">
    <div class="glass-card p-6">
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-3">
          <Flame class="w-6 h-6 text-neon-red" />
          <div>
            <h3 class="text-lg font-semibold text-white">热门资源排行</h3>
            <p class="text-sm text-gray-400">热度阈值: {{ threshold }} 次/分钟 · 自动复制: {{ autoReplicationEnabled ? '开启' : '关闭' }}</p>
          </div>
        </div>
        <div class="text-sm text-gray-400">
          当前活跃副本: <span class="font-mono text-neon-purple">{{ totalReplicas }}</span> 个
        </div>
      </div>

      <div v-if="sortedHotFiles.length === 0" class="text-center py-8 text-gray-500">
        <Flame class="w-12 h-12 mx-auto mb-3 opacity-30" />
        <p>暂无热门资源</p>
        <p class="text-sm mt-1">当资源下载热度超过阈值时会自动显示</p>
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="(file, idx) in sortedHotFiles"
          :key="file.file_id"
          class="p-4 bg-bg-900 rounded-lg border border-bg-600 hover:border-neon-blue/30 transition-all"
        >
          <div class="flex items-center gap-4">
            <div
              class="w-10 h-10 rounded-lg flex items-center justify-center font-bold text-lg"
              :class="getHotnessBg(file.hotness_score)"
            >
              {{ idx + 1 }}
            </div>

            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-3">
                <span class="font-medium text-white truncate">{{ file.file_name }}</span>
                <span
                  v-if="file.is_hot"
                  class="px-2 py-0.5 rounded-full text-xs font-medium bg-neon-red/20 text-neon-red flex items-center gap-1"
                >
                  <Flame class="w-3 h-3" />
                  HOT
                </span>
                <span
                  v-if="file.trending_up"
                  class="text-neon-green flex items-center gap-1 text-xs"
                >
                  <TrendingUp class="w-3 h-3" />
                  上升
                </span>
                <span
                  v-else
                  class="text-gray-400 flex items-center gap-1 text-xs"
                >
                  <TrendingDown class="w-3 h-3" />
                  下降
                </span>
              </div>

              <div class="flex items-center gap-4 mt-1 text-sm text-gray-400">
                <span class="flex items-center gap-1">
                  <span :class="getHotnessColor(file.hotness_score)" class="font-mono font-medium">
                    {{ file.download_count_last_minute }}
                  </span>
                  次/分钟
                </span>
                <span>热度分: <span class="font-mono" :class="getHotnessColor(file.hotness_score)">{{ file.hotness_score.toFixed(2) }}</span></span>
                <span>副本: <span class="font-mono text-neon-purple">{{ file.replicas }}/{{ file.max_replicas }}</span></span>
              </div>
            </div>

            <div class="flex items-center gap-2">
              <button
                class="btn-outline text-sm py-1.5 px-3 flex items-center gap-1"
                @click="copyMagnet(file)"
              >
                <component :is="copiedFileId === file.file_id ? X : Copy" class="w-4 h-4" />
                {{ copiedFileId === file.file_id ? '已复制' : 'Magnet' }}
              </button>
              <button
                v-if="file.replicas < file.max_replicas"
                class="btn-neon text-sm py-1.5 px-3 flex items-center gap-1"
                :disabled="creatingReplicas.has(file.file_id)"
                @click="handleCreateReplica(file)"
              >
                <Loader2 v-if="creatingReplicas.has(file.file_id)" class="w-4 h-4 animate-spin" />
                <Plus v-else class="w-4 h-4" />
                创建副本
              </button>
            </div>
          </div>

          <div v-if="file.info_hash" class="mt-3 p-2 bg-bg-800 rounded">
            <div class="flex items-center justify-between text-xs">
              <span class="text-gray-500">Info Hash:</span>
              <code class="text-neon-blue font-mono">{{ file.info_hash }}</code>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div class="glass-card p-6">
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-lg font-semibold text-white">活跃副本列表</h3>
        <span class="text-sm text-gray-400">共 {{ replicas.length }} 个容器</span>
      </div>

      <div v-if="replicas.length === 0" class="text-center py-6 text-gray-500 text-sm">
        暂无活跃副本
      </div>

      <div v-else class="grid gap-3 max-h-80 overflow-y-auto pr-2">
        <div
          v-for="replica in replicas"
          :key="replica.container_id"
          class="flex items-center justify-between p-3 bg-bg-900 rounded-lg"
        >
          <div class="flex items-center gap-3">
            <div class="w-8 h-8 rounded bg-neon-purple/20 flex items-center justify-center">
              <Flame class="w-4 h-4 text-neon-purple" />
            </div>
            <div>
              <div class="text-sm font-medium text-white">{{ replica.file_name }}</div>
              <div class="text-xs text-gray-500">
                节点: {{ replica.node_id }} · 端口: {{ replica.port }} · {{ new Date(replica.created_at).toLocaleString('zh-CN') }}
              </div>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="px-2 py-0.5 rounded-full text-xs"
              :class="replica.status === 'running' ? 'bg-neon-green/20 text-neon-green' : 'bg-yellow-500/20 text-yellow-400'"
            >
              {{ replica.status }}
            </span>
            <button
              class="p-1.5 rounded-lg text-gray-400 hover:text-neon-red hover:bg-neon-red/10 transition-colors"
              :disabled="removingContainer.has(replica.container_id)"
              @click="handleRemoveReplica(replica.container_id)"
            >
              <Loader2 v-if="removingContainer.has(replica.container_id)" class="w-4 h-4 animate-spin" />
              <X v-else class="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
