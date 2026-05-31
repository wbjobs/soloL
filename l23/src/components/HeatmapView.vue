<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { MapPin, TrendingUp, AlertTriangle } from 'lucide-vue-next'
import type { HeatmapResponse, HeatmapPoint, EdgeNodeActivity } from '@/types'
import { fetchHeatmap } from '@/utils/api'
import { formatBytes, formatSpeed } from '@/utils/format'

const props = defineProps<{
  height?: string
}>()

const mapContainerRef = ref<HTMLDivElement | null>(null)
let mapInstance: any = null
let heatLayer: any = null
let markers: any[] = []
let pollTimer: ReturnType<typeof setInterval> | null = null

const heatmapData = ref<HeatmapResponse | null>(null)
const selectedNode = ref<EdgeNodeActivity | null>(null)
const errorMessage = ref<string | null>(null)

const initMap = () => {
  if (!mapContainerRef.value || !window.L) {
    errorMessage.value = 'Leaflet 地图库未加载'
    return
  }

  mapInstance = window.L.map(mapContainerRef.value, {
    center: [35.8617, 104.1954],
    zoom: 4,
    minZoom: 2,
    maxZoom: 12,
    zoomControl: false,
  })

  window.L.control.zoom({ position: 'topright' }).addTo(mapInstance)

  window.L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
      subdomains: 'abcd',
    }
  ).addTo(mapInstance)

  window.L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png',
    {
      opacity: 0.5,
      zIndex: 1,
      maxZoom: 19,
      subdomains: 'abcd',
    }
  ).addTo(mapInstance)
}

const updateHeatmap = (points: HeatmapPoint[]) => {
  if (!mapInstance || !window.L) return

  if (heatLayer) {
    mapInstance.removeLayer(heatLayer)
  }

  markers.forEach(m => mapInstance.removeLayer(m))
  markers = []

  const heatPoints: [number, number, number][] = points.map(p => [
    p.lat,
    p.lng,
    p.value,
  ])

  if (window.L.heatLayer) {
    heatLayer = window.L.heatLayer(heatPoints, {
      radius: 35,
      blur: 25,
      maxZoom: 10,
      gradient: {
        0.1: '#00D4FF',
        0.3: '#00FFA3',
        0.6: '#7C3AED',
        0.9: '#FF4757',
      },
    }).addTo(mapInstance)
  }

  points.forEach(point => {
    const intensityColor = point.value > 0.7 ? '#FF4757'
      : point.value > 0.4 ? '#7C3AED'
      : point.value > 0.2 ? '#00D4FF'
      : '#00FFA3'

    const markerIcon = window.L.divIcon({
      className: 'custom-pin',
      html: `
        <div style="
          width: 16px;
          height: 16px;
          background: ${intensityColor};
          border: 2px solid white;
          border-radius: 50%;
          box-shadow: 0 0 10px ${intensityColor};
          animation: pulse 2s infinite;
        "></div>
      `,
      iconSize: [16, 16],
      iconAnchor: [8, 8],
    })

    const marker = window.L.marker([point.lat, point.lng], { icon: markerIcon })
      .addTo(mapInstance)
      .on('click', () => {
        const node = heatmapData.value?.nodes.find(n => n.node_id === point.node_id)
        if (node) {
          selectedNode.value = node
        }
      })

    marker.bindPopup(`
      <div style="font-family: 'Noto Sans SC', sans-serif; min-width: 150px;">
        <div style="font-weight: 600; color: #0A1628; margin-bottom: 4px;">${point.city}</div>
        <div style="font-size: 12px; color: #64748B; margin-bottom: 4px;">活跃度: ${(point.activity_score * 100).toFixed(0)}%</div>
        <div style="font-size: 12px; color: #64748B;">容器: ${point.container_count} 个</div>
      </div>
    `, {
      className: 'custom-popup',
    })

    markers.push(marker)
  })
}

const loadHeatmapData = async () => {
  try {
    errorMessage.value = null
    heatmapData.value = await fetchHeatmap()
    updateHeatmap(heatmapData.value.points)
  } catch (err: any) {
    errorMessage.value = err.message || '加载热力图数据失败'
  }
}

onMounted(() => {
  initMap()
  loadHeatmapData()
  pollTimer = setInterval(loadHeatmapData, 10000)
})

onUnmounted(() => {
  if (pollTimer) clearInterval(pollTimer)
  if (mapInstance) {
    mapInstance.remove()
    mapInstance = null
  }
})
</script>

