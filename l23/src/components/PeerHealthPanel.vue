<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { Activity, Wifi, WifiOff, Upload, Clock, Server } from 'lucide-vue-next'
import type { PeerHealthInfo } from '@/types'
import { fetchPeerHealth } from '@/utils/api'
import { formatSpeed } from '@/utils/format'

const props = defineProps<{
  infoHash: string
}>()

const peers = ref<PeerHealthInfo[]>([])
const totalPeers = ref(0)
const alivePeers = ref(0)
const deadPeers = ref(0)
let pollTimer: ReturnType<typeof setInterval> | null = null

const loadHealth = async () => {
  if (!props.infoHash) return
  try {
    const data = await fetchPeerHealth(props.infoHash)
    peers.value = data.peers
    totalPeers.value = data.total_peers
    alivePeers.value = data.alive_peers
    deadPeers.value = data.dead_peers
  } catch {
    // silently ignore
  }
}

onMounted(() => {
  loadHealth()
  pollTimer = setInterval(loadHealth, 10000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
})

watch(() => props.infoHash, () => {
  loadHealth()
})
</script>

<template>
  <div class="glass-card p-6">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <Activity class="w-5 h-5 text-neon-blue" />
        <h3 class="text-lg font-semibold text-white">节点健康状态</h3>
      </div>
      <div class="flex items-center gap-4 text-sm">
        <span class="flex items-center gap-1 text-neon-green">
          <Wifi class="w-4 h-4" />
          {{ alivePeers }} 存活
        </span>
        <span class="flex items-center gap-1 text-neon-red">
          <WifiOff class="w-4 h-4" />
          {{ deadPeers }} 失联
        </span>
        <span class="text-gray-400">共 {{ totalPeers }} 个</span>
      </div>
    </div>

    <div v-if="peers.length === 0" class="text-center py-6 text-gray-500 text-sm">
      暂无节点信息
    </div>

    <div v-else class="space-y-2 max-h-80 overflow-y-auto pr-2">
      <div
        v-for="(peer, idx) in peers"
        :key="peer.peer_id"
        class="flex items-center justify-between p-3 rounded-lg transition-all"
        :class="[
          idx < 5 ? 'bg-neon-blue/5 border border-neon-blue/20' : 'bg-bg-900/50 border border-bg-600',
          peer.alive ? '' : 'opacity-60'
        ]"
      >
        <div class="flex items-center gap-3">
          <span class="led-dot" :class="peer.alive ? 'online' : 'offline'"></span>
          <div>
            <div class="flex items-center gap-2">
              <span class="text-sm font-mono text-white">{{ peer.ip }}:{{ peer.port }}</span>
              <span
                v-if="idx < 5"
                class="text-xs px-2 py-0.5 rounded-full bg-neon-blue/20 text-neon-blue"
              >
                TOP {{ idx + 1 }}
              </span>
            </div>
            <div class="flex items-center gap-3 text-xs text-gray-500 mt-1">
              <span class="flex items-center gap-1" :title="'失败次数: ' + peer.fail_count + '/3'">
                <Clock class="w-3 h-3" />
                {{ peer.fail_count > 0 ? `失败 ${peer.fail_count}/3` : '健康' }}
              </span>
              <span v-if="peer.last_ping" class="flex items-center gap-1">
                <Server class="w-3 h-3" />
                Ping: {{ new Date(peer.last_ping).toLocaleTimeString('zh-CN') }}
              </span>
            </div>
          </div>
        </div>
        <div class="text-right">
          <div class="flex items-center gap-1 text-sm">
            <Upload class="w-3.5 h-3.5" :class="peer.upload_speed > 0 ? 'text-neon-purple' : 'text-gray-600'" />
            <span class="font-mono" :class="peer.upload_speed > 0 ? 'text-neon-purple' : 'text-gray-600'">
              {{ formatSpeed(peer.upload_speed) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-4 p-3 bg-bg-900 rounded-lg text-xs text-gray-500">
      <div class="flex items-center gap-2 mb-1">
        <Activity class="w-3 h-3 text-neon-blue" />
        健康检查机制：每30秒Ping一次，连续3次失败自动移除
      </div>
      <div class="flex items-center gap-2">
        <Upload class="w-3 h-3 text-neon-purple" />
        节点选择策略：优先返回上传速度最快的5个节点（TOP标记）
      </div>
    </div>
  </div>
</template>
