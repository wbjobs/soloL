import axios from 'axios'

const api = axios.create({
  baseURL: '/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
})

api.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const message = error.response?.data?.detail || error.message || '请求失败'
    return Promise.reject(new Error(message))
  }
)

export interface CaseElement {
  id: string
  name: string
  type: string
  value: any
  editable: boolean
  metadata?: Record<string, any>
}

export interface CaseData {
  id: string
  title: string
  description: string
  case_type: string
  status: string
  created_at: string
  elements: CaseElement[]
}

export interface GraphEntity {
  id: string
  label: string
  type: string
  properties: Record<string, any>
}

export interface GraphRelation {
  id: string
  source: string
  target: string
  type: string
  properties: Record<string, any>
}

export interface ReasoningResult {
  success: boolean
  case_id: string
  original_verdict: string
  alternative_verdict: string
  reasoning_path: any[]
  confidence: number
  differences: any[]
  relevant_laws: any[]
  relevant_cases: any[]
}

export interface SearchResult {
  id: string
  title: string
  content: string
  similarity: number
  type: string
  metadata?: Record<string, any>
}

export interface SimilarCaseResult {
  case_id: string
  title: string
  score: number
  similarity_type: string
  details?: Record<string, any>
}

export interface Annotation {
  id: string
  case_id: string
  content: string
  author: string
  author_id: string
  type: string
  resolved: boolean
  replies: any[]
  created_at: string
  updated_at: string
  position?: Record<string, any>
}

export interface JudgmentResult {
  success: boolean
  case_id: string
  template_type: string
  judgment_text: string
  fill_data: Record<string, any>
}

export const caseApi = {
  create: (data: { title: string; description: string; case_type: string }) =>
    api.post('/cases', data),
  list: (page = 1, pageSize = 20, caseType?: string) =>
    api.get('/cases', { params: { page, page_size: pageSize, case_type: caseType } }),
  get: (id: string) =>
    api.get(`/cases/${id}`),
  delete: (id: string) =>
    api.delete(`/cases/${id}`),
  uploadText: (id: string, content: string) =>
    api.post(`/cases/${id}/upload-text`, { content }),
  uploadImage: (id: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post(`/cases/${id}/upload-image`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  uploadAudio: (id: string, file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post(`/cases/${id}/upload-audio`, formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
}

export const graphApi = {
  getFull: (limit = 200) =>
    api.get('/graph/full', { params: { limit } }),
  getCaseGraph: (caseId: string) =>
    api.get(`/graph/case/${caseId}`),
  getEntity: (entityId: string) =>
    api.get(`/graph/entity/${entityId}`),
  getEntities: (entityType: string, page = 1, pageSize = 20) =>
    api.get('/graph/entities', { params: { entity_type: entityType, page, page_size: pageSize } }),
  findPath: (startId: string, endId: string) =>
    api.get('/graph/path', { params: { start_id: startId, end_id: endId } }),
  getStats: () =>
    api.get('/graph/stats'),
}

export const reasoningApi = {
  counterfactual: (data: { case_id: string; modified_elements: any[]; reasoning_depth?: number }) =>
    api.post('/reasoning/counterfactual', data),
  preview: (caseId: string) =>
    api.get(`/reasoning/preview/${caseId}`),
}

export const searchApi = {
  legal: (data: { query: string; search_type?: string; limit?: number }) =>
    api.post('/search/legal', data),
  suggest: (query: string, limit = 5) =>
    api.get('/search/suggest', { params: { query, limit } }),
}

export const recommendationApi = {
  getSimilarCases: (caseId: string, limit = 10, method = 'hybrid') =>
    api.get(`/recommendation/similar/${caseId}`, { params: { limit, method } }),
  getRecommendations: (caseType?: string, limit = 10) =>
    api.get('/recommendation/recommend', { params: { case_type: caseType, limit } }),
}

export const annotationApi = {
  getAnnotations: (caseId: string) =>
    api.get(`/annotation/${caseId}`),
  addAnnotation: (caseId: string, annotation: Partial<Annotation>) =>
    api.post(`/annotation/${caseId}`, annotation),
  updateAnnotation: (caseId: string, annotationId: string, updates: any) =>
    api.put(`/annotation/${caseId}/${annotationId}`, updates),
  deleteAnnotation: (caseId: string, annotationId: string) =>
    api.delete(`/annotation/${caseId}/${annotationId}`),
  addReply: (caseId: string, annotationId: string, reply: any) =>
    api.post(`/annotation/${caseId}/${annotationId}/reply`, reply),
  resolveAnnotation: (caseId: string, annotationId: string, resolved = true) =>
    api.patch(`/annotation/${caseId}/${annotationId}/resolve`, {}, { params: { resolved } }),
  getStats: (caseId: string) =>
    api.get(`/annotation/${caseId}/stats`),
  getOnlineUsers: (caseId: string) =>
    api.get(`/annotation/${caseId}/online`),
  getWebSocketUrl: (caseId: string, userId: string, userName: string) => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    return `${protocol}//${host}/api/v1/annotation/ws/${caseId}?user_id=${userId}&user_name=${encodeURIComponent(userName)}`
  },
}

export const judgmentApi = {
  getTemplates: () =>
    api.get('/judgment/templates'),
  getPreview: (caseId: string) =>
    api.get(`/judgment/preview/${caseId}`),
  generate: (caseId: string, templateType = 'auto', customData?: any) =>
    api.post(`/judgment/generate/${caseId}`, { template_type: templateType, custom_data: customData }),
  download: (caseId: string, templateType = 'auto', customData?: any) =>
    api.post(`/judgment/generate/${caseId}/download`, { template_type: templateType, custom_data: customData }, { responseType: 'blob' }),
}

export default api
