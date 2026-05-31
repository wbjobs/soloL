import { create } from 'zustand';
import type { BrushSettings, BrushShape, LabelDefinition } from '../types';

interface AnnotationState {
  currentLabelId: number;
  brushSettings: BrushSettings;
  selectedPoints: Set<number>;
  labels: LabelDefinition[];
  isBrushActive: boolean;
}

interface AnnotationActions {
  setCurrentLabelId: (labelId: number) => void;
  setBrushShape: (shape: BrushShape) => void;
  setBrushSize: (size: number) => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  addSelectedPoint: (pointIndex: number) => void;
  removeSelectedPoint: (pointIndex: number) => void;
  setSelectedPoints: (points: Set<number>) => void;
  clearSelectedPoints: () => void;
  setLabels: (labels: LabelDefinition[]) => void;
  addLabel: (label: LabelDefinition) => void;
  updateLabel: (labelId: number, updates: Partial<LabelDefinition>) => void;
  setBrushActive: (active: boolean) => void;
  reset: () => void;
}

const defaultBrushSettings: BrushSettings = {
  shape: 'sphere',
  size: 0.5,
  labelId: 0,
};

const defaultLabels: LabelDefinition[] = [
  { id: 0, name: '未标注', color: '#808080' },
  { id: 1, name: '汽车', color: '#FF0000' },
  { id: 2, name: '行人', color: '#00FF00' },
  { id: 3, name: '自行车', color: '#0000FF' },
  { id: 4, name: '树木', color: '#008000' },
  { id: 5, name: '建筑', color: '#800080' },
  { id: 6, name: '道路', color: '#808000' },
  { id: 7, name: '植被', color: '#008080' },
];

export const useAnnotationStore = create<AnnotationState & AnnotationActions>((set) => ({
  currentLabelId: 1,
  brushSettings: { ...defaultBrushSettings, labelId: 1 },
  selectedPoints: new Set(),
  labels: defaultLabels,
  isBrushActive: false,

  setCurrentLabelId: (labelId) =>
    set((state) => ({
      currentLabelId: labelId,
      brushSettings: { ...state.brushSettings, labelId },
    })),

  setBrushShape: (shape) =>
    set((state) => ({
      brushSettings: { ...state.brushSettings, shape },
    })),

  setBrushSize: (size) =>
    set((state) => ({
      brushSettings: { ...state.brushSettings, size },
    })),

  setBrushSettings: (settings) =>
    set((state) => ({
      brushSettings: { ...state.brushSettings, ...settings },
    })),

  addSelectedPoint: (pointIndex) =>
    set((state) => {
      const newSelected = new Set(state.selectedPoints);
      newSelected.add(pointIndex);
      return { selectedPoints: newSelected };
    }),

  removeSelectedPoint: (pointIndex) =>
    set((state) => {
      const newSelected = new Set(state.selectedPoints);
      newSelected.delete(pointIndex);
      return { selectedPoints: newSelected };
    }),

  setSelectedPoints: (points) => set({ selectedPoints: points }),
  clearSelectedPoints: () => set({ selectedPoints: new Set() }),
  setLabels: (labels) => set({ labels }),

  addLabel: (label) =>
    set((state) => ({
      labels: [...state.labels, label],
    })),

  updateLabel: (labelId, updates) =>
    set((state) => ({
      labels: state.labels.map((l) =>
        l.id === labelId ? { ...l, ...updates } : l
      ),
    })),

  setBrushActive: (active) => set({ isBrushActive: active }),

  reset: () =>
    set({
      currentLabelId: 1,
      brushSettings: { ...defaultBrushSettings, labelId: 1 },
      selectedPoints: new Set(),
      isBrushActive: false,
    }),
}));
