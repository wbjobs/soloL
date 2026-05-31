import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  DynamicObject,
  Vec3,
  Mat4,
  LightSource,
  DynamicObjectManagerStats,
  BoundingBox,
  BoundingSphere,
  OcclusionResult,
  DynamicObjectState,
} from '@/types';
import { DynamicObjectManager } from '@/renderer/DynamicObjectManager';
import { OcclusionCalculator } from '@/renderer/OcclusionCalculator';
import { DepthRenderer } from '@/renderer/DepthRenderer';

export interface UseDynamicObjectOptions {
  autoUpdate?: boolean;
  enableOcclusion?: boolean;
}

export interface UseDynamicObjectReturn {
  objects: ReadonlyMap<string, DynamicObject>;
  selectedObjectId: string | null;
  selectedObject: DynamicObject | undefined;
  addObject: (obj: {
    name: string;
    position: Vec3;
    rotation: Vec3;
    scale: Vec3;
    geometryType: DynamicObject['geometryType'];
    material: Partial<DynamicObject['material']>;
    isStatic?: boolean;
    isVisible?: boolean;
    layerMask?: number;
    id?: string;
    modelMatrix?: Mat4;
    vertices?: Float32Array;
    indices?: Uint16Array;
    normals?: Float32Array;
  }) => DynamicObject;
  removeObject: (id: string) => boolean;
  updateObject: (id: string, updates: Partial<DynamicObject>) => DynamicObject | null;
  getObject: (id: string) => DynamicObject | undefined;
  selectObject: (id: string | null) => void;
  getBoundingBox: (obj: DynamicObject) => BoundingBox;
  getBoundingSphere: (obj: DynamicObject) => BoundingSphere;
  getOcclusionResult: (objectId: string) => OcclusionResult | undefined;
  getAllOcclusionResults: () => ReadonlyMap<string, OcclusionResult>;
  stats: DynamicObjectManagerStats;
  occlusionStats: {
    occlusionTime: number;
    raycastCount: number;
    drawCalls: number;
    renderTime: number;
  };
  objectManager: DynamicObjectManager | null;
  occlusionCalculator: OcclusionCalculator | null;
  depthRenderer: DepthRenderer | null;
  initialize: (gl: WebGL2RenderingContext) => boolean;
  setCamera: (
    viewMatrix: Mat4,
    projectionMatrix: Mat4,
    cameraPosition: Vec3,
    near: number,
    far: number
  ) => void;
  calculateOcclusion: (lights: LightSource[]) => Map<string, OcclusionResult>;
  dispose: () => void;
}

