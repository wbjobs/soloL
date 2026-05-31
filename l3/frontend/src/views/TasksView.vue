<template>
  <div class="tasks-view">
    <div class="content-wrapper">
      <div class="section-title">
        <el-icon :size="28" color="#409eff"><List /></el-icon>
        <h2>比对任务列表</h2>
        <el-button type="primary" :icon="Refresh" @click="loadTasks" :loading="loading">
          刷新
        </el-button>
      </div>

      <el-table :data="tasks" class="tasks-table" v-loading="loading">
        <el-table-column prop="task_id" label="任务ID" width="280">
          <template #default="{ row }">
            <span class="mono">{{ row.task_id }}</span>
          </template>
        </el-table-column>
        <el-table-column label="相似度得分">
          <template #default="{ row }">
            <el-tag type="primary" size="large">
              {{ row.similarity_score.toFixed(2) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="一致性">
          <template #default="{ row }">
            <el-progress
              :percentage="row.identity_percentage"
              :color="getIdentityColor(row.identity_percentage)"
              :stroke-width="10"
              :format="(p) => `${p.toFixed(1)}%`"
            />
          </template>
        </el-table-column>
        <el-table-column prop="alignment_length" label="比对长度">
          <template #default="{ row }">
            {{ formatNumber(row.alignment_length) }} bp
          </template>
        </el-table-column>
        <el-table-column prop="match_count" label="匹配">
          <template #default="{ row }">
            <span class="text-success">{{ formatNumber(row.match_count) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="mismatch_count" label="错配">
          <template #default="{ row }">
            <span class="text-warning">{{ formatNumber(row.mismatch_count) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="gap_count" label="空位">
          <template #default="{ row }">
            <span class="text-danger">{{ formatNumber(row.gap_count) }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="completed_at" label="完成时间" width="180">
          <template #default="{ row }">
            {{ formatDate(row.completed_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="140">
          <template #default="{ row }">
            <el-button type="primary" size="small" :icon="View" @click="viewResult(row.task_id)">
              查看
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <el-empty v-if="!loading && tasks.length === 0" description="暂无比对任务" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { List, Refresh, View } from '@element-plus/icons-vue'
import { useAlignmentStore } from '../stores/alignment'

const router = useRouter()
const store = useAlignmentStore()

const tasks = ref([])
const loading = ref(false)

function formatNumber(num) {
  return num ? num.toLocaleString() : '-'
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function getIdentityColor(percentage) {
  if (percentage >= 90) return '#67c23a'
  if (percentage >= 70) return '#e6a23c'
  if (percentage >= 50) return '#f56c6c'
  return '#909399'
}

async function loadTasks() {
  loading.value = true
  try {
    tasks.value = await store.loadTasks()
  } catch (error) {
    ElMessage.error('加载任务列表失败')
  } finally {
    loading.value = false
  }
}

function viewResult(taskId) {
  router.push(`/visualization/${taskId}`)
}

onMounted(() => {
  loadTasks()
})
</script>

<style scoped>
.tasks-view {
  max-width: 1600px;
  margin: 0 auto;
}

.content-wrapper {
  padding: 20px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 24px;
}

.section-title h2 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  color: #ffffff;
  flex: 1;
}

.tasks-table {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  overflow: hidden;
}

.tasks-table :deep(.el-table) {
  background: transparent;
}

.tasks-table :deep(.el-table th) {
  background: rgba(0, 0, 0, 0.2);
  color: #ffffff;
}

.tasks-table :deep(.el-table td) {
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
}

.tasks-table :deep(.el-table--border tr) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.mono {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #67c23a;
}

.text-success {
  color: #67c23a;
}

.text-warning {
  color: #e6a23c;
}

.text-danger {
  color: #f56c6c;
}

:deep(.el-empty) {
  --el-empty-description-color: rgba(255, 255, 255, 0.5);
}
</style>
