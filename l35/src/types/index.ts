export * from './behavior.js';
export * from './annotation.js';

export interface VideoSource {
  id: string;
  name: string;
  type: "file" | "rtsp";
  url?: string;
  status: "connecting" | "live" | "error" | "offline";
  resolution?: string;
  bitrate?: number;
  createdAt: string;
}

export interface Detection {
  bbox: [number, number, number, number];
  confidence: number;
  classId: number;
  label: string;
}

export interface DetectionRegionResult {
  regionId: string;
  insideCount: number;
  breached: boolean;
}

export interface DetectionReport {
  sourceId: string;
  timestamp: string;
  detections: Detection[];
  count: number;
  regions: DetectionRegionResult[];
}

export interface DefenseRegionRules {
  maxPeople: number;
  direction: "in" | "out" | "both";
  schedule: { start: string; end: string };
}

export interface DefenseRegion {
  id: string;
  sourceId: string;
  name: string;
  polygon: Array<{ x: number; y: number }>;
  rules: DefenseRegionRules;
  enabled: boolean;
  createdAt: string;
}

export interface Alert {
  id: string;
  regionId: string;
  sourceId: string;
  timestamp: string;
  type: "breach" | "overcrowd";
  snapshot: string;
  details: string;
  read: boolean;
}

export interface HeatmapData {
  sourceId: string;
  timeRange: { start: string; end: string };
  grid: number[][];
  maxDensity: number;
}

export interface SignalingMessage {
  type: "offer" | "answer" | "ice-candidate";
  sourceId: string;
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

export interface PoseKeypoint {
  x: number;
  y: number;
  confidence: number;
}

export interface PoseData {
  bbox: [number, number, number, number];
  keypoints: PoseKeypoint[];
  confidence: number;
}

export interface AnomalyEvent {
  id: string;
  sourceId: string;
  timestamp: string;
  type: "anomaly";
  label: string;
  bbox: [number, number, number, number];
  confidence: number;
  poseData?: PoseData;
  severity: "low" | "medium" | "high";
}

export interface Annotation {
  id: string;
  sourceId: string;
  annotatorId: string;
  type: "bbox" | "polygon" | "line";
  label: string;
  bbox?: [number, number, number, number];
  points?: Array<{ x: number; y: number }>;
  metadata?: Record<string, any>;
  version: number;
  createdAt: string;
  updatedAt: string;
  committed: boolean;
}

export interface SnapshotCompareData {
  sourceId: string;
  baseline: {
    timestamp: string;
    detections: Detection[];
  };
  current: {
    timestamp: string;
    detections: Detection[];
  };
  differences: {
    newDetections: Detection[];
    changedDetections: {
      old: Detection;
      new: Detection;
    }[];
  };
}