export function useDynamicObject(options: UseDynamicObjectOptions = {}): UseDynamicObjectReturn {
  const { autoUpdate = true, enableOcclusion = true } = options;

  const objectManagerRef = useRef<DynamicObjectManager | null>(null);
  const depthRendererRef = useRef<DepthRenderer | null>(null);
  const occlusionCalculatorRef = useRef<OcclusionCalculator | null>(null);

  const [objects, setObjects] = useState<ReadonlyMap<string, DynamicObject>>(new Map());
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [occlusionResults, setOcclusionResults] = useState<Map<string, OcclusionResult>>(new Map());
  const [stats, setStats] = useState<DynamicObjectManagerStats>({
    objectCount: 0,
    dynamicObjectCount: 0,
    staticObjectCount: 0,
    visibleObjectCount: 0,
  });
  const [occlusionStats, setOcclusionStats] = useState({
    occlusionTime: 0,
    raycastCount: 0,
    drawCalls: 0,
    renderTime: 0,
  });

  useEffect(() => {
    objectManagerRef.current = new DynamicObjectManager();
    depthRendererRef.current = new DepthRenderer(objectManagerRef.current);
    occlusionCalculatorRef.current = new OcclusionCalculator(
      objectManagerRef.current,
      depthRendererRef.current
    );

    const unsubscribe = objectManagerRef.current.subscribe((state: DynamicObjectState) => {
      setObjects(new Map(state.objects));
      setSelectedObjectId(state.selectedObjectId);
      if (objectManagerRef.current) {
        setStats(objectManagerRef.current.getStats());
      }
    });

    return () => {
      unsubscribe();
      if (occlusionCalculatorRef.current) {
        occlusionCalculatorRef.current.dispose();
      }
      objectManagerRef.current = null;
      depthRendererRef.current = null;
      occlusionCalculatorRef.current = null;
    };
  }, []);

  const selectedObject = useMemo(() => {
    return selectedObjectId ? objects.get(selectedObjectId) : undefined;
  }, [objects, selectedObjectId]);

  const initialize = useCallback((gl: WebGL2RenderingContext): boolean => {
    if (!occlusionCalculatorRef.current) return false;
    return occlusionCalculatorRef.current.initialize(gl);
  }, []);

  const setCamera = useCallback((
    viewMatrix: Mat4,
    projectionMatrix: Mat4,
    cameraPosition: Vec3,
    near: number,
    far: number
  ): void => {
    occlusionCalculatorRef.current?.setCamera(
      viewMatrix,
      projectionMatrix,
      cameraPosition,
      near,
      far
    );
  }, []);

  const addObject = useCallback((
    obj: {
      name: string;
      position: Vec3;
      rotation: Vec3;
      scale: Vec3;
      geometryType: DynamicObject['geometryType'];
      material: Partial<DynamicObject['material']>;
      isStatic?: boolean;
      isVisible?: boolean;
      layerMask?: number;
      id?: string;
      modelMatrix?: Mat4;
      vertices?: Float32Array;
      indices?: Uint16Array;
      normals?: Float32Array;
    }
  ): DynamicObject => {
    if (!objectManagerRef.current) {
      throw new Error('DynamicObjectManager not initialized');
    }

    const defaultObj = {
      isStatic: false,
      isVisible: true,
      layerMask: 1,
      ...obj,
      material: {
        baseColor: [1, 1, 1, 1] as const,
        emissive: [0, 0, 0] as const,
        roughness: 0.5,
        metallic: 0,
        castShadow: true,
        receiveShadow: true,
        ...obj.material,
      },
    };

    const newObj = objectManagerRef.current.addObject(defaultObj);
    if (autoUpdate) {
      setStats(objectManagerRef.current.getStats());
    }
    return newObj;
  }, [autoUpdate]);

  const removeObject = useCallback((id: string): boolean => {
    if (!objectManagerRef.current) return false;
    const result = objectManagerRef.current.removeObject(id);
    if (result && autoUpdate) {
      setStats(objectManagerRef.current.getStats());
      setOcclusionResults(prev => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    }
    return result;
  }, [autoUpdate]);

  const updateObject = useCallback((id: string, updates: Partial<DynamicObject>): DynamicObject | null => {
    if (!objectManagerRef.current) return null;
    const result = objectManagerRef.current.updateObject(id, updates);
    if (result && autoUpdate) {
      setStats(objectManagerRef.current.getStats());
    }
    return result;
  }, [autoUpdate]);

  const getObject = useCallback((id: string): DynamicObject | undefined => {
    return objectManagerRef.current?.getObject(id);
  }, []);

  const selectObject = useCallback((id: string | null): void => {
    objectManagerRef.current?.selectObject(id);
  }, []);

  const getBoundingBox = useCallback((obj: DynamicObject): BoundingBox => {
    if (!objectManagerRef.current) {
      return {
        min: [0, 0, 0],
        max: [0, 0, 0],
        center: [0, 0, 0],
        size: [0, 0, 0],
      };
    }
    return objectManagerRef.current.computeObjectBoundingBox(obj);
  }, []);

  const getBoundingSphere = useCallback((obj: DynamicObject): BoundingSphere => {
    if (!objectManagerRef.current) {
      return { center: [0, 0, 0], radius: 0 };
    }
    return objectManagerRef.current.computeObjectBoundingSphere(obj);
  }, []);

  const getOcclusionResult = useCallback((objectId: string): OcclusionResult | undefined => {
    return occlusionResults.get(objectId);
  }, [occlusionResults]);

  const getAllOcclusionResults = useCallback((): ReadonlyMap<string, OcclusionResult> => {
    return occlusionResults;
  }, [occlusionResults]);

  const calculateOcclusion = useCallback((lights: any[]): Map<string, OcclusionResult> => {
    if (!occlusionCalculatorRef.current || !objectManagerRef.current || !enableOcclusion) {
      return new Map();
    }

    const dynamicObjects = objectManagerRef.current.getDynamicObjects();
    const staticObjects = objectManagerRef.current.getStaticObjects();

    const results = occlusionCalculatorRef.current.calculateOcclusion(
      dynamicObjects,
      staticObjects,
      lights
    );

    setOcclusionResults(new Map(results));
    setOcclusionStats(occlusionCalculatorRef.current.getStats());

    return results;
  }, [enableOcclusion]);

  const dispose = useCallback((): void => {
    occlusionCalculatorRef.current?.dispose();
  }, []);

  return {
    objects,
    selectedObjectId,
    selectedObject,
    addObject,
    removeObject,
    updateObject,
    getObject,
    selectObject,
    getBoundingBox,
    getBoundingSphere,
    getOcclusionResult,
    getAllOcclusionResults,
    stats,
    occlusionStats,
    objectManager: objectManagerRef.current,
    occlusionCalculator: occlusionCalculatorRef.current,
    depthRenderer: depthRendererRef.current,
    initialize,
    setCamera,
    calculateOcclusion,
    dispose,
  };
}

export default useDynamicObject;
