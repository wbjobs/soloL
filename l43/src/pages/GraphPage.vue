<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useGraphStore } from '@/stores/graph'
import { Network } from 'vis-network/standalone'
import {
  Search, ZoomIn, ZoomOut, Maximize2, RefreshCw,
  Network as NetworkIcon, X, Info, Link2, ChevronRight
} from 'lucide-vue-next'

const graphStore = useGraphStore()

const containerRef = ref<HTMLDivElement | null>(null)
let network: any = null
let isStabilized = false

const searchQuery = ref('')
const currentLayout = ref<'barnesHut' | 'hierarchical'>('barnesHut')
const virtualScrollEnabled = ref(false)
const visibleNodeRange = ref({ start: 0, end: 200 })
const showLabels = ref(true)

const nodeCountThreshold = 200

const needsOptimization = computed(() => graphStore.nodes.length > nodeCountThreshold)

const nodeTypeColors: Record<string, string> = {
  law: '#2563eb',
  case: '#059669',
  circumstance: '#d97706',
  person: '#7c3aed',
}

const nodeTypeLabels: Record<string, string> = {
  law: '法条',
  case: '案件',
  circumstance: '情节',
  person: '人物',
}

const edgeTypeStyles: Record<string, { dashes?: boolean | number[]; color: string; width?: number }> = {
  APPLIES: { dashes: false, color: '#6b7280', width: 1 },
  CONFLICTS: { dashes: [8, 4], color: '#dc2626', width: 2 },
  EXCEPTION: { dashes: [3, 3], color: '#ea580c', width: 1.5 },
}

const edgeTypeLabels: Record<string, string> = {
  APPLIES: '适用',
  CONFLICTS: '冲突',
  EXCEPTION: '例外',
}

function buildVisNodes() {
  let nodes = [...graphStore.nodes]

  if (virtualScrollEnabled.value && needsOptimization.value) {
    nodes = nodes.slice(visibleNodeRange.value.start, visibleNodeRange.value.end)
  }

  return nodes.map(node => {
    const isHighlighted = graphStore.highlightedNodes.has(node.id)
    const isSelected = graphStore.selectedNode?.id === node.id
    const baseColor = nodeTypeColors[node.type] || '#6b7280'
    const displayLabel = showLabels.value || isHighlighted || isSelected ? node.label : ''

    return {
      id: node.id,
      label: displayLabel,
      color: {
        background: isHighlighted || isSelected ? baseColor : `${baseColor}33`,
        border: baseColor,
        highlight: { background: baseColor, border: baseColor },
        hover: { background: `${baseColor}cc`, border: baseColor },
      },
      font: {
        color: isHighlighted || isSelected ? '#ffffff' : '#1e293b',
        size: 12,
        face: 'Noto Sans SC, sans-serif',
      },
      borderWidth: isSelected ? 3 : 1.5,
      shape: node.type === 'law' ? 'box' : node.type === 'case' ? 'diamond' : 'dot',
      size: node.type === 'law' ? 25 : node.type === 'case' ? 20 : 15,
      title: `${nodeTypeLabels[node.type] || node.type}: ${node.label}`,
      physics: !isStabilized,
    }
  })
}

function buildVisEdges() {
  return graphStore.edges.map(edge => {
    const isHighlighted = graphStore.highlightedEdges.has(edge.id)
    const style = edgeTypeStyles[edge.type] || { dashes: false, color: '#9ca3af', width: 1 }

    return {
      id: edge.id,
      from: edge.source,
      to: edge.target,
      label: edgeTypeLabels[edge.type] || edge.type,
      dashes: style.dashes,
      color: {
        color: isHighlighted ? style.color : `${style.color}88`,
        highlight: style.color,
        hover: style.color,
      },
      width: isHighlighted ? (style.width || 1) + 1.5 : style.width || 1,
      font: {
        size: 10,
        color: '#64748b',
        face: 'Noto Sans SC, sans-serif',
        strokeWidth: 3,
        strokeColor: '#ffffff',
      },
      arrows: 'to',
      smooth: { enabled: true, type: 'curvedCW', roundness: 0.2 },
    }
  })
}

