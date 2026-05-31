import { defineStore } from 'pinia'
import { ref } from 'vue'
import { graphApi, type GraphEntity, type GraphRelation } from '@/composables/useApi'

export const useGraphStore = defineStore('graph', () => {
  const nodes = ref<GraphEntity[]>([])
  const edges = ref<GraphRelation[]>([])
  const loading = ref(false)
  const selectedNode = ref<GraphEntity | null>(null)
  const highlightedNodes = ref<Set<string>>(new Set())
  const highlightedEdges = ref<Set<string>>(new Set())
  const stats = ref<Record<string, any>>({})

  async function fetchFullGraph(limit = 200) {
    loading.value = true
    try {
      const res: any = await graphApi.getFull(limit)
      nodes.value = res.nodes || []
      edges.value = res.edges || []
      stats.value = res.stats || {}
    } catch (e) {
      console.error('获取知识图谱失败:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchCaseGraph(caseId: string) {
    loading.value = true
    try {
      const res: any = await graphApi.getCaseGraph(caseId)
      nodes.value = res.nodes || []
      edges.value = res.edges || []
    } catch (e) {
      console.error('获取案件图谱失败:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchStats() {
    try {
      const res: any = await graphApi.getStats()
      stats.value = res
    } catch (e) {
      console.error('获取统计信息失败:', e)
    }
  }

  function selectNode(node: GraphEntity | null) {
    selectedNode.value = node
    if (node) {
      const connectedEdgeIds = edges.value
        .filter(e => e.source === node.id || e.target === node.id)
        .map(e => e.id)
      highlightedNodes.value = new Set([node.id])
      highlightedEdges.value = new Set(connectedEdgeIds)
    } else {
      highlightedNodes.value.clear()
      highlightedEdges.value.clear()
    }
  }

  function highlightPath(nodeIds: string[]) {
    highlightedNodes.value = new Set(nodeIds)
    const pathEdgeIds = edges.value
      .filter(e => nodeIds.includes(e.source) && nodeIds.includes(e.target))
      .map(e => e.id)
    highlightedEdges.value = new Set(pathEdgeIds)
  }

  function clearHighlight() {
    selectedNode.value = null
    highlightedNodes.value.clear()
    highlightedEdges.value.clear()
  }

  return {
    nodes,
    edges,
    loading,
    selectedNode,
    highlightedNodes,
    highlightedEdges,
    stats,
    fetchFullGraph,
    fetchCaseGraph,
    fetchStats,
    selectNode,
    highlightPath,
    clearHighlight,
  }
})
