import { create } from 'zustand';
import type { BoardData, CurrentSource, FieldType, HeatSource, SimParams, SimulationResult } from '@/types';

type ToolType = 'select' | 'resistor' | 'ic_chip' | 'custom';

interface CanvasState {
  zoom: number;
  panX: number;
  panY: number;
}

interface AppState {
  boardData: BoardData | null;
  heatSources: HeatSource[];
  currentSources: CurrentSource[];
  simParams: SimParams;
  simResult: SimulationResult | null;
  isLoading: boolean;
  selectedTool: ToolType;
  canvasState: CanvasState;
  selectedHeatSourceId: string | null;
  selectedLayer: number;
  fieldType: FieldType;

  setBoardData: (data: BoardData | null) => void;
  addHeatSource: (source: HeatSource) => void;
  removeHeatSource: (id: string) => void;
  updateHeatSource: (id: string, updates: Partial<HeatSource>) => void;
  addCurrentSource: (source: CurrentSource) => void;
  removeCurrentSource: (name: string) => void;
  setSimParams: (params: Partial<SimParams>) => void;
  setSimResult: (result: SimulationResult | null) => void;
  setIsLoading: (loading: boolean) => void;
  setSelectedTool: (tool: ToolType) => void;
  setCanvasState: (state: Partial<CanvasState>) => void;
  setSelectedHeatSourceId: (id: string | null) => void;
  setSelectedLayer: (layer: number) => void;
  setFieldType: (type: FieldType) => void;
  resetSimulation: () => void;
}

const defaultSimParams: SimParams = {
  ambient_temp: 25,
  board_thickness: 1.6,
  copper_thickness: 1,
  convection_coeff: 10,
  max_iterations: 5000,
  convergence: 0.01,
  grid_resolution: 0.5,
  enable_current_simulation: false,
  joule_heating_coupling: true,
};

export const useStore = create<AppState>((set) => ({
  boardData: null,
  heatSources: [],
  currentSources: [],
  simParams: defaultSimParams,
  simResult: null,
  isLoading: false,
  selectedTool: 'select',
  canvasState: { zoom: 1, panX: 0, panY: 0 },
  selectedHeatSourceId: null,
  selectedLayer: 0,
  fieldType: 'temperature',

  setBoardData: (data) => set({ boardData: data, simResult: null, selectedLayer: 0 }),

  addHeatSource: (source) =>
    set((state) => ({ heatSources: [...state.heatSources, source] })),

  removeHeatSource: (id) =>
    set((state) => ({
      heatSources: state.heatSources.filter((s) => s.id !== id),
      selectedHeatSourceId:
        state.selectedHeatSourceId === id ? null : state.selectedHeatSourceId,
    })),

  updateHeatSource: (id, updates) =>
    set((state) => ({
      heatSources: state.heatSources.map((s) =>
        s.id === id ? { ...s, ...updates } : s
      ),
    })),

  addCurrentSource: (source) =>
    set((state) => ({ currentSources: [...state.currentSources, source] })),

  removeCurrentSource: (name) =>
    set((state) => ({
      currentSources: state.currentSources.filter((s) => s.name !== name),
    })),

  setSimParams: (params) =>
    set((state) => ({ simParams: { ...state.simParams, ...params } })),

  setSimResult: (result) => set({ simResult: result }),

  setIsLoading: (loading) => set({ isLoading: loading }),

  setSelectedTool: (tool) => set({ selectedTool: tool }),

  setCanvasState: (state) =>
    set((prev) => ({ canvasState: { ...prev.canvasState, ...state } })),

  setSelectedHeatSourceId: (id) => set({ selectedHeatSourceId: id }),

  setSelectedLayer: (layer) => set({ selectedLayer: layer }),

  setFieldType: (type) => set({ fieldType: type }),

  resetSimulation: () =>
    set({
      simResult: null,
      heatSources: [],
      currentSources: [],
      selectedHeatSourceId: null,
      selectedLayer: 0,
    }),
}));
