import { create } from "zustand";
import type {
  VideoSource,
  DefenseRegion,
  Alert,
  DetectionReport,
  HeatmapData,
  Detection,
  AnomalyEvent,
  Annotation,
  SnapshotCompareData,
} from "@/types";

interface AppState {
  sources: VideoSource[];
  regions: DefenseRegion[];
  alerts: Alert[];
  selectedSourceId: string | null;
  detections: DetectionReport | null;
  heatmapData: HeatmapData | null;
  heatmapVisible: boolean;
  statsPanelOpen: boolean;
  anomalies: AnomalyEvent[];
  annotations: Annotation[];
  currentAnnotation: Annotation | null;
  isAnnotationMode: boolean;
  snapshotCompareData: SnapshotCompareData | null;
  isCompareMode: boolean;
  modelVersion: string;
  annotatorId: string;

  fetchSources: () => Promise<void>;
  fetchRegions: (sourceId: string) => Promise<void>;
  fetchAlerts: (sourceId?: string) => Promise<void>;
  setSelectedSourceId: (id: string | null) => void;
  reportDetection: (data: DetectionReport) => Promise<void>;
  fetchHeatmap: (
    sourceId: string,
    start: string,
    end: string,
    resolution: number
  ) => Promise<void>;
  toggleHeatmap: () => void;
  toggleStatsPanel: () => void;
  setDetections: (report: DetectionReport | null) => void;
  addAnomaly: (anomaly: AnomalyEvent) => void;
  clearAnomalies: () => void;
  setAnnotationMode: (enabled: boolean) => void;
  setCurrentAnnotation: (annotation: Annotation | null) => void;
  fetchAnnotations: (sourceId: string) => Promise<void>;
  createAnnotation: (annotation: Omit<Annotation, 'id'|'version'|'createdAt'|'updatedAt'>) => Promise<void>;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => Promise<void>;
  commitAnnotation: (id: string) => Promise<void>;
  deleteAnnotation: (id: string) => Promise<void>;
  fetchSnapshotCompare: (sourceId: string, time?: string) => Promise<void>;
  setCompareMode: (enabled: boolean) => void;
  uploadGradients: (gradients: any) => Promise<void>;
}

function generateAnnotatorId(): string {
  return 'annotator_' + Math.random().toString(36).substring(2, 10);
}

export const useStore = create<AppState>((set, get) => ({
  sources: [],
  regions: [],
  alerts: [],
  selectedSourceId: null,
  detections: null,
  heatmapData: null,
  heatmapVisible: false,
  statsPanelOpen: false,
  anomalies: [],
  annotations: [],
  currentAnnotation: null,
  isAnnotationMode: false,
  snapshotCompareData: null,
  isCompareMode: false,
  modelVersion: "v1.0",
  annotatorId: generateAnnotatorId(),

  fetchSources: async () => {
    try {
      const res = await fetch("/api/sources");
      const json = await res.json();
      const data = json.data ?? json;
      set({ sources: Array.isArray(data) ? data : [] });
    } catch {
      set({ sources: [] });
    }
  },

  fetchRegions: async (sourceId: string) => {
    try {
      const res = await fetch(`/api/regions?sourceId=${sourceId}`);
      const json = await res.json();
      const data = json.data ?? json;
      set({ regions: Array.isArray(data) ? data : [] });
    } catch {
      set({ regions: [] });
    }
  },

  fetchAlerts: async (sourceId?: string) => {
    try {
      const url = sourceId
        ? `/api/alerts?sourceId=${sourceId}`
        : "/api/alerts";
      const res = await fetch(url);
      const json = await res.json();
      const data = json.data ?? json;
      set({ alerts: Array.isArray(data) ? data : [] });
    } catch {
      set({ alerts: [] });
    }
  },

  setSelectedSourceId: (id: string | null) => {
    set({ selectedSourceId: id });
    if (id) {
      get().fetchRegions(id);
      get().fetchAlerts(id);
      get().fetchAnnotations(id);
    }
  },

  reportDetection: async (data: DetectionReport) => {
    try {
      await fetch("/api/detections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    } catch {}
  },

  fetchHeatmap: async (
    sourceId: string,
    start: string,
    end: string,
    resolution: number
  ) => {
    try {
      const res = await fetch(
        `/api/heatmap/${sourceId}?start=${start}&end=${end}&resolution=${resolution}`
      );
      const data = await res.json();
      set({ heatmapData: data });
    } catch {
      set({ heatmapData: null });
    }
  },

  toggleHeatmap: () => set((s) => ({ heatmapVisible: !s.heatmapVisible })),
  toggleStatsPanel: () =>
    set((s) => ({ statsPanelOpen: !s.statsPanelOpen })),
  setDetections: (report: DetectionReport | null) => set({ detections: report }),

  addAnomaly: (anomaly: AnomalyEvent) => {
    set((s) => ({
      anomalies: [...s.anomalies, anomaly].slice(-50),
    }));
  },

  clearAnomalies: () => set({ anomalies: [] }),

  setAnnotationMode: (enabled: boolean) => {
    set({ isAnnotationMode: enabled, currentAnnotation: null });
  },

  setCurrentAnnotation: (annotation: Annotation | null) => {
    set({ currentAnnotation: annotation });
  },

  fetchAnnotations: async (sourceId: string) => {
    try {
      const res = await fetch(`/api/annotations?sourceId=${sourceId}`);
      const json = await res.json();
      const data = json.data ?? json;
      set({ annotations: Array.isArray(data) ? data : [] });
    } catch {
      set({ annotations: [] });
    }
  },

  createAnnotation: async (annotation: Omit<Annotation, 'id'|'version'|'createdAt'|'updatedAt'>) => {
    try {
      const res = await fetch("/api/annotations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(annotation),
      });
      const json = await res.json();
      if (json.data || json.id) {
        get().fetchAnnotations(annotation.sourceId);
      }
    } catch {}
  },

  updateAnnotation: async (id: string, updates: Partial<Annotation>) => {
    try {
      await fetch(`/api/annotations/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      const sourceId = get().selectedSourceId;
      if (sourceId) {
        get().fetchAnnotations(sourceId);
      }
    } catch {}
  },

  commitAnnotation: async (id: string) => {
    try {
      await fetch(`/api/annotations/${id}/commit`, {
        method: "POST",
      });
      const sourceId = get().selectedSourceId;
      if (sourceId) {
        get().fetchAnnotations(sourceId);
      }
    } catch {}
  },

  deleteAnnotation: async (id: string) => {
    try {
      await fetch(`/api/annotations/${id}`, {
        method: "DELETE",
      });
      const sourceId = get().selectedSourceId;
      if (sourceId) {
        get().fetchAnnotations(sourceId);
      }
    } catch {}
  },

  fetchSnapshotCompare: async (sourceId: string, time?: string) => {
    try {
      const url = time
        ? `/api/snapshots/compare?sourceId=${sourceId}&time=${time}`
        : `/api/snapshots/compare?sourceId=${sourceId}`;
      const res = await fetch(url);
      const data = await res.json();
      set({ snapshotCompareData: data });
    } catch {
      set({ snapshotCompareData: null });
    }
  },

  setCompareMode: (enabled: boolean) => {
    set({ isCompareMode: enabled });
    if (!enabled) {
      set({ snapshotCompareData: null });
    }
  },

  uploadGradients: async (gradients: any) => {
    try {
      await fetch("/api/federated/gradients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...gradients,
          clientId: get().annotatorId,
          modelVersion: get().modelVersion,
        }),
      });
    } catch {}
  },
}));
