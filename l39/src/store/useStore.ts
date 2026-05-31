import { create } from 'zustand';
import { 
  Grid3D, 
  WellTrajectory, 
  Formation, 
  SliceParams, 
  KrigingParams,
  KrigingProgress,
  AnalysisReport,
  Point3D,
  BezierControlPoints,
  SimulationResult,
  MonteCarloResult,
  Annotation,
  User,
  ViewState
} from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

interface AppState {
  grid: Grid3D | null;
  gridId: string | null;
  formations: Formation[];
  trajectories: WellTrajectory[];
  selectedTrajectoryId: string | null;
  sliceParams: SliceParams;
  showSlice: boolean;
  showModel: boolean;
  showTrajectories: boolean;
  showWireframe: boolean;
  krigingProgress: KrigingProgress | null;
  analysisReport: AnalysisReport | null;
  isAnalyzing: boolean;
  isLoadingGrid: boolean;
  isGeneratingMock: boolean;
  opacity: number;
  currentView: 'perspective' | 'top' | 'front' | 'side';
  controlPoints: Point3D[];
  controlValues: number[];
  segyFileId: string | null;
  usePotree: boolean;
  showGeosteering: boolean;
  lodThreshold: number;
  maxVisiblePoints: number;
  pointSize: number;
  currentTrajectoryPoint: Point3D | null;
  simulationResult: SimulationResult | null;
  monteCarloResult: MonteCarloResult | null;
  annotations: Annotation[];
  collaborationSessionId: string | null;
  collaborationUsers: User[];
  currentUser: User | null;
  remoteCursors: Map<string, { x: number; y: number; point?: Point3D; userName: string; userColor: string }>;
  remoteViews: Map<string, ViewState>;
  showSimulation: boolean;
  showAnnotations: boolean;
  
  setGrid: (grid: Grid3D | null) => void;
  setGridId: (id: string | null) => void;
  setFormations: (formations: Formation[]) => void;
  addTrajectory: (trajectory?: WellTrajectory) => void;
  removeTrajectory: (id: string) => void;
  updateTrajectory: (id: string, updates: Partial<WellTrajectory>) => void;
  selectTrajectory: (id: string | null) => void;
  addBezierSegment: (trajectoryId: string, segment: BezierControlPoints) => void;
  updateBezierSegment: (trajectoryId: string, segmentIndex: number, updates: Partial<BezierControlPoints>) => void;
  setSliceParams: (params: Partial<SliceParams>) => void;
  setShowSlice: (show: boolean) => void;
  setShowModel: (show: boolean) => void;
  setShowTrajectories: (show: boolean) => void;
  setShowWireframe: (show: boolean) => void;
  setKrigingProgress: (progress: KrigingProgress | null) => void;
  setAnalysisReport: (report: AnalysisReport | null) => void;
  setIsAnalyzing: (analyzing: boolean) => void;
  setIsLoadingGrid: (loading: boolean) => void;
  setIsGeneratingMock: (generating: boolean) => void;
  setOpacity: (opacity: number) => void;
  setCurrentView: (view: 'perspective' | 'top' | 'front' | 'side') => void;
  setControlPoints: (points: Point3D[], values: number[]) => void;
  setSegyFileId: (id: string | null) => void;
  setUsePotree: (use: boolean) => void;
  setShowGeosteering: (show: boolean) => void;
  setLodThreshold: (threshold: number) => void;
  setMaxVisiblePoints: (max: number) => void;
  setPointSize: (size: number) => void;
  setCurrentTrajectoryPoint: (point: Point3D | null) => void;
  setSimulationResult: (result: SimulationResult | null) => void;
  setMonteCarloResult: (result: MonteCarloResult | null) => void;
  setAnnotations: (annotations: Annotation[]) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  deleteAnnotation: (id: string) => void;
  setCollaborationSessionId: (id: string | null) => void;
  setCollaborationUsers: (users: User[] | ((prev: User[]) => User[])) => void;
  setCurrentUser: (user: User | null) => void;
  setRemoteCursor: (userId: string, cursor: { x: number; y: number; point?: Point3D; userName: string; userColor: string }) => void;
  removeRemoteCursor: (userId: string) => void;
  setRemoteView: (userId: string, view: ViewState) => void;
  setShowSimulation: (show: boolean) => void;
  setShowAnnotations: (show: boolean) => void;
  resetState: () => void;
}

