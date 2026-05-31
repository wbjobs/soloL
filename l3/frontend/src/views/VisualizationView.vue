<template>
  <div class="visualization-view">
    <div class="content-wrapper">
      <div class="section-title">
        <el-icon :size="28" color="#409eff"><Cpu /></el-icon>
        <h2>3D序列比对可视化</h2>
        <el-select
          v-model="selectedTaskId"
          placeholder="选择比对任务"
          style="width: 300px; margin-left: auto;"
          @change="loadResult"
          clearable
        >
          <el-option
            v-for="task in tasks"
            :key="task.task_id"
            :label="`${task.task_id.slice(0, 8)}... - ${task.identity_percentage.toFixed(1)}%`"
            :value="task.task_id"
          />
        </el-select>
        <el-button type="primary" :icon="Refresh" @click="loadTasks" :loading="loadingTasks">
          刷新
        </el-button>
        <el-dropdown @command="handleExport">
          <el-button type="success" :icon="Download" :disabled="!result">
            导出结果
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="csv">导出为 CSV 格式</el-dropdown-item>
              <el-dropdown-item command="phylip">导出为 Phylip 格式</el-dropdown-item>
              <el-dropdown-item command="bed">导出为 BED 格式</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <div v-if="!result && !loading" class="empty-state">
        <el-empty description="请选择一个比对任务查看3D可视化结果">
          <el-button type="primary" @click="goToUpload">
            去上传文件并开始比对
          </el-button>
        </el-empty>
      </div>

      <div v-else-if="loading" class="loading-state">
        <el-icon class="loading-icon" :size="64" color="#409eff"><Loading /></el-icon>
        <p>正在加载比对结果...</p>
      </div>

      <div v-else-if="result" class="visualization-content">
        <div class="result-header">
          <div class="task-info">
            <div class="info-item">
              <span class="label">任务ID:</span>
              <span class="value mono">{{ result.task_id }}</span>
            </div>
            <div class="info-item">
              <span class="label">相似度得分:</span>
              <el-tag type="primary" size="large">{{ result.similarity_score.toFixed(2) }}</el-tag>
            </div>
            <div class="info-item">
              <span class="label">一致性:</span>
              <el-tag :type="getIdentityTagType(result.identity_percentage)" size="large">
                {{ result.identity_percentage.toFixed(2) }}%
              </el-tag>
            </div>
            <div class="info-item">
              <span class="label">完成时间:</span>
              <span class="value">{{ formatDate(result.completed_at) }}</span>
            </div>
          </div>
        </div>

        <div class="visualization-main">
          <div class="hilbert-wrapper">
            <HilbertCurve3D
              :hilbert-data="result.hilbert_data"
              :difference-sites="result.difference_sites"
              :stats="visualizationStats"
              :task-id="selectedTaskId"
              @region-selected="handleRegionSelected"
              @analyze-region="handleAnalyzeRegion"
            />
          </div>
        </div>

        <div class="alignment-section">
          <div class="section-title">
            <el-icon :size="20" color="#67c23a"><Document /></el-icon>
            <h3>序列比对详情</h3>
          </div>

          <el-card class="alignment-card">
            <div class="alignment-stats">
              <div class="stat">
                <span class="stat-label">比对长度</span>
                <span class="stat-value">{{ formatNumber(result.alignment_length) }} bp</span>
              </div>
              <div class="stat">
                <span class="stat-label">序列1起始</span>
                <span class="stat-value">{{ result.start_pos1 }}</span>
              </div>
              <div class="stat">
                <span class="stat-label">序列1结束</span>
                <span class="stat-value">{{ result.end_pos1 }}</span>
              </div>
              <div class="stat">
                <span class="stat-label">序列2起始</span>
                <span class="stat-value">{{ result.start_pos2 }}</span>
              </div>
              <div class="stat">
                <span class="stat-label">序列2结束</span>
                <span class="stat-value">{{ result.end_pos2 }}</span>
              </div>
            </div>

            <div class="sequence-display">
              <div class="sequence-header">
                <span class="seq-label">序列1:</span>
                <span class="seq-label">序列2:</span>
                <span class="seq-label">匹配:</span>
              </div>
              <div class="sequence-content" ref="sequenceContainer">
                <template v-for="(block, blockIndex) in sequenceBlocks" :key="blockIndex">
                  <div class="sequence-block">
                    <div class="sequence-line">
                      <span class="position">{{ block.start + 1 }}</span>
                      <span class="seq seq1" v-html="formatSequence(block.seq1, block.matches)"></span>
                    </div>
                    <div class="sequence-line">
                      <span class="position"></span>
                      <span class="seq match-line" v-html="formatMatchLine(block.matches)"></span>
                    </div>
                    <div class="sequence-line">
                      <span class="position">{{ block.start + 1 }}</span>
                      <span class="seq seq2" v-html="formatSequence(block.seq2, block.matches)"></span>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </el-card>
        </div>

        <div class="region-section" v-if="regionResult || analyzingRegion">
          <div class="section-title">
            <el-icon :size="20" color="#e6a23c"><ZoomIn /></el-icon>
            <h3>区域高精度分析</h3>
            <el-tag v-if="analyzingRegion" type="warning" size="large">
              正在分析...
            </el-tag>
            <el-tag v-else-if="regionResult" type="success" size="large">
              分析完成
            </el-tag>
          </div>

          <el-card v-if="regionResult" class="region-card">
            <div class="region-info">
              <div class="info-item">
                <span class="label">区域ID:</span>
                <span class="value mono">{{ regionResult.region_id }}</span>
              </div>
              <div class="info-item">
                <span class="label">序列1范围:</span>
                <span class="value">{{ regionResult.start_pos1 }} - {{ regionResult.end_pos1 }}</span>
              </div>
              <div class="info-item">
                <span class="label">序列2范围:</span>
                <span class="value">{{ regionResult.start_pos2 }} - {{ regionResult.end_pos2 }}</span>
              </div>
              <div class="info-item">
                <span class="label">相似度得分:</span>
                <el-tag type="primary">{{ regionResult.similarity_score.toFixed(2) }}</el-tag>
              </div>
              <div class="info-item">
                <span class="label">一致性:</span>
                <el-tag :type="getIdentityTagType(regionResult.identity_percentage)">
                  {{ regionResult.identity_percentage.toFixed(2) }}%
                </el-tag>
              </div>
            </div>

            <div class="region-stats">
              <div class="stat">
                <span class="stat-label">比对长度</span>
                <span class="stat-value">{{ regionResult.aligned_sequence1.length }} bp</span>
              </div>
              <div class="stat success">
                <span class="stat-label">匹配</span>
                <span class="stat-value">{{ formatNumber(regionResult.match_count) }}</span>
              </div>
              <div class="stat warning">
                <span class="stat-label">错配</span>
                <span class="stat-value">{{ formatNumber(regionResult.mismatch_count) }}</span>
              </div>
              <div class="stat danger">
                <span class="stat-label">空位</span>
                <span class="stat-value">{{ formatNumber(regionResult.gap_count) }}</span>
              </div>
            </div>

            <div class="region-sequence">
              <h4>区域比对详情</h4>
              <div class="sequence-display compact">
                <div class="sequence-content">
                  <template v-for="(block, blockIndex) in regionSequenceBlocks" :key="'region-' + blockIndex">
                    <div class="sequence-block">
                      <div class="sequence-line">
                        <span class="position">{{ block.start + 1 }}</span>
                        <span class="seq seq1" v-html="formatSequence(block.seq1, block.matches)"></span>
                      </div>
                      <div class="sequence-line">
                        <span class="position"></span>
                        <span class="seq match-line" v-html="formatMatchLine(block.matches)"></span>
                      </div>
                      <div class="sequence-line">
                        <span class="position">{{ block.start + 1 }}</span>
                        <span class="seq seq2" v-html="formatSequence(block.seq2, block.matches)"></span>
                      </div>
                    </div>
                  </template>
                </div>
              </div>
            </div>

            <div class="region-actions">
              <el-button @click="clearRegionResult">清除区域分析</el-button>
              <el-dropdown @command="(cmd) => handleRegionExport(cmd)">
                <el-button type="primary">
                  导出区域结果
                  <el-icon class="el-icon--right"><ArrowDown /></el-icon>
                </el-button>
                <template #dropdown>
                  <el-dropdown-menu>
                    <el-dropdown-item command="csv">导出为 CSV</el-dropdown-item>
                    <el-dropdown-item command="phylip">导出为 Phylip</el-dropdown-item>
                  </el-dropdown-menu>
                </template>
              </el-dropdown>
            </div>
          </el-card>

          <div v-else-if="analyzingRegion" class="analyzing-state">
            <el-icon class="loading-icon" :size="48" color="#e6a23c"><Loading /></el-icon>
            <p>正在对选中区域进行高精度比对分析...</p>
            <p class="tip">使用更高精度的 gap penalty 参数进行详细比对</p>
          </div>
        </div>

        <div class="differences-section">
          <div class="section-title">
            <el-icon :size="20" color="#f56c6c"><Warning /></el-icon>
            <h3>差异位点列表</h3>
            <el-tag type="danger" size="large">
              共 {{ result.difference_sites.length }} 处差异
            </el-tag>
          </div>

          <el-table
            :data="paginatedDifferences"
            class="differences-table"
            v-loading="loading"
          >
            <el-table-column prop="position" label="位置" width="120" />
            <el-table-column label="序列1" width="120">
              <template #default="{ row }">
                <span :class="getBaseClass(row.base1)">{{ row.base1 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="序列2" width="120">
              <template #default="{ row }">
                <span :class="getBaseClass(row.base2)">{{ row.base2 }}</span>
              </template>
            </el-table-column>
            <el-table-column label="类型" width="150">
              <template #default="{ row }">
                <el-tag :type="row.type === 'mismatch' ? 'danger' : 'warning'">
                  {{ row.type === 'mismatch' ? '错配' : '空位' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="说明">
              <template #default="{ row }">
                {{ getDifferenceDescription(row) }}
              </template>
            </el-table-column>
          </el-table>

          <div class="pagination-wrapper">
            <el-pagination
              v-model:current-page="currentPage"
              v-model:page-size="pageSize"
              :total="result.difference_sites.length"
              :page-sizes="[20, 50, 100, 200]"
              layout="total, sizes, prev, pager, next, jumper"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Cpu, Refresh, Loading, Document, Warning, ZoomIn, Download, ArrowDown
} from '@element-plus/icons-vue'
import { useAlignmentStore } from '../stores/alignment'
import api from '../utils/api'
import HilbertCurve3D from '../components/HilbertCurve3D.vue'

const route = useRoute()
const router = useRouter()
const store = useAlignmentStore()

const tasks = ref([])
const selectedTaskId = ref('')
const result = ref(null)
const loading = ref(false)
const loadingTasks = ref(false)
const currentPage = ref(1)
const pageSize = ref(50)
const sequenceContainer = ref(null)
const regionResult = ref(null)
const analyzingRegion = ref(false)
const selectedRegion = ref(null)

const visualizationStats = computed(() => {
  if (!result.value) return null
  return {
    alignment_length: result.value.alignment_length,
    identity_percentage: result.value.identity_percentage,
    match_count: result.value.match_count,
    mismatch_count: result.value.mismatch_count,
    gap_count: result.value.gap_count,
    difference_count: result.value.difference_sites.length
  }
})

const sequenceBlocks = computed(() => {
  if (!result.value) return []

  const seq1 = result.value.aligned_sequence1
  const seq2 = result.value.aligned_sequence2
  const blockSize = 100
  const blocks = []

  for (let i = 0; i < seq1.length; i += blockSize) {
    const end = Math.min(i + blockSize, seq1.length)
    const s1 = seq1.slice(i, end)
    const s2 = seq2.slice(i, end)

    const matches = []
    for (let j = 0; j < s1.length; j++) {
      matches.push(s1[j] === s2[j] && s1[j] !== '-')
    }

    blocks.push({
      start: i,
      end: end,
      seq1: s1,
      seq2: s2,
      matches: matches
    })
  }

  return blocks
})

const paginatedDifferences = computed(() => {
  if (!result.value) return []
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return result.value.difference_sites.slice(start, end)
})

const regionSequenceBlocks = computed(() => {
  if (!regionResult.value) return []

  const seq1 = regionResult.value.aligned_sequence1
  const seq2 = regionResult.value.aligned_sequence2
  const blockSize = 100
  const blocks = []

  for (let i = 0; i < seq1.length; i += blockSize) {
    const end = Math.min(i + blockSize, seq1.length)
    const s1 = seq1.slice(i, end)
    const s2 = seq2.slice(i, end)

    const matches = []
    for (let j = 0; j < s1.length; j++) {
      matches.push(s1[j] === s2[j] && s1[j] !== '-')
    }

    blocks.push({
      start: i,
      end: end,
      seq1: s1,
      seq2: s2,
      matches: matches
    })
  }

  return blocks
})

function formatNumber(num) {
  return num ? num.toLocaleString() : '0'
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function getIdentityTagType(percentage) {
  if (percentage >= 90) return 'success'
  if (percentage >= 70) return 'primary'
  if (percentage >= 50) return 'warning'
  return 'danger'
}

function formatSequence(seq, matches) {
  let html = ''
  for (let i = 0; i < seq.length; i++) {
    const base = seq[i]
    if (base === '-') {
      html += `<span class="base gap">-</span>`
    } else if (matches[i]) {
      html += `<span class="base match">${base}</span>`
    } else {
      html += `<span class="base mismatch">${base}</span>`
    }
  }
  return html
}

function formatMatchLine(matches) {
  return matches.map(m => m ? '|' : ' ').join('')
}

function getBaseClass(base) {
  const classes = {
    'A': 'base-a',
    'T': 'base-t',
    'G': 'base-g',
    'C': 'base-c',
    '-': 'base-gap'
  }
  return classes[base] || ''
}

function getDifferenceDescription(row) {
  if (row.type === 'mismatch') {
    return `${row.base1} → ${row.base2}`
  } else {
    if (row.base1 === '-') {
      return `序列1缺失 ${row.base2}`
    } else {
      return `序列2缺失 ${row.base1}`
    }
  }
}

async function loadTasks() {
  loadingTasks.value = true
  try {
    tasks.value = await store.loadTasks()
  } catch (error) {
    ElMessage.error('加载任务列表失败')
  } finally {
    loadingTasks.value = false
  }
}

async function loadResult(taskId) {
  if (!taskId) {
    result.value = null
    return
  }

  loading.value = true
  try {
    result.value = await store.getTaskResult(taskId)
    currentPage.value = 1
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '加载比对结果失败')
    result.value = null
  } finally {
    loading.value = false
  }
}

function handleRegionSelected(region) {
  selectedRegion.value = region
  ElMessage.success(
    `已选择区域: ${region.start} - ${region.end}, 长度: ${formatNumber(region.length)} bp`
  )
}

async function handleAnalyzeRegion(region) {
  if (!selectedTaskId.value) return

  analyzingRegion.value = true
  regionResult.value = null

  try {
    const response = await api.post('/analysis/region-align', {
      task_id: selectedTaskId.value,
      start_pos1: region.start,
      end_pos1: region.end,
      start_pos2: region.start,
      end_pos2: region.end,
      match_score: 3,
      mismatch_penalty: -2,
      gap_penalty: -4,
      gap_extend_penalty: -1
    })

    regionResult.value = response.data
    ElMessage.success('区域高精度分析完成！')
  } catch (error) {
    ElMessage.error(
      error.response?.data?.detail || '区域分析失败，请重试'
    )
  } finally {
    analyzingRegion.value = false
  }
}

function clearRegionResult() {
  regionResult.value = null
  selectedRegion.value = null
}

async function handleExport(format) {
  if (!selectedTaskId.value) return

  try {
    const response = await api.post('/analysis/export', {
      task_id: selectedTaskId.value,
      format: format,
      include_metadata: true
    }, {
      responseType: 'blob'
    })

    const url = window.URL.createObjectURL(new Blob([response.data]))
    const link = document.createElement('a')
    link.href = url

    const extensions = { csv: 'csv', phylip: 'phy', bed: 'bed' }
    link.setAttribute(
      'download',
      `alignment_${selectedTaskId.value.slice(0, 8)}.${extensions[format]}`
    )

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)

    ElMessage.success(`已导出 ${format.toUpperCase()} 格式文件`)
  } catch (error) {
    ElMessage.error('导出失败，请重试')
  }
}

async function handleRegionExport(format) {
  if (!regionResult.value) return

  const content = generateRegionExportContent(format)
  const blob = new Blob([content], { type: 'text/plain' })
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url

  const extensions = { csv: 'csv', phylip: 'phy' }
  link.setAttribute(
    'download',
    `region_${regionResult.value.region_id}.${extensions[format]}`
  )

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)

  ElMessage.success(`区域结果已导出为 ${format.toUpperCase()} 格式`)
}

function generateRegionExportContent(format) {
  const r = regionResult.value
  if (!r) return ''

  if (format === 'csv') {
    let csv = '# 区域序列比对结果 - CSV导出\n\n'
    csv += '=== 基本信息 ===\n'
    csv += `区域ID,${r.region_id}\n`
    csv += `序列1范围,${r.start_pos1}-${r.end_pos1}\n`
    csv += `序列2范围,${r.start_pos2}-${r.end_pos2}\n`
    csv += `相似度得分,${r.similarity_score.toFixed(4)}\n`
    csv += `一致性,${r.identity_percentage.toFixed(2)}%\n`
    csv += `匹配数,${r.match_count}\n`
    csv += `错配数,${r.mismatch_count}\n`
    csv += `空位数,${r.gap_count}\n\n`

    csv += '=== 差异位点 ===\n'
    csv += '位置,序列1,序列2,类型\n'

    r.difference_sites.forEach(site => {
      const typeZh = site.type === 'mismatch' ? '错配' : '空位'
      csv += `${site.position},${site.base1},${site.base2},${typeZh}\n`
    })

    csv += '\n=== 比对序列 ===\n'
    csv += `序列1:,${r.aligned_sequence1}\n`
    csv += `序列2:,${r.aligned_sequence2}\n`

    return csv
  } else if (format === 'phylip') {
    let phylip = `  2  ${r.aligned_sequence1.length}\n\n`
    phylip += `Sequence1  ${r.aligned_sequence1}\n`
    phylip += `Sequence2  ${r.aligned_sequence2}\n`
    return phylip
  }

  return ''
}

function goToUpload() {
  router.push('/')
}

watch(() => route.params.taskId, (newTaskId) => {
  if (newTaskId) {
    selectedTaskId.value = newTaskId
    loadResult(newTaskId)
  }
}, { immediate: true })

onMounted(async () => {
  await loadTasks()

  if (route.params.taskId) {
    selectedTaskId.value = route.params.taskId
    loadResult(route.params.taskId)
  }
})
</script>

<style scoped>
.visualization-view {
  max-width: 1800px;
  margin: 0 auto;
  height: 100%;
}

.content-wrapper {
  padding: 20px;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  flex-shrink: 0;
}

.section-title h2,
.section-title h3 {
  margin: 0;
  font-weight: 600;
  color: #ffffff;
}

.section-title h2 {
  font-size: 24px;
}

.section-title h3 {
  font-size: 18px;
}

.empty-state,
.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  min-height: 400px;
}