function getNetworkOptions() {
  const nodeCount = graphStore.nodes.length
  const optimize = nodeCount > nodeCountThreshold

  const stabilizationIterations = optimize ? 50 : 150
  const gravitationalConstant = optimize ? -1500 : -3000
  const springLength = optimize ? 200 : 120
  const damping = optimize ? 0.15 : 0.09
  const hideEdgesOnDrag = optimize
  const hideEdgesOnZoom = optimize

  const base: any = {
    nodes: {
      chosen: true,
    },
    edges: {
      chosen: true,
      smooth: { enabled: !optimize, type: 'curvedCW', roundness: 0.2 },
      hideEdgesOnDrag,
      hideEdgesOnZoom,
    },
    interaction: {
      hover: true,
      tooltipDelay: 200,
      dragNodes: true,
      dragView: true,
      zoomView: true,
      navigationButtons: false,
    },
    physics: {
      enabled: true,
      barnesHut: {
        gravitationalConstant,
        centralGravity: 0.3,
        springLength,
        springConstant: 0.04,
        damping,
      },
      stabilization: {
        iterations: stabilizationIterations,
      },
    },
  }

  if (currentLayout.value === 'hierarchical') {
    base.layout = {
      hierarchical: {
        enabled: true,
        direction: 'UD',
        sortMethod: 'directed',
        levelSeparation: 150,
        nodeSpacing: 100,
        blockShifting: true,
        edgeMinimization: true,
      },
    }
    base.physics.enabled = false
  }

  return base
}

function initNetwork() {
  if (!containerRef.value) return

  const visNodes = buildVisNodes()
  const visEdges = buildVisEdges()
  const options = getNetworkOptions()

  network = new Network(containerRef.value, { nodes: visNodes, edges: visEdges }, options)

  network.on('stabilizationIterationsDone', () => {
    isStabilized = true
    if (needsOptimization.value) {
      updateNetworkData()
    }
  })

  network.on('click', (params: any) => {
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0]
      const node = graphStore.nodes.find(n => n.id === nodeId)
      if (node) {
        graphStore.selectNode(node)
      }
    } else {
      graphStore.selectNode(null)
    }
  })

  network.on('doubleClick', (params: any) => {
    if (params.nodes.length > 0) {
      const nodeId = params.nodes[0]
      network.focus(nodeId, { scale: 1.5, animation: { duration: 500, easingFunction: 'easeInOutQuad' } })
    }
  })
}

function toggleLabels() {
  showLabels.value = !showLabels.value
  updateNetworkData()
}

function toggleVirtualScroll() {
  virtualScrollEnabled.value = !virtualScrollEnabled.value
  if (virtualScrollEnabled.value) {
    visibleNodeRange.value = { start: 0, end: nodeCountThreshold }
  }
  updateNetworkData()
}

function loadMoreNodes() {
  const newEnd = Math.min(visibleNodeRange.value.end + 100, graphStore.nodes.length)
  visibleNodeRange.value.end = newEnd
  updateNetworkData()
}

function updateNetworkData() {
  if (!network) return

  const visNodes = buildVisNodes()
  const visEdges = buildVisEdges()

  network.setData({ nodes: visNodes, edges: visEdges })
}

function handleSearch() {
  if (!searchQuery.value.trim() || !network) return

  const query = searchQuery.value.trim().toLowerCase()
  const matchedNodes = graphStore.nodes.filter(
    n => n.label.toLowerCase().includes(query) || n.type.toLowerCase().includes(query)
  )

  if (matchedNodes.length > 0) {
    const matchedIds = matchedNodes.map(n => n.id)
    graphStore.highlightPath(matchedIds)

    network.focus(matchedIds[0], {
      scale: 1.2,
      animation: { duration: 500, easingFunction: 'easeInOutQuad' },
    })
  }
}

