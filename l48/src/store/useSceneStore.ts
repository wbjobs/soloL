import { create } from 'zustand';
import type {
  Vec3,
  LightSource,
  SceneObject,
  SceneConfig,
  VoxelGridData,
  RenderStats,
  VoxelTextureFormat,
} from '@/types';

interface SceneState {
  camera: {
    position: Vec3;
    target: Vec3;
    up: Vec3;
    fov: number;
    near: number;
    far: number;
  };
  config: SceneConfig;
  lights: LightSource[];
  objects: SceneObject[];
  voxelData: VoxelGridData | null;
  voxelFormat: VoxelTextureFormat;
  stats: RenderStats;
  isInitialized: boolean;
  isRunning: boolean;
  selectedObjectId: string | null;
  selectedLightId: string | null;

  setCamera: (camera: Partial<SceneState['camera']>) => void;
  setConfig: (config: Partial<SceneConfig>) => void;
  addLight: (light: LightSource) => void;
  removeLight: (id: string) => void;
  updateLight: (id: string, updates: Partial<LightSource>) => void;
  setLights: (lights: LightSource[]) => void;
  addObject: (obj: SceneObject) => void;
  removeObject: (id: string) => void;
  updateObject: (id: string, updates: Partial<SceneObject>) => void;
  setObjects: (objects: SceneObject[]) => void;
  setVoxelData: (data: VoxelGridData | null) => void;
  setVoxelFormat: (format: VoxelTextureFormat) => void;
  setStats: (stats: Partial<RenderStats>) => void;
  setInitialized: (initialized: boolean) => void;
  setRunning: (running: boolean) => void;
  selectObject: (id: string | null) => void;
  selectLight: (id: string | null) => void;
  resetScene: () => void;
}

const defaultConfig: SceneConfig = {
  backgroundColor: [0.1, 0.1, 0.15],
  ambientIntensity: 0.2,
  exposure: 1.0,
  gamma: 2.2,
  vct: {
    voxelResolution: 128,
    voxelSize: 0.1,
    voxelGridSize: [10, 10, 10],
    voxelGridCenter: [0, 0, 0],
    maxCones: 6,
    coneStepSize: 0.1,
    coneMaxSteps: 64,
    coneAperture: 0.57,
    indirectIntensity: 1.0,
    aoIntensity: 1.0,
  },
};

const defaultCamera: SceneState['camera'] = {
  position: [0, 2, 5],
  target: [0, 0, 0],
  up: [0, 1, 0],
  fov: Math.PI / 4,
  near: 0.1,
  far: 100,
};

const defaultStats: RenderStats = {
  fps: 0,
  frameTime: 0,
  drawCalls: 0,
  triangles: 0,
  voxelMemory: 0,
};

const generateId = (): string => {
  return Math.random().toString(36).substring(2, 11);
};

export const useSceneStore = create<SceneState>((set, get) => ({
  camera: defaultCamera,
  config: defaultConfig,
  lights: [],
  objects: [],
  voxelData: null,
  voxelFormat: 'RGBA8',
  stats: defaultStats,
  isInitialized: false,
  isRunning: false,
  selectedObjectId: null,
  selectedLightId: null,

  setCamera: (camera) => set((state) => ({
    camera: { ...state.camera, ...camera },
  })),

  setConfig: (config) => set((state) => ({
    config: {
      ...state.config,
      ...config,
      vct: {
        ...state.config.vct,
        ...config.vct,
      },
    },
  })),

  addLight: (light) => set((state) => ({
    lights: [...state.lights, { ...light, id: light.id || generateId() }].slice(0, 8),
  })),

  removeLight: (id) => set((state) => ({
    lights: state.lights.filter((l) => l.id !== id),
    selectedLightId: state.selectedLightId === id ? null : state.selectedLightId,
  })),

  updateLight: (id, updates) => set((state) => ({
    lights: state.lights.map((l) =>
      l.id === id ? { ...l, ...updates } : l
    ),
  })),

  setLights: (lights) => set(() => ({
    lights: lights.slice(0, 8).map((l) => ({ ...l, id: l.id || generateId() })),
  })),

  addObject: (obj) => set((state) => ({
    objects: [...state.objects, { ...obj, id: obj.id || generateId() }],
  })),

  removeObject: (id) => set((state) => ({
    objects: state.objects.filter((o) => o.id !== id),
    selectedObjectId: state.selectedObjectId === id ? null : state.selectedObjectId,
  })),

  updateObject: (id, updates) => set((state) => ({
    objects: state.objects.map((o) =>
      o.id === id ? { ...o, ...updates } : o
    ),
  })),

  setObjects: (objects) => set(() => ({
    objects: objects.map((o) => ({ ...o, id: o.id || generateId() })),
  })),

  setVoxelData: (data) => set(() => ({
    voxelData: data,
  })),

  setVoxelFormat: (format) => set(() => ({
    voxelFormat: format,
  })),

  setStats: (stats) => set((state) => ({
    stats: { ...state.stats, ...stats },
  })),

  setInitialized: (initialized) => set(() => ({
    isInitialized: initialized,
  })),

  setRunning: (running) => set(() => ({
    isRunning: running,
  })),

  selectObject: (id) => set(() => ({
    selectedObjectId: id,
    selectedLightId: null,
  })),

  selectLight: (id) => set(() => ({
    selectedLightId: id,
    selectedObjectId: null,
  })),

  resetScene: () => set(() => ({
    camera: defaultCamera,
    config: defaultConfig,
    lights: [],
    objects: [],
    voxelData: null,
    selectedObjectId: null,
    selectedLightId: null,
  })),
}));

