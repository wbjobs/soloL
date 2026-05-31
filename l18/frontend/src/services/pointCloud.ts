import { api, handleApiError } from './api';
import type {
  PointCloudChunk,
  LabelUpdateRequest,
  LabelDefinition,
} from '../types';

export interface PointCloudMetadata {
  id: string;
  name: string;
  filename: string;
  total_points: number;
  bounds: {
    min: { x: number; y: number; z: number };
    max: { x: number; y: number; z: number };
  };
  created_at: string;
  file_path: string;
  lod_levels: number;
  project_id: string;
}

export interface LODLevelData {
  points: number[];
  colors?: number[];
  labels?: number[];
  num_points: number;
  lodLevel: number;
}

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface LabelUpdate {
  pointIndices: number[];
  labelId: number;
}

export const pointCloudAPI = {
  upload: async (
    file: File,
    projectId: string,
    onProgress?: (progress: UploadProgress) => void
  ): Promise<PointCloudMetadata> => {
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('project_id', projectId);
      formData.append('name', file.name);

      const response = await api.post<PointCloudMetadata>(
        '/point-clouds/upload',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
          onUploadProgress: (progressEvent) => {
            if (progressEvent.total && onProgress) {
              const loaded = progressEvent.loaded;
              const total = progressEvent.total;
              onProgress({
                loaded,
                total,
                percentage: Math.round((loaded / total) * 100),
              });
            }
          },
        }
      );

      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  getMetadata: async (
    pointCloudId: string
  ): Promise<PointCloudMetadata> => {
    try {
      const response = await api.get<PointCloudMetadata>(
        `/point-clouds/${pointCloudId}`
      );
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  getList: async (projectId: string): Promise<PointCloudMetadata[]> => {
    try {
      const response = await api.get<PointCloudMetadata[]>('/point-clouds', {
        params: { project_id: projectId },
      });
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  getLODLevel: async (
    pointCloudId: string,
    lodLevel: number
  ): Promise<LODLevelData> => {
    try {
      const response = await api.get<LODLevelData>(
        `/point-clouds/${pointCloudId}/lod/${lodLevel}`
      );
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  loadChunk: async (
    pointCloudId: string,
    chunkId: string,
    lodLevel: number
  ): Promise<PointCloudChunk> => {
    try {
      const response = await api.get<PointCloudChunk>(
        `/point-clouds/${pointCloudId}/chunks/${chunkId}`,
        {
          params: { lod: lodLevel },
        }
      );

      const data = response.data;
      return {
        ...data,
        points: new Float32Array(data.points as unknown as number[]),
        colors: data.colors ? new Float32Array(data.colors as unknown as number[]) : undefined,
        labels: data.labels ? new Uint32Array(data.labels as unknown as number[]) : undefined,
      };
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  updateLabels: async (
    pointCloudId: string,
    request: { updates: LabelUpdate[] }
  ): Promise<{ message: string; changes_count: number }> => {
    try {
      const response = await api.put<{ message: string; changes_count: number }>(
        `/point-clouds/${pointCloudId}/labels`,
        request
      );
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  getLabelDefinitions: async (): Promise<LabelDefinition[]> => {
    try {
      const response = await api.get<LabelDefinition[]>('/point-clouds/label-definitions');
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  export: async (
    pointCloudId: string,
    format: 'ply' | 'kitti' | 'labels' | 'semantickitti' = 'semantickitti'
  ): Promise<Blob> => {
    try {
      const response = await api.get(`/point-clouds/${pointCloudId}/export`, {
        params: { format },
        responseType: 'blob',
      });
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  getHistory: async (pointCloudId: string) => {
    try {
      const response = await api.get(`/point-clouds/${pointCloudId}/history`);
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  undoHistory: async (pointCloudId: string, historyId: string) => {
    try {
      const response = await api.post(`/point-clouds/${pointCloudId}/history/${historyId}/undo`);
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  delete: async (pointCloudId: string): Promise<void> => {
    try {
      await api.delete(`/point-clouds/${pointCloudId}`);
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },
};