function clearSearch() {
  searchQuery.value = ''
  graphStore.clearHighlight()
  if (network) {
    network.fit({ animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
  }
}

function handleZoomIn() {
  if (network) {
    const scale = network.getScale()
    network.moveTo({ scale: scale * 1.3, animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
  }
}

function handleZoomOut() {
  if (network) {
    const scale = network.getScale()
    network.moveTo({ scale: scale / 1.3, animation: { duration: 300, easingFunction: 'easeInOutQuad' } })
  }
}

function handleFitView() {
  if (network) {
    network.fit({ animation: { duration: 500, easingFunction: 'easeInOutQuad' } })
  }
}

function switchLayout(layout: 'barnesHut' | 'hierarchical') {
  currentLayout.value = layout
  if (network) {
    network.setOptions(getNetworkOptions())
    if (layout === 'barnesHut') {
      network.stabilize(150)
    }
  }
}

async function handleRefresh() {
  await graphStore.fetchFullGraph()
  await nextTick()
  updateNetworkData()
  handleFitView()
}

const connectedEdges = ref<any[]>([])

watch(() => graphStore.selectedNode, (node) => {
  if (node) {
    connectedEdges.value = graphStore.edges.filter(
      e => e.source === node.id || e.target === node.id
    )
    updateNetworkData()
  } else {
    connectedEdges.value = []
    updateNetworkData()
  }
})

watch(() => [graphStore.highlightedNodes, graphStore.highlightedEdges], () => {
  updateNetworkData()
}, { deep: true })

onMounted(async () => {
  if (graphStore.nodes.length === 0) {
    await graphStore.fetchFullGraph()
  }
  await nextTick()
  initNetwork()
})

onUnmounted(() => {
  if (network) {
    network.destroy()
    network = null
  }
})
</script>

<template>
  <div class="flex flex-col h-full gap-3">
    <div class="flex items-center gap-3 px-1">
      <div class="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1 shadow-sm">
        <button
          @click="switchLayout('barnesHut')"
          class="px-3 py-1.5 text-xs rounded-md transition-colors"
          :class="currentLayout === 'barnesHut' ? 'bg-blue-900 text-white' : 'text-gray-600 hover:bg-gray-100'"
        >
          力导向
        </button>
        <button
          @click="switchLayout('hierarchical')"
          class="px-3 py-1.5 text-xs rounded-md transition-colors"
          :class="currentLayout === 'hierarchical' ? 'bg-blue-900 text-white' : 'text-gray-600 hover:bg-gray-100'"
        >
          层次布局
        </button>
      </div>

      <div class="flex items-center gap-2 flex-1 max-w-md">
        <div class="relative flex-1">
          <Search class="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="搜索节点..."
            class="w-full pl-8 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            @keyup.enter="handleSearch"
          />
          <button
            v-if="searchQuery"
            @click="clearSearch"
            class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
          >
            <X class="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div class="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1 shadow-sm">
        <button @click="handleZoomIn" class="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="放大">
          <ZoomIn class="w-4 h-4" />
        </button>
        <button @click="handleZoomOut" class="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="缩小">
          <ZoomOut class="w-4 h-4" />
        </button>
        <button @click="handleFitView" class="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="适应视图">
          <Maximize2 class="w-4 h-4" />
        </button>
        <button @click="toggleLabels" class="p-1.5 rounded transition-colors"
          :class="showLabels ? 'bg-blue-900 text-white' : 'text-gray-600 hover:bg-gray-100'"
          :title="showLabels ? '隐藏标签' : '显示标签'">
          <span class="text-xs font-medium">A</span>
        </button>
        <button
          v-if="needsOptimization"
          @click="toggleVirtualScroll"
          class="p-1.5 rounded transition-colors"
          :class="virtualScrollEnabled ? 'bg-amber-600 text-white' : 'text-gray-600 hover:bg-gray-100'"
          :title="virtualScrollEnabled ? '关闭虚拟滚动' : '启用虚拟滚动'"
        >
          <span class="text-xs font-medium">虚拟</span>
        </button>
        <div class="w-px h-4 bg-gray-200 mx-0.5" />
        <button @click="handleRefresh" class="p-1.5 text-gray-600 hover:bg-gray-100 rounded" title="刷新">
          <RefreshCw class="w-4 h-4" />
        </button>
      </div>

      <div class="flex items-center gap-3 ml-auto text-xs text-gray-500">
        <div class="flex items-center gap-1">
          <span class="w-2.5 h-2.5 rounded-sm bg-blue-600" /> 法条
        </div>
        <div class="flex items-center gap-1">
          <span class="w-2.5 h-2.5 rounded-full bg-green-600" /> 案件
        </div>
        <div class="flex items-center gap-1">
          <span class="w-2.5 h-2.5 rounded-full bg-amber-600" /> 情节
        </div>
        <div class="flex items-center gap-1">
          <span class="w-2.5 h-2.5 rounded-full bg-purple-600" /> 人物
        </div>
        <div class="w-px h-4 bg-gray-200" />
        <div class="flex items-center gap-1">
          <span class="w-5 h-0.5 bg-gray-400" /> 适用
        </div>
        <div class="flex items-center gap-1">
          <span class="w-5 h-0.5 border-t-2 border-dashed border-red-600" /> 冲突
        </div>
        <div class="flex items-center gap-1">
          <span class="w-5 h-0.5 border-t-2 border-dotted border-orange-600" /> 例外
        </div>
      </div>
    </div>

    <div class="flex flex-1 gap-3 min-h-0">
      <div
        ref="containerRef"
        class="flex-1 bg-white rounded-lg border border-gray-200 shadow-sm relative"
        :class="{ 'opacity-60': graphStore.loading }"
      >
        <div
          v-if="virtualScrollEnabled && visibleNodeRange.end < graphStore.nodes.length"
          class="absolute bottom-4 left-1/2 -translate-x-1/2 z-10"
        >
          <button
            @click="loadMoreNodes"
            class="px-3 py-1.5 bg-blue-900 text-white text-xs rounded-lg shadow-lg hover:bg-blue-800 transition-colors"
          >
            加载更多节点 ({{ visibleNodeRange.end }}/{{ graphStore.nodes.length }})
          </button>
        </div>

        <div
          v-if="needsOptimization && !isStabilized"
          class="absolute top-3 left-3 px-2 py-1 bg-amber-50 text-amber-700 text-xs rounded border border-amber-200 z-10"
        >
          图谱节点较多，正在优化布局...
        </div>
      </div>

      <div class="w-72 flex-shrink-0 bg-white rounded-lg border border-gray-200 shadow-sm overflow-y-auto">
        <div v-if="!graphStore.selectedNode" class="flex flex-col items-center justify-center h-full text-gray-400 p-6">
          <NetworkIcon class="w-12 h-12 mb-3 opacity-50" />
          <p class="text-sm text-center">点击节点查看详细信息</p>
          <p class="text-xs text-center mt-1">共 {{ graphStore.nodes.length }} 个节点，{{ graphStore.edges.length }} 条关系</p>
        </div>

        <div v-else class="p-4">
          <div class="flex items-center justify-between mb-4">
            <h3 class="font-serif text-sm font-semibold text-gray-800 truncate">
              {{ graphStore.selectedNode.label }}
            </h3>
            <button
              @click="graphStore.selectNode(null)"
              class="text-gray-400 hover:text-gray-600 p-0.5"
            >
              <X class="w-4 h-4" />
            </button>
          </div>

          <div class="mb-4">
            <span
              class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
              :class="{
                'badge-law': graphStore.selectedNode.type === 'law',
                'badge-case': graphStore.selectedNode.type === 'case',
                'badge-circumstance': graphStore.selectedNode.type === 'circumstance',
                'badge-person': graphStore.selectedNode.type === 'person',
              }"
            >
              {{ nodeTypeLabels[graphStore.selectedNode.type] || graphStore.selectedNode.type }}
            </span>
          </div>

          <div v-if="Object.keys(graphStore.selectedNode.properties).length > 0" class="mb-4">
            <div class="flex items-center gap-1.5 mb-2">
              <Info class="w-3.5 h-3.5 text-gray-500" />
              <span class="text-xs font-medium text-gray-600">属性信息</span>
            </div>
            <div class="space-y-1.5">
              <div
                v-for="(value, key) in graphStore.selectedNode.properties"
                :key="key"
                class="flex text-xs"
              >
                <span class="text-gray-500 w-20 flex-shrink-0">{{ key }}</span>
                <span class="text-gray-800 break-all">{{ value }}</span>
              </div>
            </div>
          </div>

          <div>
            <div class="flex items-center gap-1.5 mb-2">
              <Link2 class="w-3.5 h-3.5 text-gray-500" />
              <span class="text-xs font-medium text-gray-600">关联关系 ({{ connectedEdges.length }})</span>
            </div>
            <div class="space-y-1.5">
              <div
                v-for="edge in connectedEdges"
                :key="edge.id"
                class="flex items-center gap-1.5 p-2 rounded-md bg-gray-50 hover:bg-gray-100 cursor-pointer text-xs transition-colors"
                @click="() => {
                  const targetId = edge.source === graphStore.selectedNode!.id ? edge.target : edge.source
                  const targetNode = graphStore.nodes.find(n => n.id === targetId)
                  if (targetNode) graphStore.selectNode(targetNode)
                }"
              >
                <span
                  class="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  :style="{ backgroundColor: edgeTypeStyles[edge.type]?.color || '#9ca3af' }"
                />
                <span class="text-gray-500">{{ edgeTypeLabels[edge.type] || edge.type }}</span>
                <ChevronRight class="w-3 h-3 text-gray-400" />
                <span class="text-gray-700 truncate">
                  {{ edge.source === graphStore.selectedNode.id ? edge.target : edge.source }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
