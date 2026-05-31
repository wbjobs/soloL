export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface PointCloudPoint extends Point3D {
  r?: number;
  g?: number;
  b?: number;
  intensity?: number;
  labelId?: number;
}

export interface PointCloudChunk {
  id: string;
  lodLevel: number;
  bounds: {
    min: Point3D;
    max: Point3D;
  };
  points: Float32Array;
  colors?: Float32Array;
  labels?: Uint32Array;
  pointCount: number;
}

export interface PointCloud {
  id: string;
  name: string;
  totalPoints: number;
  bounds: {
    min: Point3D;
    max: Point3D;
  };
  chunks: Map<string, PointCloudChunk>;
  loadedChunks: Set<string>;
  uploadDate: Date;
  fileSize: number;
}

export interface LabelDefinition {
  id: number;
  name: string;
  color: string;
  description?: string;
}

export interface LabelUpdateRequest {
  pointCloudId: string;
  pointIndices: number[];
  labelId: number;
  chunkId?: string;
}

export interface InferenceRequest {
  pointCloudId: string;
  chunkIds?: string[];
  modelName?: string;
}

export interface InferenceResponse {
  pointCloudId: string;
  predictions: Array<{
    pointIndex: number;
    labelId: number;
    confidence: number;
  }>;
  inferenceTime: number;
  modelVersion: string;
}

export type BrushShape = 'sphere' | 'cube';

export interface BrushSettings {
  shape: BrushShape;
  size: number;
  labelId: number;
}

export interface HistoryEntry {
  id: string;
  timestamp: Date;
  type: 'label' | 'inference' | 'import';
  description: string;
  beforeState: {
    pointIndices: number[];
    labelIds: number[];
  };
  afterState: {
    pointIndices: number[];
    labelIds: number[];
  };
}

export interface User {
  id: string;
  username: string;
  email: string;
}

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
}

export type LODLevel = 0 | 1 | 2 | 3;