.loading-icon {
  animation: spin 1s linear infinite;
  margin-bottom: 20px;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.loading-state p {
  color: rgba(255, 255, 255, 0.7);
  font-size: 16px;
}

:deep(.el-empty) {
  --el-empty-description-color: rgba(255, 255, 255, 0.5);
}

.visualization-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 24px;
  overflow: auto;
}

.result-header {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 24px;
  flex-shrink: 0;
}

.task-info {
  display: flex;
  gap: 40px;
  flex-wrap: wrap;
}

.info-item {
  display: flex;
  align-items: center;
  gap: 12px;
}

.info-item .label {
  color: rgba(255, 255, 255, 0.6);
  font-size: 14px;
}

.info-item .value {
  color: #ffffff;
  font-weight: 500;
}

.info-item .value.mono {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #67c23a;
}

.visualization-main {
  flex: 1;
  min-height: 600px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  overflow: hidden;
}

.hilbert-wrapper {
  width: 100%;
  height: 600px;
}

.alignment-section,
.differences-section {
  flex-shrink: 0;
}

.alignment-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  backdrop-filter: blur(10px);
}

.alignment-card :deep(.el-card__body) {
  padding: 24px;
}

.alignment-stats {
  display: flex;
  gap: 40px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
}

.sequence-display {
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
  padding: 20px;
  max-height: 400px;
  overflow: auto;
}

