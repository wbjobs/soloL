import { useCallback, useRef, useState, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { Point3D, BrushShape } from '../types';
import { Octree, SpatialGrid, filterBackFacingPoints } from '../utils/spatialIndex';

interface UseBrushToolOptions {
  points: Float32Array | null;
  pointsObjectRef: React.RefObject<THREE.Points | null>;
  raycasterRef: React.RefObject<THREE.Raycaster | null>;
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  onPointsSelected?: (indices: number[]) => void;
  onPointsApplied?: (indices: number[], labelId: number) => void;
  enableBackFaceCulling?: boolean;
}

interface UseBrushToolReturn {
  isPainting: boolean;
  brushPosition: Point3D | null;
  brushPreviewVisible: boolean;
  selectedPointCount: number;
  startPainting: () => void;
  stopPainting: () => void;
  applyBrush: (labelId: number) => void;
  setBrushShape: (shape: BrushShape) => void;
  setBrushSize: (size: number) => void;
  clearSelection: () => void;
  handleMouseMove: (event: MouseEvent) => void;
  setEnableBackFaceCulling: (enabled: boolean) => void;
  enableBackFaceCulling: boolean;
}

export const useBrushTool = (
  options: UseBrushToolOptions
): UseBrushToolReturn => {
  const {
    points,
    pointsObjectRef,
    raycasterRef,
    cameraRef,
    onPointsSelected,
    onPointsApplied,
    enableBackFaceCulling: initialBackFaceCulling = true,
  } = options;

  const [isPainting, setIsPainting] = useState(false);
  const [brushPosition, setBrushPosition] = useState<Point3D | null>(null);
  const [brushPreviewVisible, setBrushPreviewVisible] = useState(false);
  const [selectedPointCount, setSelectedPointCount] = useState(0);
  const [brushShape, setBrushShape] = useState<BrushShape>('sphere');
  const [brushSize, setBrushSize] = useState(0.5);
  const [enableBackFaceCulling, setEnableBackFaceCulling] = useState(initialBackFaceCulling);

  const selectedPointsRef = useRef<Set<number>>(new Set());
  const lastIntersectionRef = useRef<THREE.Vector3 | null>(null);
  const debounceTimerRef = useRef<number | null>(null);

  const spatialIndex = useMemo(() => {
    if (!points) return null;
    const pointCount = points.length / 3;
    if (pointCount > 100000) {
      return new SpatialGrid(points, brushSize * 2);
    }
    return new Octree(points, 8, 500);
  }, [points, brushSize]);

  const getPointAtMouse = useCallback(
    (event: MouseEvent): Point3D | null => {
      if (
        !raycasterRef.current ||
        !cameraRef.current ||
        !pointsObjectRef.current
      ) {
        return null;
      }

      const rect = event.currentTarget as HTMLElement;
      const boundingRect = rect.getBoundingClientRect();
      const x = ((event.clientX - boundingRect.left) / boundingRect.width) * 2 - 1;
      const y = -((event.clientY - boundingRect.top) / boundingRect.height) * 2 + 1;

      raycasterRef.current.setFromCamera(new THREE.Vector2(x, y), cameraRef.current);
      const intersects = raycasterRef.current.intersectObject(pointsObjectRef.current);

      if (intersects.length > 0) {
        const point = intersects[0].point;
        return { x: point.x, y: point.y, z: point.z };
      }

      return null;
    },
    [raycasterRef, cameraRef, pointsObjectRef]
  );

  const findPointsInBrushFast = useCallback(
    (position: Point3D): number[] => {
      if (!points || !spatialIndex || !cameraRef.current) return [];

      const center = new THREE.Vector3(position.x, position.y, position.z);
      const cameraPosition = cameraRef.current.position.clone();
      let indices: number[];

      if (brushShape === 'sphere') {
        indices = spatialIndex.querySphere(center, brushSize);
      } else {
        const halfSize = brushSize / 2;
        const min = new THREE.Vector3(
          position.x - halfSize,
          position.y - halfSize,
          position.z - halfSize
        );
        const max = new THREE.Vector3(
          position.x + halfSize,
          position.y + halfSize,
          position.z + halfSize
        );
        indices = spatialIndex.queryBox(min, max);
      }

      if (enableBackFaceCulling && indices.length > 0) {
        indices = filterBackFacingPoints(indices, points, cameraPosition, center, 0.1);
      }

      return indices;
    },
    [points, brushShape, brushSize, spatialIndex, cameraRef, enableBackFaceCulling]
  );

  const handleMouseMove = useCallback(
    (event: MouseEvent) => {
      const position = getPointAtMouse(event);

      if (position) {
        setBrushPosition(position);
        setBrushPreviewVisible(true);
        lastIntersectionRef.current = new THREE.Vector3(position.x, position.y, position.z);

        if (isPainting) {
          if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
          }
          
          debounceTimerRef.current = window.setTimeout(() => {
            const indices = findPointsInBrushFast(position);
            indices.forEach((idx) => selectedPointsRef.current.add(idx));
            setSelectedPointCount(selectedPointsRef.current.size);

            if (onPointsSelected) {
              onPointsSelected(Array.from(selectedPointsRef.current));
            }
          }, 16);
        }
      } else {
        setBrushPreviewVisible(false);
      }
    },
    [getPointAtMouse, isPainting, findPointsInBrushFast, onPointsSelected]
  );

  const startPainting = useCallback(() => {
    selectedPointsRef.current.clear();
    setSelectedPointCount(0);
    setIsPainting(true);
  }, []);

  const stopPainting = useCallback(() => {
    setIsPainting(false);
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const applyBrush = useCallback(
    (labelId: number) => {
      const indices = Array.from(selectedPointsRef.current);
      if (indices.length === 0) return;

      if (onPointsApplied) {
        onPointsApplied(indices, labelId);
      }

      selectedPointsRef.current.clear();
      setSelectedPointCount(0);
    },
    [onPointsApplied]
  );

  const clearSelection = useCallback(() => {
    selectedPointsRef.current.clear();
    setSelectedPointCount(0);
    if (onPointsSelected) {
      onPointsSelected([]);
    }
  }, [onPointsSelected]);

  useEffect(() => {
    return () => {
      stopPainting();
    };
  }, [stopPainting]);

  return {
    isPainting,
    brushPosition,
    brushPreviewVisible,
    selectedPointCount,
    startPainting,
    stopPainting,
    applyBrush,
    setBrushShape,
    setBrushSize,
    clearSelection,
    handleMouseMove,
    setEnableBackFaceCulling,
    enableBackFaceCulling,
  };
};

export default useBrushTool;