<template>
  <div class="glass-card p-6">
    <div class="flex items-center justify-between mb-4">
      <div class="flex items-center gap-3">
        <MapPin class="w-5 h-5 text-neon-blue" />
        <h3 class="text-lg font-semibold text-white">全球节点活跃度热力图</h3>
      </div>
      <div class="flex items-center gap-3 text-sm">
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full" style="background: #00FFA3;"></span>
          <span class="text-gray-400">低</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full" style="background: #00D4FF;"></span>
          <span class="text-gray-400">中</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full" style="background: #7C3AED;"></span>
          <span class="text-gray-400">高</span>
        </div>
        <div class="flex items-center gap-2">
          <span class="w-3 h-3 rounded-full" style="background: #FF4757;"></span>
          <span class="text-gray-400">极高</span>
        </div>
      </div>
    </div>

    <div v-if="errorMessage" class="mb-4 flex items-center gap-2 text-neon-red text-sm p-3 bg-neon-red/10 rounded-lg">
      <AlertTriangle class="w-4 h-4" />
      {{ errorMessage }}
    </div>

    <div
      ref="mapContainerRef"
      class="w-full rounded-lg border border-bg-600 overflow-hidden"
      :style="{ height: height || '450px' }"
    ></div>

    <div v-if="selectedNode" class="mt-4 p-4 bg-bg-900 rounded-lg">
      <div class="flex items-center justify-between mb-3">
        <div class="flex items-center gap-3">
          <div
            class="w-10 h-10 rounded-lg flex items-center justify-center"
            :class="[
              selectedNode.activity_score > 0.6 ? 'bg-neon-red/20'
              : selectedNode.activity_score > 0.3 ? 'bg-neon-purple/20'
              : 'bg-neon-blue/20'
            ]"
          >
            <TrendingUp
              class="w-5 h-5"
              :class="[
                selectedNode.activity_score > 0.6 ? 'text-neon-red'
                : selectedNode.activity_score > 0.3 ? 'text-neon-purple'
                : 'text-neon-blue'
              ]"
            />
          </div>
          <div>
            <div class="font-semibold text-white">{{ selectedNode.name }}</div>
            <div class="text-sm text-gray-400">{{ selectedNode.city }} · {{ selectedNode.region }}</div>
          </div>
        </div>
        <div
          class="px-3 py-1 rounded-full text-sm font-medium"
          :class="[
            selectedNode.status === 'online'
              ? 'bg-neon-green/20 text-neon-green'
              : 'bg-gray-500/20 text-gray-400'
          ]"
        >
          {{ selectedNode.status === 'online' ? '在线' : '离线' }}
        </div>
      </div>

      <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div class="p-2 bg-bg-800 rounded">
          <div class="text-xs text-gray-500">活跃度</div>
          <div class="font-mono text-lg text-white">{{ (selectedNode.activity_score * 100).toFixed(0) }}%</div>
        </div>
        <div class="p-2 bg-bg-800 rounded">
          <div class="text-xs text-gray-500">运行容器</div>
          <div class="font-mono text-lg text-neon-purple">{{ selectedNode.container_count }} 个</div>
        </div>
        <div class="p-2 bg-bg-800 rounded">
          <div class="text-xs text-gray-500">总上传量</div>
          <div class="font-mono text-lg text-neon-blue">{{ formatBytes(selectedNode.total_upload) }}</div>
        </div>
        <div class="p-2 bg-bg-800 rounded">
          <div class="text-xs text-gray-500">平均速度</div>
          <div class="font-mono text-lg text-neon-green">{{ formatSpeed(selectedNode.avg_upload_speed) }}</div>
        </div>
      </div>
    </div>

    <div v-else class="mt-4 text-center text-sm text-gray-500">
      点击地图上的节点查看详情
    </div>

    <div v-if="heatmapData" class="mt-4 pt-4 border-t border-bg-600">
      <div class="flex items-center justify-between text-sm text-gray-400">
        <span>共 {{ heatmapData.nodes.length }} 个边缘节点</span>
        <span>更新时间: {{ new Date(heatmapData.timestamp).toLocaleString('zh-CN') }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-popup .leaflet-popup-content-wrapper {
  background: rgba(15, 30, 54, 0.95);
  border: 1px solid rgba(0, 212, 255, 0.3);
  border-radius: 8px;
  color: white;
}

.custom-popup .leaflet-popup-tip {
  background: rgba(15, 30, 54, 0.95);
}

.custom-popup .leaflet-popup-content {
  margin: 12px;
}

@keyframes pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(1.1); }
}
</style>