.sequence-header {
  display: flex;
  gap: 20px;
  margin-bottom: 12px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.5);
}

.sequence-header .seq-label {
  min-width: 80px;
  text-align: right;
}

.sequence-block {
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.sequence-block:last-child {
  margin-bottom: 0;
  padding-bottom: 0;
  border-bottom: none;
}

.sequence-line {
  display: flex;
  gap: 10px;
  font-family: 'Courier New', monospace;
  font-size: 13px;
  line-height: 1.8;
}

.position {
  min-width: 60px;
  text-align: right;
  color: rgba(255, 255, 255, 0.4);
  font-size: 11px;
}

.seq {
  letter-spacing: 2px;
  flex: 1;
}

.base {
  display: inline-block;
  padding: 0 2px;
  border-radius: 2px;
}

.base.match {
  color: #67c23a;
}

.base.mismatch {
  color: #f56c6c;
  background: rgba(245, 108, 108, 0.2);
}

.base.gap {
  color: #e6a23c;
}

.match-line {
  color: #67c23a;
}

.base-a { color: #409eff; font-weight: bold; }
.base-t { color: #f56c6c; font-weight: bold; }
.base-g { color: #e6a23c; font-weight: bold; }
.base-c { color: #67c23a; font-weight: bold; }
.base-gap { color: #909399; }

.differences-table {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  overflow: hidden;
}

.differences-table :deep(.el-table) {
  background: transparent;
}

.differences-table :deep(.el-table th) {
  background: rgba(0, 0, 0, 0.2);
  color: #ffffff;
}

.differences-table :deep(.el-table td) {
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
}

.differences-table :deep(.el-table--border tr) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.pagination-wrapper {
  display: flex;
  justify-content: center;
  margin-top: 20px;
}

.pagination-wrapper :deep(.el-pagination) {
  --el-pagination-color: rgba(255, 255, 255, 0.8);
}

.pagination-wrapper :deep(.el-pager li) {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
}

.pagination-wrapper :deep(.el-pager li.active) {
  background: #409eff;
  color: #ffffff;
}

.pagination-wrapper :deep(.btn-prev),
.pagination-wrapper :deep(.btn-next) {
  background: rgba(255, 255, 255, 0.05);
  color: rgba(255, 255, 255, 0.8);
}

.mono {
  font-family: 'Courier New', monospace;
}

.region-section {
  background: rgba(230, 162, 60, 0.05);
  border: 1px solid rgba(230, 162, 60, 0.2);
  border-radius: 16px;
  padding: 24px;
}

.region-card {
  background: rgba(0, 0, 0, 0.3);
  border: none;
}

.region-info {
  display: flex;
  gap: 30px;
  flex-wrap: wrap;
  margin-bottom: 20px;
  padding-bottom: 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.region-stats {
  display: flex;
  gap: 30px;
  margin-bottom: 24px;
}

.region-stats .stat {
  text-align: center;
  padding: 16px 24px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 12px;
  flex: 1;
}

.region-stats .stat-label {
  display: block;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
  margin-bottom: 8px;
}

.region-stats .stat-value {
  display: block;
  font-size: 24px;
  font-weight: 600;
  color: #ffffff;
}

.region-stats .stat.success .stat-value { color: #67c23a; }
.region-stats .stat.warning .stat-value { color: #e6a23c; }
.region-stats .stat.danger .stat-value { color: #f56c6c; }

.region-sequence h4 {
  margin: 0 0 16px 0;
  font-size: 16px;
  color: #ffffff;
}

.sequence-display.compact .sequence-block {
  margin-bottom: 12px;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.region-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.analyzing-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  text-align: center;
}

.analyzing-state p {
  color: rgba(255, 255, 255, 0.8);
  font-size: 16px;
  margin: 12px 0 0 0;
}

.analyzing-state p.tip {
  color: rgba(255, 255, 255, 0.5);
  font-size: 14px;
  margin-top: 8px;
}

.analyzing-state .loading-icon {
  animation: spin 1s linear infinite;
}
</style>
