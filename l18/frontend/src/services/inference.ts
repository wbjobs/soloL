import { api, handleApiError } from './api';

export interface ModelInfo {
  name: string;
  num_classes: number;
  batch_size: number;
  use_gpu: boolean;
  gpu_device: string | null;
  inference_time_ms: number;
}

export interface PredictRequest {
  pointCloudId: string;
  pointIndices?: number[];
  batchSize?: number;
}

export interface PredictRectRequest {
  pointCloudId: string;
  bounds: {
    min: [number, number, number];
    max: [number, number, number];
  };
  batchSize?: number;
}

export interface AutoSegmentRequest {
  pointCloudId: string;
  seedPointIndex: number;
  k?: number;
  batchSize?: number;
}

export interface Prediction {
  pointIndex: number;
  predictedLabel: number;
  confidence: number;
}

export interface PredictResult {
  predictions: Prediction[];
  processingTime: number;
  totalPoints: number;
  batchSize: number;
  predictedLabel?: number;
  historyId?: string;
}

export const inferenceAPI = {
  predict: async (
    request: PredictRequest
  ): Promise<PredictResult> => {
    try {
      const response = await api.post<PredictResult>(
        '/inference/predict',
        request
      );
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  predictRect: async (
    request: PredictRectRequest
  ): Promise<PredictResult> => {
    try {
      const response = await api.post<PredictResult>(
        '/inference/predict-rect',
        request
      );
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  autoSegment: async (
    request: AutoSegmentRequest
  ): Promise<PredictResult> => {
    try {
      const response = await api.post<PredictResult>(
        '/inference/auto-segment',
        request
      );
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  getModelInfo: async (): Promise<ModelInfo> => {
    try {
      const response = await api.get<ModelInfo>('/inference/model-info');
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  warmup: async (): Promise<{ success: boolean; warmup_time_ms: number }> => {
    try {
      const response = await api.post<{ success: boolean; warmup_time_ms: number }>(
        '/inference/warmup'
      );
      return response.data;
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },

  applyPredictions: async (
    pointCloudId: string,
    predictions: Array<{ pointIndex: number; labelId: number; confidence: number }>,
    threshold: number = 0.7
  ): Promise<void> => {
    const filtered = predictions.filter(p => p.confidence >= threshold);
    const updates = filtered.map(p => ({
      pointIndices: [p.pointIndex],
      labelId: p.labelId,
    }));

    try {
      await api.put(`/point-clouds/${pointCloudId}/labels`, { updates });
    } catch (error) {
      throw new Error(handleApiError(error));
    }
  },
};
