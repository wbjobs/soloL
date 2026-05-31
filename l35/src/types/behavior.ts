export type ActionType = "normal" | "fall" | "chasing" | "running" | "loitering";

export interface Keypose {
  x: number;
  y: number;
  confidence: number;
}

export interface FramePoses {
  frameIndex: number;
  poses: Keypose[][];
}

export interface ActionPrediction {
  frameIndex: number;
  action: ActionType;
  confidence: number;
}

export interface BehaviorAnomalyEvent {
  id: string;
  timestamp: Date;
  action: ActionType;
  confidence: number;
  bbox: [number, number, number, number];
  snapshot?: string;
}
