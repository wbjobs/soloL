<template>
  <div class="file-uploader">
    <el-upload
      drag
      :auto-upload="false"
      :show-file-list="false"
      :on-change="handleFileSelect"
      accept=".fasta,.fa,.fas"
    >
      <el-icon class="upload-icon"><UploadFilled /></el-icon>
      <div class="el-upload__text">
        将FASTA文件拖到此处，或<em>点击上传</em>
      </div>
      <template #tip>
        <div class="el-upload__tip">
          支持 .fasta, .fa, .fas 格式，单个文件最大 512MB
        </div>
      </template>
    </el-upload>

    <div v-if="selectedFile" class="file-progress">
      <div class="file-header">
        <el-icon><Document /></el-icon>
        <span class="file-name">{{ selectedFile.name }}</span>
        <span class="file-size">{{ formatFileSize(selectedFile.size) }}</span>
      </div>

      <div class="progress-wrapper">
        <el-progress
          :percentage="uploadProgress"
          :status="uploadStatus"
          :stroke-width="12"
        />
      </div>

      <div class="status-text">
        {{ statusText }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { UploadFilled, Document } from '@element-plus/icons-vue'
import { uploadFile, generateFileId, getFileInfo } from '../utils/chunkUpload'

const props = defineProps({
  fileId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['upload-complete', 'file-id-generated'])

const selectedFile = ref(null)
const uploadProgress = ref(0)
const uploadStatus = ref('')
const statusText = ref('')
const isUploading = ref(false)

const currentFileId = ref(props.fileId || generateFileId())

watch(() => props.fileId, (newId) => {
  if (newId) {
    currentFileId.value = newId
  }
})

function formatFileSize(bytes) {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex++
  }
  return `${size.toFixed(2)} ${units[unitIndex]}`
}

async function handleFileSelect(file) {
  if (isUploading.value) {
    ElMessage.warning('当前有文件正在上传，请等待完成')
    return
  }

  const maxSize = 512 * 1024 * 1024
  if (file.size > maxSize) {
    ElMessage.error('文件大小超过限制，最大支持 512MB')
    return
  }

  const validExtensions = ['.fasta', '.fa', '.fas']
  const fileName = file.name.toLowerCase()
  if (!validExtensions.some(ext => fileName.endsWith(ext))) {
    ElMessage.error('请上传FASTA格式的文件 (.fasta, .fa, .fas)')
    return
  }

  if (!currentFileId.value) {
    currentFileId.value = generateFileId()
    emit('file-id-generated', currentFileId.value)
  }

  selectedFile.value = file
  uploadProgress.value = 0
  uploadStatus.value = ''
  isUploading.value = true

  try {
    await uploadFile(
      file.raw,
      currentFileId.value,
      (progress) => {
        uploadProgress.value = progress
        if (progress >= 100) {
          uploadStatus.value = 'success'
        }
      },
      (status) => {
        statusText.value = status
      }
    )

    uploadStatus.value = 'success'
    statusText.value = '上传完成'

    const fileInfo = await getFileInfo(currentFileId.value)
    emit('upload-complete', currentFileId.value, fileInfo)

  } catch (error) {
    uploadStatus.value = 'exception'
    statusText.value = '上传失败: ' + (error.response?.data?.detail || error.message)
    ElMessage.error(statusText.value)
  } finally {
    isUploading.value = false
  }
}
</script>

<style scoped>
.file-uploader {
  width: 100%;
}

.upload-icon {
  font-size: 67px;
  color: #409eff;
}

:deep(.el-upload-dragger) {
  background: rgba(255, 255, 255, 0.02);
  border: 2px dashed rgba(64, 158, 255, 0.4);
  border-radius: 12px;
  transition: all 0.3s ease;
}

:deep(.el-upload-dragger:hover) {
  background: rgba(64, 158, 255, 0.1);
  border-color: #409eff;
}

:deep(.el-upload__text) {
  color: rgba(255, 255, 255, 0.8);
}

:deep(.el-upload__text em) {
  color: #409eff;
  font-style: normal;
}

:deep(.el-upload__tip) {
  color: rgba(255, 255, 255, 0.5);
}

.file-progress {
  margin-top: 20px;
  padding: 20px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 12px;
}

.file-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  color: #ffffff;
}

.file-name {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  color: rgba(255, 255, 255, 0.6);
  font-size: 13px;
}

.progress-wrapper {
  margin-bottom: 10px;
}

.status-text {
  font-size: 13px;
  color: rgba(255, 255, 255, 0.7);
  text-align: center;
}
</style>
