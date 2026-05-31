import axios from 'axios'

const API_BASE = '/api'

const api = axios.create({
  baseURL: API_BASE,
  headers: {
    'Content-Type': 'application/json'
  }
})

export const midiAPI = {
  upload: (file) => {
    const formData = new FormData()
    formData.append('file', file)
    return api.post('/midi/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data'
      }
    }).then(res => res.data)
  },

  list: () => api.get('/midi').then(res => res.data),

  getDetail: (midiId) => api.get(`/midi/${midiId}`).then(res => res.data),

  getSpectrum: (midiId) => api.get(`/midi/${midiId}/spectrum`).then(res => res.data),

  getSlicesInfo: (midiId) => api.get(`/midi/${midiId}/slices`).then(res => res.data),

  getVisibleNotes: (midiId, startTime, endTime, preloadBuffer = 2) => 
    api.get(`/midi/${midiId}/visible-notes`, {
      params: { start_time: startTime, end_time: endTime, preload_buffer: preloadBuffer }
    }).then(res => res.data),

  delete: (midiId) => api.delete(`/midi/${midiId}`).then(res => res.data)
}

export const annotationsAPI = {
  create: (annotation, clientVersion = 0) => 
    api.post('/annotations', annotation, {
      params: { client_version: clientVersion }
    }).then(res => res.data),

  list: (midiId, sinceVersion = 0) => 
    api.get(`/annotations/${midiId}`, {
      params: { since_version: sinceVersion }
    }).then(res => res.data),

  update: (annotationId, update) => 
    api.put(`/annotations/${annotationId}`, update).then(res => res.data),

  delete: (annotationId) => 
    api.delete(`/annotations/${annotationId}`).then(res => res.data),

  sync: (midiId, clientVersion = 0) =>
    api.post('/annotations/sync', {
      midi_id: midiId,
      client_version: clientVersion
    }).then(res => res.data)
}

export const exportAPI = {
  getAnnotations: (midiId) => api.get(`/export/${midiId}`).then(res => res.data),

  download: (midiId) => {
    window.open(`${API_BASE}/export/${midiId}/download`, '_blank')
  }
}

export default api