export const getDefaultLight = (type: LightSource['type'] = 'point'): LightSource => ({
  id: generateId(),
  type,
  position: [0, 3, 0],
  direction: [0, -1, 0],
  color: [1, 1, 1],
  intensity: 1,
  radius: 10,
  innerAngle: Math.cos(Math.PI / 6),
  outerAngle: Math.cos(Math.PI / 4),
});

export const getDefaultObject = (geometryType: SceneObject['geometryType'] = 'box'): SceneObject => ({
  id: generateId(),
  name: `${geometryType}_${Date.now()}`,
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  geometryType,
  material: {
    baseColor: [0.8, 0.8, 0.8, 1],
    emissive: [0, 0, 0],
    roughness: 0.5,
    metallic: 0,
  },
});

export const createDefaultScene = (): {
  lights: LightSource[];
  objects: SceneObject[];
} => {
  const lights: LightSource[] = [
    {
      ...getDefaultLight('directional'),
      id: 'sun',
      position: [5, 10, 5],
      direction: [-1, -2, -1],
      color: [1, 0.95, 0.9],
      intensity: 3,
    },
    {
      ...getDefaultLight('point'),
      id: 'fill',
      position: [-3, 2, 3],
      color: [0.6, 0.7, 1],
      intensity: 0.5,
      radius: 8,
    },
  ];

  const objects: SceneObject[] = [
    {
      ...getDefaultObject('plane'),
      id: 'ground',
      name: 'Ground',
      position: [0, -1, 0],
      scale: [10, 1, 10],
      material: {
        baseColor: [0.3, 0.35, 0.4, 1],
        emissive: [0, 0, 0],
        roughness: 0.8,
        metallic: 0,
      },
    },
    {
      ...getDefaultObject('box'),
      id: 'box1',
      name: 'Red Box',
      position: [-1.5, -0.5, 0],
      scale: [1, 1, 1],
      material: {
        baseColor: [0.9, 0.2, 0.2, 1],
        emissive: [0, 0, 0],
        roughness: 0.3,
        metallic: 0.1,
      },
    },
    {
      ...getDefaultObject('sphere'),
      id: 'sphere1',
      name: 'Blue Sphere',
      position: [1.5, -0.5, 0],
      scale: [1, 1, 1],
      material: {
        baseColor: [0.2, 0.4, 0.9, 1],
        emissive: [0, 0, 0],
        roughness: 0.1,
        metallic: 0.8,
      },
    },
    {
      ...getDefaultObject('box'),
      id: 'box2',
      name: 'Green Box',
      position: [0, -0.5, -2],
      scale: [1.5, 0.8, 0.5],
      material: {
        baseColor: [0.2, 0.8, 0.3, 1],
        emissive: [0, 0, 0],
        roughness: 0.6,
        metallic: 0,
      },
    },
    {
      ...getDefaultObject('box'),
      id: 'light_box',
      name: 'Emissive Light',
      position: [0, 2, -1],
      scale: [0.5, 0.5, 0.5],
      material: {
        baseColor: [1, 0.9, 0.7, 1],
        emissive: [2, 1.8, 1.4],
        roughness: 0.5,
        metallic: 0,
      },
    },
  ];

  return { lights, objects };
};

export default useSceneStore;
