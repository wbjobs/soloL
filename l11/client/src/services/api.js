import axios from 'axios';

const API_BASE = '/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
});

export const uploadFiles = async (files) => {
  const formData = new FormData();
  files.forEach(file => {
    formData.append('files', file);
  });
  
  const response = await api.post('/analyses/upload', formData);
  return response.data;
};

export const getBatchStatus = async (batchId) => {
  const response = await api.get(`/analyses/batch/${batchId}`);
  return response.data;
};

export const getAnalysisStatus = async (analysisId) => {
  try {
    const response = await api.get(`/analyses/status/${analysisId}`);
    return response.data;
  } catch (err) {
    if (err.response?.status === 404) {
      return { status: 'not_found', error: 'Analysis not found' };
    }
    throw err;
  }
};

export const getQueueStats = async () => {
  const response = await api.get('/analyses/queue/stats');
  return response.data;
};

export const getAnalysisList = async (limit = 20, offset = 0) => {
  const response = await api.get('/analyses', {
    params: { limit, offset },
  });
  return response.data;
};

export const getAnalysis = async (id) => {
  const response = await api.get(`/analyses/${id}`);
  return response.data;
};

export const getWaveform = async (id, bins = 200) => {
  const response = await api.get(`/analyses/${id}/waveform`, {
    params: { bins },
  });
  return response.data;
};

export const exportAnalysis = async (id) => {
  const response = await api.get(`/analyses/${id}/export`, {
    responseType: 'blob',
  });
  return response.data;
};

export const exportBatch = async (ids) => {
  const response = await api.post('/analyses/export/batch', 
    { ids },
    { responseType: 'blob' }
  );
  return response.data;
};

export const deleteAnalysis = async (id) => {
  const response = await api.delete(`/analyses/${id}`);
  return response.data;
};

export const compareAnalyses = async (analysisId1, analysisId2) => {
  const response = await api.post('/analyses/compare', {
    analysis_id1: analysisId1,
    analysis_id2: analysisId2,
  });
  return response.data;
};

export const searchAnalysesByTags = async (query, limit = 20) => {
  const response = await api.get('/analyses/compare/search', {
    params: { q: query, limit },
  });
  return response.data;
};

export const downloadBlob = (blob, filename) => {
  const url = window.URL.createObjectURL(new Blob([blob]));
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export default api;
