import SparkMD5 from 'spark-md5'
import api from './api'

const CHUNK_SIZE = 5 * 1024 * 1024

export async function calculateFileHash(file, onProgress) {
  return new Promise((resolve, reject) => {
    const chunkSize = CHUNK_SIZE
    const chunks = Math.ceil(file.size / chunkSize)
    let currentChunk = 0
    const spark = new SparkMD5.ArrayBuffer()
    const fileReader = new FileReader()

    fileReader.onload = (e) => {
      spark.append(e.target.result)
      currentChunk++

      if (onProgress) {
        onProgress((currentChunk / chunks) * 100)
      }

      if (currentChunk < chunks) {
        loadNext()
      } else {
        resolve(spark.end())
      }
    }

    fileReader.onerror = () => {
      reject(new Error('计算文件哈希失败'))
    }

    function loadNext() {
      const start = currentChunk * chunkSize
      const end = Math.min(start + chunkSize, file.size)
      fileReader.readAsArrayBuffer(file.slice(start, end))
    }

    loadNext()
  })
}

export async function uploadFile(file, fileId, onProgress, onStatusChange) {
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE)

  const checkResponse = await api.get(`/upload/check/${fileId}`)
  let uploadedChunks = checkResponse.data.uploaded_chunks || 0

  if (checkResponse.data.completed) {
    if (onStatusChange) onStatusChange('文件已存在，跳过上传')
    return { fileId, completed: true }
  }

  if (checkResponse.data.status === 'merging') {
    await pollMergeProgress(fileId, totalChunks, onProgress, onStatusChange)
    return { fileId, completed: true }
  }

  for (let i = uploadedChunks; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, file.size)
    const chunk = file.slice(start, end)

    const formData = new FormData()
    formData.append('file', chunk, `${fileId}_${i}`)
    formData.append('file_id', fileId)
    formData.append('chunk_index', i)
    formData.append('total_chunks', totalChunks)
    formData.append('filename', file.name)
    formData.append('file_size', file.size)

    if (onStatusChange) onStatusChange(`正在上传第 ${i + 1}/${totalChunks} 块`)

    try {
      const response = await api.post('/upload/chunk', formData, {
        headers: {
          'Content-Type': 'multipart/form-data'
        },
        timeout: 300000
      })

      const uploadProgress = ((i + 1) / totalChunks) * 90
      if (onProgress) {
        onProgress(uploadProgress)
      }

      if (response.data.completed || i === totalChunks - 1) {
        await pollMergeProgress(fileId, totalChunks, onProgress, onStatusChange)
        return { fileId, completed: true }
      }
    } catch (error) {
      console.error(`上传块 ${i} 失败:`, error)
      throw error
    }
  }

  return { fileId, completed: true }
}

async function pollMergeProgress(fileId, totalChunks, onProgress, onStatusChange) {
  const maxAttempts = 360
  let attempts = 0

  while (attempts < maxAttempts) {
    try {
      const checkResponse = await api.get(`/upload/check/${fileId}`)
      const status = checkResponse.data.status
      const uploaded = checkResponse.data.uploaded_chunks || 0

      if (status === 'merging') {
        const mergeProgress = 90 + (uploaded / totalChunks) * 9
        if (onProgress) {
          onProgress(mergeProgress)
        }
        if (onStatusChange) {
          onStatusChange(`正在合并文件块 ${uploaded}/${totalChunks}...`)
        }
      } else if (checkResponse.data.completed || status === 'completed') {
        if (onProgress) {
          onProgress(100)
        }
        if (onStatusChange) {
          onStatusChange('上传完成，正在解析文件...')
        }
        await new Promise(resolve => setTimeout(resolve, 500))
        return
      } else if (status === 'failed') {
        throw new Error('文件合并失败')
      }

      attempts++
      await new Promise(resolve => setTimeout(resolve, 1000))
    } catch (error) {
      if (error.message === '文件合并失败') {
        throw error
      }
      console.error('检查合并进度失败:', error)
      attempts++
      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  throw new Error('文件合并超时，请重试')
}

export async function getFileInfo(fileId) {
  const response = await api.get(`/upload/${fileId}`)
  return response.data
}

export function generateFileId() {
  return `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}
