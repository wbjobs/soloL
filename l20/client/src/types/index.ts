export interface BlendShapes {
  [key: string]: number;
}

export interface AvatarConfig {
  id: string;
  name: string;
  modelUrl: string;
  thumbnail: string;
}

export interface BackgroundConfig {
  type: 'image' | 'video' | 'blur' | 'none';
  url?: string;
  blurAmount?: number;
}

export interface UserConfig {
  userId: string;
  background: BackgroundConfig;
  avatar: string;
  avatars: AvatarConfig[];
}

export interface PerformanceMetrics {
  fps: number;
  segmentationTime: number;
  faceMeshTime: number;
  renderTime: number;
}

export interface RoomUser {
  userId: string;
  socketId: string;
}

export type GestureType = 'fist' | 'ok' | 'victory' | 'none';

export interface GestureResult {
  gesture: GestureType;
  confidence: number;
}

export interface BackgroundUsageRecord {
  backgroundType: string;
  backgroundUrl?: string;
  durationMs: number;
  sessions: number;
}

export interface UserStatistics {
  backgroundUsage: BackgroundUsageRecord[];
  gestureCounts: Record<string, number>;
  periodDays: number;
}