const defaultSliceParams: SliceParams = {
  normal: { x: 0, y: 0, z: 1 },
  origin: { x: 0, y: 0, z: 50 },
  showGrid: false,
  showContours: false
};

const defaultKrigingParams: KrigingParams = {
  model: 'spherical',
  range: 200,
  sill: 1.0,
  nugget: 0.01,
  searchRadius: 150,
  maxNeighbors: 12
};

export const useStore = create<AppState>((set, get) => ({
  grid: null,
  gridId: null,
  formations: [],
  trajectories: [],
  selectedTrajectoryId: null,
  sliceParams: defaultSliceParams,
  showSlice: true,
  showModel: true,
  showTrajectories: true,
  showWireframe: false,
  krigingProgress: null,
  analysisReport: null,
  isAnalyzing: false,
  isLoadingGrid: false,
  isGeneratingMock: false,
  opacity: 0.7,
  currentView: 'perspective',
  controlPoints: [],
  controlValues: [],
  segyFileId: null,
  usePotree: false,
  showGeosteering: false,
  lodThreshold: 50,
  maxVisiblePoints: 200000,
  pointSize: 3,
  currentTrajectoryPoint: null,
  simulationResult: null,
  monteCarloResult: null,
  annotations: [],
  collaborationSessionId: null,
  collaborationUsers: [],
  currentUser: null,
  remoteCursors: new Map(),
  remoteViews: new Map(),
  showSimulation: false,
  showAnnotations: true,

  setGrid: (grid) => set({ grid }),
  setGridId: (id) => set({ gridId: id }),
  setFormations: (formations) => set({ formations }),

  addTrajectory: (trajectory) => {
    const defaultTrajectory: WellTrajectory = {
      id: uuidv4(),
      name: `钻井轨迹 ${get().trajectories.length + 1}`,
      color: '#ff6b35',
      segments: [
        {
          p0: { x: -300, y: -300, z: 0 },
          p1: { x: -200, y: -200, z: 20 },
          p2: { x: -100, y: -100, z: 40 },
          p3: { x: 0, y: 0, z: 50 }
        }
      ],
      samplePoints: []
    };
    
    const newTrajectory = trajectory || defaultTrajectory;
    set((state) => ({
      trajectories: [...state.trajectories, newTrajectory],
      selectedTrajectoryId: newTrajectory.id
    }));
  },

  removeTrajectory: (id) => set((state) => ({
    trajectories: state.trajectories.filter((t) => t.id !== id),
    selectedTrajectoryId: state.selectedTrajectoryId === id ? null : state.selectedTrajectoryId
  })),

  updateTrajectory: (id, updates) => set((state) => ({
    trajectories: state.trajectories.map((t) =>
      t.id === id ? { ...t, ...updates } : t
    )
  })),

  selectTrajectory: (id) => set({ selectedTrajectoryId: id }),

  addBezierSegment: (trajectoryId, segment) => set((state) => ({
    trajectories: state.trajectories.map((t) =>
      t.id === trajectoryId
        ? { ...t, segments: [...t.segments, segment] }
        : t
    )
  })),

  updateBezierSegment: (trajectoryId, segmentIndex, updates) => set((state) => ({
    trajectories: state.trajectories.map((t) => {
      if (t.id !== trajectoryId) return t;
      const newSegments = [...t.segments];
      newSegments[segmentIndex] = { ...newSegments[segmentIndex], ...updates };
      return { ...t, segments: newSegments };
    })
  })),

  setSliceParams: (params) => set((state) => ({
    sliceParams: { ...state.sliceParams, ...params }
  })),

  setShowSlice: (show) => set({ showSlice: show }),
  setShowModel: (show) => set({ showModel: show }),
  setShowTrajectories: (show) => set({ showTrajectories: show }),
  setShowWireframe: (show) => set({ showWireframe: show }),
  setKrigingProgress: (progress) => set({ krigingProgress: progress }),
  setAnalysisReport: (report) => set({ analysisReport: report }),
  setIsAnalyzing: (analyzing) => set({ isAnalyzing: analyzing }),
  setIsLoadingGrid: (loading) => set({ isLoadingGrid: loading }),
  setIsGeneratingMock: (generating) => set({ isGeneratingMock: generating }),
  setOpacity: (opacity) => set({ opacity }),
  setCurrentView: (view) => set({ currentView: view }),
  setControlPoints: (points, values) => set({ controlPoints: points, controlValues: values }),
  setSegyFileId: (id) => set({ segyFileId: id }),
  setUsePotree: (use) => set({ usePotree: use }),
  setShowGeosteering: (show) => set({ showGeosteering: show }),
  setLodThreshold: (threshold) => set({ lodThreshold: threshold }),
  setMaxVisiblePoints: (max) => set({ maxVisiblePoints: max }),
  setPointSize: (size) => set({ pointSize: size }),
  setCurrentTrajectoryPoint: (point) => set({ currentTrajectoryPoint: point }),
  setSimulationResult: (result) => set({ simulationResult: result }),
  setMonteCarloResult: (result) => set({ monteCarloResult: result }),
  setAnnotations: (annotations) => set({ annotations }),
  addAnnotation: (annotation) => set((state) => ({
    annotations: [...state.annotations, annotation]
  })),
  updateAnnotation: (id, updates) => set((state) => ({
    annotations: state.annotations.map(a =>
      a.id === id ? { ...a, ...updates, updatedAt: Date.now() } : a
    )
  })),
  deleteAnnotation: (id) => set((state) => ({
    annotations: state.annotations.filter(a => a.id !== id)
  })),
  setCollaborationSessionId: (id) => set({ collaborationSessionId: id }),
  setCollaborationUsers: (users) => set((state) => ({ 
    collaborationUsers: typeof users === 'function' ? users(state.collaborationUsers) : users 
  })),
  setCurrentUser: (user) => set({ currentUser: user }),
  setRemoteCursor: (userId, cursor) => set((state) => {
    const newCursors = new Map(state.remoteCursors);
    newCursors.set(userId, cursor);
    return { remoteCursors: newCursors };
  }),
  removeRemoteCursor: (userId) => set((state) => {
    const newCursors = new Map(state.remoteCursors);
    newCursors.delete(userId);
    return { remoteCursors: newCursors };
  }),
  setRemoteView: (userId, view) => set((state) => {
    const newViews = new Map(state.remoteViews);
    newViews.set(userId, view);
    return { remoteViews: newViews };
  }),
  setShowSimulation: (show) => set({ showSimulation: show }),
  setShowAnnotations: (show) => set({ showAnnotations: show }),

  resetState: () => set({
    grid: null,
    gridId: null,
    trajectories: [],
    selectedTrajectoryId: null,
    sliceParams: defaultSliceParams,
    showSlice: true,
    showModel: true,
    showTrajectories: true,
    showWireframe: false,
    krigingProgress: null,
    analysisReport: null,
    isAnalyzing: false,
    isLoadingGrid: false,
    isGeneratingMock: false,
    controlPoints: [],
    controlValues: [],
    segyFileId: null,
    usePotree: false,
    showGeosteering: false,
    lodThreshold: 50,
    maxVisiblePoints: 200000,
    pointSize: 3,
    currentTrajectoryPoint: null,
    simulationResult: null,
    monteCarloResult: null,
    annotations: [],
    collaborationSessionId: null,
    collaborationUsers: [],
    currentUser: null,
    remoteCursors: new Map(),
    remoteViews: new Map(),
    showSimulation: false,
    showAnnotations: true
  })
}));
