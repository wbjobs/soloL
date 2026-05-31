import type { ActionType } from "./behavior";

export interface AnnotationDetection {
  id: string;
  bbox: [number, number, number, number];
  confidence: number;
  label: string;
  actionLabel?: ActionType;
  isCorrection: boolean;
}

export interface CollabAnnotation {
  id: string;
  sourceId: string;
  annotatorId: string;
  timestamp: Date;
  frameData?: string;
  detections: AnnotationDetection[];
  version: number;
  status: "draft" | "committed" | "training";
  createdAt: Date;
  updatedAt: Date;
}

export type CollabAnnotationMessage = {
  type: "annotation-draw" | "annotation-update" | "annotation-delete" | "annotation-commit";
  annotationId: string;
  sourceId: string;
  annotatorId: string;
  payload: any;
  version: number;
};
