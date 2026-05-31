import { api } from './api';

export interface ControversialPoint {
  id: string;
  pointCloudId: string;
  pointIndex: number;
  entropy: number;
  labelDistribution: Record<number, number>;
  annotatorCount: number;
  lastAssessed: string;
  isResolved: boolean;
}

export interface QualityAssessment {
  id: string;
  pointCloudId: string;
  krippendorffAlpha: number;
  overallEntropy: number;
  controversialPointCount: number;
  assessmentDate: string;
  details: {
    annotatedPointCount: number;
    totalAnnotations: number;
    qualityLevel: 'excellent' | 'good' | 'poor';
  };
  needsReview: boolean;
}

export interface CollaborativeSession {
  id: string;
  pointCloudId: string;
  hostUserId: string;
  sessionName: string;
  isActive: boolean;
  createdAt: string;
  endedAt: string | null;
  participants: Array<{ userId: string; joinedAt: string }>;
}

export interface LabelOperation {
  id: string;
  pointIndex: number;
  labelId: number;
  userId: string;
  role: string;
  rolePriority: number;
  timestamp: string;
  lamportClock: number;
  isDeleted: boolean;
}

export interface CollaborationStats {
  totalOperations: number;
  annotatedPoints: number;
  activeOperations: number;
  userContributions: Record<string, {
    count: number;
    role: string;
    roleLabel: string;
    name: string;
  }>;
  lamportClock: number;
}

export const collaborationAPI = {
  addLabels: async (pointCloudId: string, pointIndices: number[], labelId: number) => {
    const response = await api.post(`/collaboration/${pointCloudId}/labels`, {
      pointIndices,
      labelId,
    });
    return response.data;
  },

  deleteLabels: async (pointCloudId: string, pointIndices: number[]) => {
    const response = await api.delete(`/collaboration/${pointCloudId}/labels`, {
      data: { pointIndices },
    });
    return response.data;
  },

  getResolvedLabels: async (pointCloudId: string) => {
    const response = await api.get(`/collaboration/${pointCloudId}/labels/resolved`);
    return response.data;
  },

  getAnnotations: async (pointCloudId: string) => {
    const response = await api.get(`/collaboration/${pointCloudId}/annotations`);
    return response.data;
  },

  getPointAnnotations: async (pointCloudId: string, pointIndex: number) => {
    const response = await api.get(`/collaboration/${pointCloudId}/annotations/${pointIndex}`);
    return response.data;
  },

  syncOperations: async (pointCloudId: string, operations: LabelOperation[]) => {
    const response = await api.post(`/collaboration/${pointCloudId}/sync`, {
      operations,
    });
    return response.data;
  },

  getOperationsSince: async (pointCloudId: string, sinceClock: number) => {
    const response = await api.get(`/collaboration/${pointCloudId}/sync/${sinceClock}`);
    return response.data;
  },

  assessQuality: async (pointCloudId: string, alphaThreshold = 0.6, entropyThreshold = 0.8) => {
    const response = await api.post(`/collaboration/${pointCloudId}/quality`, {
      alphaThreshold,
      entropyThreshold,
    });
    return response.data;
  },

  getQualityHistory: async (pointCloudId: string) => {
    const response = await api.get(`/collaboration/${pointCloudId}/quality`);
    return response.data;
  },

  getControversialPoints: async (pointCloudId: string, includeResolved = false, limit = 1000) => {
    const response = await api.get(`/collaboration/${pointCloudId}/controversial-points`, {
      params: { includeResolved, limit },
    });
    return response.data;
  },

  resolveControversialPoint: async (pointCloudId: string, pointIndex: number, finalLabel: number) => {
    const response = await api.post(`/collaboration/${pointCloudId}/controversial-points/${pointIndex}/resolve`, {
      finalLabel,
    });
    return response.data;
  },

  getStatistics: async (pointCloudId: string) => {
    const response = await api.get(`/collaboration/${pointCloudId}/statistics`);
    return response.data;
  },

  createSession: async (pointCloudId: string, sessionName?: string) => {
    const response = await api.post(`/collaboration/${pointCloudId}/sessions`, {
      sessionName,
    });
    return response.data;
  },

  getSessions: async (pointCloudId: string) => {
    const response = await api.get(`/collaboration/${pointCloudId}/sessions`);
    return response.data;
  },

  getSession: async (pointCloudId: string, sessionId: string) => {
    const response = await api.get(`/collaboration/${pointCloudId}/sessions/${sessionId}`);
    return response.data;
  },

  sendOffer: async (pointCloudId: string, sessionId: string, offer: RTCSessionDescriptionInit) => {
    const response = await api.post(`/collaboration/${pointCloudId}/sessions/${sessionId}/offer`, {
      offer,
    });
    return response.data;
  },

  sendAnswer: async (pointCloudId: string, sessionId: string, answer: RTCSessionDescriptionInit) => {
    const response = await api.post(`/collaboration/${pointCloudId}/sessions/${sessionId}/answer`, {
      answer,
    });
    return response.data;
  },

  sendIceCandidate: async (pointCloudId: string, sessionId: string, candidate: RTCIceCandidateInit) => {
    const response = await api.post(`/collaboration/${pointCloudId}/sessions/${sessionId}/ice`, {
      candidate,
    });
    return response.data;
  },

  endSession: async (pointCloudId: string, sessionId: string) => {
    const response = await api.delete(`/collaboration/${pointCloudId}/sessions/${sessionId}`);
    return response.data;
  },
};

export default collaborationAPI;
