import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '../utils/api'

export const useAlignmentStore = defineStore('alignment', () => {
  const uploadedFiles = ref([])
  const selectedFile1 = ref(null)
  const selectedFile2 = ref(null)
  const currentTask = ref(null)
  const currentResult = ref(null)
  const taskProgress = ref(null)
  const wsConnected = ref(false)

  const canStartAlignment = computed(() => {
    return selectedFile1.value && selectedFile2.value && selectedFile1.value !== selectedFile2.value
  })

  async function loadFiles() {
    try {
      const response = await api.get('/upload/')
      uploadedFiles.value = response.data
    } catch (error) {
      console.error('加载文件列表失败:', error)
    }
  }

  async function startAlignment(params) {
    try {
      const response = await api.post('/alignment/start', params)
      currentTask.value = response.data
      return response.data
    } catch (error) {
      console.error('启动比对任务失败:', error)
      throw error
    }
  }

  async function getTaskProgress(taskId) {
    try {
      const response = await api.get(`/alignment/progress/${taskId}`)
      taskProgress.value = response.data
      return response.data
    } catch (error) {
      console.error('获取任务进度失败:', error)
      throw error
    }
  }

  async function getTaskResult(taskId) {
    try {
      const response = await api.get(`/alignment/result/${taskId}`)
      currentResult.value = response.data
      return response.data
    } catch (error) {
      console.error('获取比对结果失败:', error)
      throw error
    }
  }

  async function loadTasks() {
    try {
      const response = await api.get('/alignment/tasks')
      return response.data
    } catch (error) {
      console.error('加载任务列表失败:', error)
      throw error
    }
  }

  function setSelectedFile1(file) {
    selectedFile1.value = file
  }

  function setSelectedFile2(file) {
    selectedFile2.value = file
  }

  function setCurrentTask(task) {
    currentTask.value = task
  }

  function setCurrentResult(result) {
    currentResult.value = result
  }

  function setTaskProgress(progress) {
    taskProgress.value = progress
  }

  function setWsConnected(connected) {
    wsConnected.value = connected
  }

  function reset() {
    currentTask.value = null
    currentResult.value = null
    taskProgress.value = null
    wsConnected.value = false
  }

  return {
    uploadedFiles,
    selectedFile1,
    selectedFile2,
    currentTask,
    currentResult,
    taskProgress,
    wsConnected,
    canStartAlignment,
    loadFiles,
    startAlignment,
    getTaskProgress,
    getTaskResult,
    loadTasks,
    setSelectedFile1,
    setSelectedFile2,
    setCurrentTask,
    setCurrentResult,
    setTaskProgress,
    setWsConnected,
    reset
  }
})
