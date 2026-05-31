import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const msg = err.response?.data?.error || err.response?.data?.message || err.message || '请求失败';
    console.error('[API Error]', msg);
    return Promise.reject(err);
  }
);

export const getEquipmentByQr = (code) => api.get(`/equipment/qr/${encodeURIComponent(code)}`);

export const getEquipmentList = () => api.get('/equipment');

export const getEquipment = (id) => api.get(`/equipment/${id}`);

export const createEquipment = (data) => api.post('/equipment', data);

export const getInspections = (equipmentId) => api.get('/inspections', { params: { equipment_id: equipmentId } });

export const getInspection = (id) => api.get(`/inspections/${id}`);

export const createInspection = (data) => api.post('/inspections', data);

export const updateInspection = (id, data) => api.put(`/inspections/${id}`, data);

export const getDefects = (inspectionId) => api.get('/defects', { params: { inspection_id: inspectionId } });

export const createDefect = (formData) =>
  api.post('/defects', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 30000,
  });

export const getLatestSensorData = (equipmentId) => api.get(`/sensor/${equipmentId}/latest`);

export const getSensorHistory = (equipmentId, from, to) =>
  api.get(`/sensor/${equipmentId}/history`, { params: { from, to } });

export const getReportUrl = (inspectionId) => `/api/report/${inspectionId}`;

export const planInspectionRoute = (data) => api.post('/path-planning/plan', data);

export const getFactoryGraph = () => api.get('/path-planning/graph');

export const updateFactoryGraph = (data) => api.put('/path-planning/graph', data);

export const getNavigationStep = (data) => api.post('/path-planning/navigation', data);

export default api;
