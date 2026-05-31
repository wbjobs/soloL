import { defineStore } from 'pinia'
import { ref } from 'vue'
import { caseApi, type CaseData } from '@/composables/useApi'

export const useCaseStore = defineStore('case', () => {
  const cases = ref<CaseData[]>([])
  const currentCase = ref<CaseData | null>(null)
  const loading = ref(false)
  const total = ref(0)

  async function fetchCases(page = 1, pageSize = 20, caseType?: string) {
    loading.value = true
    try {
      const res: any = await caseApi.list(page, pageSize, caseType)
      cases.value = res.items || []
      total.value = res.total || 0
    } catch (e) {
      console.error('获取案件列表失败:', e)
    } finally {
      loading.value = false
    }
  }

  async function createCase(data: { title: string; description: string; case_type: string }) {
    loading.value = true
    try {
      const res: any = await caseApi.create(data)
      currentCase.value = res
      return res
    } catch (e) {
      console.error('创建案件失败:', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function fetchCase(id: string) {
    loading.value = true
    try {
      const res: any = await caseApi.get(id)
      currentCase.value = res
      return res
    } catch (e) {
      console.error('获取案件详情失败:', e)
      throw e
    } finally {
      loading.value = false
    }
  }

  async function uploadText(caseId: string, content: string) {
    try {
      const res: any = await caseApi.uploadText(caseId, content)
      if (currentCase.value && currentCase.value.id === caseId) {
        currentCase.value.elements = res.elements || currentCase.value.elements
      }
      return res
    } catch (e) {
      console.error('上传文本失败:', e)
      throw e
    }
  }

  async function uploadImage(caseId: string, file: File) {
    try {
      const res: any = await caseApi.uploadImage(caseId, file)
      return res
    } catch (e) {
      console.error('上传图片失败:', e)
      throw e
    }
  }

  async function uploadAudio(caseId: string, file: File) {
    try {
      const res: any = await caseApi.uploadAudio(caseId, file)
      return res
    } catch (e) {
      console.error('上传音频失败:', e)
      throw e
    }
  }

  async function deleteCase(id: string) {
    try {
      await caseApi.delete(id)
      cases.value = cases.value.filter(c => c.id !== id)
    } catch (e) {
      console.error('删除案件失败:', e)
      throw e
    }
  }

  return {
    cases,
    currentCase,
    loading,
    total,
    fetchCases,
    createCase,
    fetchCase,
    uploadText,
    uploadImage,
    uploadAudio,
    deleteCase,
  }
})
