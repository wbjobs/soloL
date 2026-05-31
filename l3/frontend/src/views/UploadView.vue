<template>
  <div class="upload-view">
    <div class="content-wrapper">
      <div class="section-title">
        <el-icon :size="28" color="#409eff"><Upload /></el-icon>
        <h2>基因序列文件上传</h2>
      </div>

      <div class="upload-section">
        <el-row :gutter="20">
          <el-col :span="12">
            <div class="upload-card">
              <h3><el-icon><Document /></el-icon> 文件 1</h3>
              <FileUploader
                :file-id="file1Id"
                @upload-complete="handleFile1Complete"
                @file-id-generated="(id) => file1Id = id"
              />
              <div v-if="file1Info" class="file-info">
                <el-tag type="success">已上传</el-tag>
                <div class="info-item">
                  <span class="label">文件名:</span>
                  <span class="value">{{ file1Info.filename }}</span>
                </div>
                <div class="info-item">
                  <span class="label">序列名:</span>
                  <span class="value">{{ file1Info.sequence_name }}</span>
                </div>
                <div class="info-item">
                  <span class="label">序列长度:</span>
                  <span class="value">{{ formatNumber(file1Info.sequence_length) }} bp</span>
                </div>
                <div class="info-item">
                  <span class="label">文件大小:</span>
                  <span class="value">{{ formatFileSize(file1Info.file_size) }}</span>
                </div>
              </div>
            </div>
          </el-col>

          <el-col :span="12">
            <div class="upload-card">
              <h3><el-icon><Document /></el-icon> 文件 2</h3>
              <FileUploader
                :file-id="file2Id"
                @upload-complete="handleFile2Complete"
                @file-id-generated="(id) => file2Id = id"
              />
              <div v-if="file2Info" class="file-info">
                <el-tag type="success">已上传</el-tag>
                <div class="info-item">
                  <span class="label">文件名:</span>
                  <span class="value">{{ file2Info.filename }}</span>
                </div>
                <div class="info-item">
                  <span class="label">序列名:</span>
                  <span class="value">{{ file2Info.sequence_name }}</span>
                </div>
                <div class="info-item">
                  <span class="label">序列长度:</span>
                  <span class="value">{{ formatNumber(file2Info.sequence_length) }} bp</span>
                </div>
                <div class="info-item">
                  <span class="label">文件大小:</span>
                  <span class="value">{{ formatFileSize(file2Info.file_size) }}</span>
                </div>
              </div>
            </div>
          </el-col>
        </el-row>
      </div>

      <div v-if="file1Info && file2Info" class="alignment-section">
        <div class="section-title">
          <el-icon :size="24" color="#67c23a"><Setting /></el-icon>
          <h3>比对参数设置</h3>
        </div>

        <el-card class="params-card">
          <el-row :gutter="20">
            <el-col :span="8">
              <el-form-item label="匹配得分">
                <el-input-number v-model="alignmentParams.match_score" :min="1" :max="10" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="错配罚分">
                <el-input-number v-model="alignmentParams.mismatch_penalty" :min="-10" :max="-1" />
              </el-form-item>
            </el-col>
            <el-col :span="8">
              <el-form-item label="空位罚分">
                <el-input-number v-model="alignmentParams.gap_penalty" :min="-10" :max="-1" />
              </el-form-item>
            </el-col>
          </el-row>

          <div class="start-btn-wrapper">
            <el-button
              type="primary"
              size="large"
              :icon="VideoPlay"
              :loading="startingAlignment"
              @click="startAlignment"
            >
              开始序列比对
            </el-button>
          </div>
        </el-card>
      </div>

      <div v-if="currentTask" class="progress-section">
        <div class="section-title">
          <el-icon :size="24" color="#e6a23c"><Loading /></el-icon>
          <h3>比对进度</h3>
          <el-tag :type="progressTagType" size="large">{{ progressStatusText }}</el-tag>
        </div>

        <el-card class="progress-card">
          <div class="progress-info">
            <div class="info-row">
              <span class="label">任务ID:</span>
              <span class="value mono">{{ currentTask.task_id }}</span>
            </div>
            <div v-if="taskProgress" class="info-row">
              <span class="label">当前阶段:</span>
              <span class="value">{{ taskProgress.current_stage || '等待中...' }}</span>
            </div>
            <div v-if="taskProgress && taskProgress.message" class="info-row error">
              <el-icon><Warning /></el-icon>
              <span>{{ taskProgress.message }}</span>
            </div>
          </div>

          <el-progress
            :percentage="progressPercentage"
            :status="progressStatus"
            :stroke-width="20"
            :format="(percentage) => `${percentage.toFixed(1)}%`"
          />

          <div v-if="taskProgress && taskProgress.status === 'completed'" class="result-actions">
            <el-button type="success" :icon="View" @click="goToVisualization">
              查看3D可视化结果
            </el-button>
          </div>
        </el-card>
      </div>

      <div class="section-title" style="margin-top: 40px;">
        <el-icon :size="24" color="#909399"><Collection /></el-icon>
        <h3>已上传文件列表</h3>
        <el-button type="primary" link @click="loadFiles">
          <el-icon><Refresh /></el-icon> 刷新
        </el-button>
      </div>

      <el-table :data="uploadedFiles" class="files-table" v-loading="loadingFiles">
        <el-table-column prop="filename" label="文件名" />
        <el-table-column prop="sequence_name" label="序列名" />
        <el-table-column prop="sequence_length" label="序列长度">
          <template #default="{ row }">
            {{ formatNumber(row.sequence_length) }} bp
          </template>
        </el-table-column>
        <el-table-column prop="file_size" label="文件大小">
          <template #default="{ row }">
            {{ formatFileSize(row.file_size) }}
          </template>
        </el-table-column>
        <el-table-column prop="status" label="状态">
          <template #default="{ row }">
            <el-tag :type="row.status === 'completed' ? 'success' : 'warning'">
              {{ row.status === 'completed' ? '已完成' : row.status }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="created_at" label="上传时间">
          <template #default="{ row }">
            {{ formatDate(row.created_at) }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150">
          <template #default="{ row }">
            <el-button type="primary" link size="small" @click="selectFile(row, 1)">
              设为文件1
            </el-button>
            <el-button type="success" link size="small" @click="selectFile(row, 2)">
              设为文件2
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import {
  Upload, Document, Setting, VideoPlay, Loading, View,
  Collection, Refresh, Warning
} from '@element-plus/icons-vue'
import { useAlignmentStore } from '../stores/alignment'
import FileUploader from '../components/FileUploader.vue'
import { getFileInfo } from '../utils/chunkUpload'
import wsClient from '../utils/websocket'

const router = useRouter()
const store = useAlignmentStore()

const file1Id = ref('')
const file2Id = ref('')
const file1Info = ref(null)
const file2Info = ref(null)
const startingAlignment = ref(false)
const currentTask = ref(null)
const taskProgress = ref(null)
const loadingFiles = ref(false)

const alignmentParams = ref({
  match_score: 2,
  mismatch_penalty: -1,
  gap_penalty: -2
})

const uploadedFiles = computed(() => store.uploadedFiles)

const progressPercentage = computed(() => {
  return taskProgress.value ? taskProgress.value.progress * 100 : 0
})

const progressStatus = computed(() => {
  if (!taskProgress.value) return ''
  if (taskProgress.value.status === 'completed') return 'success'
  if (taskProgress.value.status === 'failed') return 'exception'
  return ''
})

const progressTagType = computed(() => {
  if (!taskProgress.value) return 'info'
  if (taskProgress.value.status === 'completed') return 'success'
  if (taskProgress.value.status === 'failed') return 'danger'
  if (taskProgress.value.status === 'processing') return 'warning'
  if (taskProgress.value.status === 'retrying') return 'warning'
  return 'info'
})

const progressStatusText = computed(() => {
  if (!taskProgress.value) return '等待中'
  const statusMap = {
    pending: '等待中',
    processing: '处理中',
    retrying: '重试中',
    completed: '已完成',
    failed: '失败'
  }
  return statusMap[taskProgress.value.status] || taskProgress.value.status
})

function formatNumber(num) {
  return num ? num.toLocaleString() : '-'
}

function formatFileSize(bytes) {
  if (!bytes) return '-'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`
}

function formatDate(dateStr) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN')
}

async function handleFile1Complete(fileId) {
  try {
    file1Info.value = await getFileInfo(fileId)
    store.setSelectedFile1(file1Info.value)
    ElMessage.success('文件1上传成功')
  } catch (error) {
    ElMessage.error('获取文件信息失败')
  }
}

async function handleFile2Complete(fileId) {
  try {
    file2Info.value = await getFileInfo(fileId)
    store.setSelectedFile2(file2Info.value)
    ElMessage.success('文件2上传成功')
  } catch (error) {
    ElMessage.error('获取文件信息失败')
  }
}

function selectFile(file, index) {
  if (index === 1) {
    file1Id.value = file.file_id
    file1Info.value = file
    store.setSelectedFile1(file)
  } else {
    file2Id.value = file.file_id
    file2Info.value = file
    store.setSelectedFile2(file)
  }
  ElMessage.success(`已选择 ${file.filename} 作为文件${index}`)
}

async function startAlignment() {
  if (!file1Id.value || !file2Id.value) {
    ElMessage.warning('请先上传两个文件')
    return
  }

  startingAlignment.value = true
  try {
    const result = await store.startAlignment({
      file1_id: file1Id.value,
      file2_id: file2Id.value,
      ...alignmentParams.value
    })
    currentTask.value = result
    store.setCurrentTask(result)

    wsClient.connect(result.task_id)
    wsClient.on('progress', handleProgressUpdate)

    ElMessage.success('比对任务已启动')
  } catch (error) {
    ElMessage.error(error.response?.data?.detail || '启动比对任务失败')
  } finally {
    startingAlignment.value = false
  }
}

function handleProgressUpdate(data) {
  taskProgress.value = data
  store.setTaskProgress(data)

  if (data.status === 'completed') {
    wsClient.off('progress', handleProgressUpdate)
    ElMessage.success('比对完成！')
  } else if (data.status === 'failed') {
    wsClient.off('progress', handleProgressUpdate)
    ElMessage.error('比对失败: ' + (data.message || '未知错误'))
  } else if (data.status === 'retrying') {
    const retryMsg = data.stage || '任务正在重试...'
    ElMessage.warning({
      message: retryMsg,
      duration: 3000,
      showClose: true
    })
  }
}

function goToVisualization() {
  if (currentTask.value) {
    router.push(`/visualization/${currentTask.value.task_id}`)
  }
}

async function loadFiles() {
  loadingFiles.value = true
  try {
    await store.loadFiles()
  } finally {
    loadingFiles.value = false
  }
}

onMounted(() => {
  loadFiles()
})
</script>

<style scoped>
.upload-view {
  max-width: 1400px;
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

.upload-section {
  margin-bottom: 40px;
}

.upload-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  padding: 24px;
  backdrop-filter: blur(10px);
}

.upload-card h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 20px 0;
  color: #ffffff;
  font-size: 16px;
}

.file-info {
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.file-info .el-tag {
  margin-bottom: 16px;
}

.info-item {
  display: flex;
  justify-content: space-between;
  padding: 8px 0;
  font-size: 14px;
}

.info-item .label {
  color: rgba(255, 255, 255, 0.6);
}

.info-item .value {
  color: #ffffff;
  font-weight: 500;
}

.alignment-section {
  margin-bottom: 40px;
}

.params-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  backdrop-filter: blur(10px);
}

.params-card :deep(.el-card__body) {
  padding: 24px;
}

.params-card :deep(.el-form-item) {
  margin-bottom: 0;
}

.params-card :deep(.el-form-item__label) {
  color: rgba(255, 255, 255, 0.8);
}

.start-btn-wrapper {
  text-align: center;
  margin-top: 30px;
}

.start-btn-wrapper .el-button {
  padding: 16px 60px;
  font-size: 16px;
  border-radius: 12px;
}

.progress-section {
  margin-bottom: 40px;
}

.progress-section .section-title {
  justify-content: flex-start;
  gap: 12px;
}

.progress-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 16px;
  backdrop-filter: blur(10px);
}

.progress-card :deep(.el-card__body) {
  padding: 24px;
}

.progress-info {
  margin-bottom: 24px;
}

.info-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  font-size: 14px;
}

.info-row .label {
  color: rgba(255, 255, 255, 0.6);
  min-width: 80px;
}

.info-row .value {
  color: #ffffff;
}

.info-row .value.mono {
  font-family: 'Courier New', monospace;
  font-size: 13px;
  color: #67c23a;
}

.info-row.error {
  color: #f56c6c;
}

.result-actions {
  margin-top: 24px;
  text-align: center;
}

.files-table {
  background: rgba(255, 255, 255, 0.05);
  border-radius: 16px;
  overflow: hidden;
}

.files-table :deep(.el-table) {
  background: transparent;
}

.files-table :deep(.el-table th) {
  background: rgba(0, 0, 0, 0.2);
  color: #ffffff;
}

.files-table :deep(.el-table td) {
  background: transparent;
  color: rgba(255, 255, 255, 0.9);
}

.files-table :deep(.el-table--border tr) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.mono {
  font-family: 'Courier New', monospace;
}
</style>
