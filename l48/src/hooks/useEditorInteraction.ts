import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  DynamicObject,
  EditorInteractionState,
  GizmoState,
  Vec3,
  RaycastHit,
  Mat4,
} from '@/types';
import { mat4, vec3, mathUtils } from '@/utils/math';
import { OcclusionCalculator } from '@/renderer/OcclusionCalculator';
import { DynamicObjectManager } from '@/renderer/DynamicObjectManager';

export interface UseEditorInteractionOptions {
  canvas: HTMLCanvasElement | null;
  objects: ReadonlyMap<string, DynamicObject>;
  objectManager: DynamicObjectManager | null;
  occlusionCalculator: OcclusionCalculator | null;
  getViewMatrix: () => Mat4;
  getProjectionMatrix: () => Mat4;
  getCameraPosition: () => Vec3;
}

export interface UseEditorInteractionReturn {
  state: EditorInteractionState;
  selectedObject: DynamicObject | null;
  hoveredObject: DynamicObject | null;
  selectObject: (id: string | null) => void;
  setGizmoMode: (mode: 'translate' | 'rotate' | 'scale') => void;
  screenToWorld: (screenX: number, screenY: number, depth: number) => Vec3;
  worldToScreen: (worldPos: Vec3) => { x: number; y: number; depth: number };
  raycast: (screenX: number, screenY: number) => RaycastHit | null;
  enableInteraction: () => void;
  disableInteraction: () => void;
}

const defaultGizmoState: GizmoState = {
  active: false,
  mode: 'translate',
  axis: null,
  startPosition: [0, 0, 0],
  startRotation: [0, 0, 0],
  startScale: [1, 1, 1],
  startMouse: { x: 0, y: 0 },
};

const defaultState: EditorInteractionState = {
  selectedObjectId: null,
  hoveredObjectId: null,
  gizmo: defaultGizmoState,
  isDragging: false,
  isPanning: false,
  isOrbiting: false,
  lastMousePosition: { x: 0, y: 0 },
};

export function useEditorInteraction(options: UseEditorInteractionOptions): UseEditorInteractionReturn {
  const {
    canvas,
    objects,
    objectManager,
    occlusionCalculator,
    getViewMatrix,
    getProjectionMatrix,
    getCameraPosition,
  } = options;

  const [state, setState] = useState<EditorInteractionState>(defaultState);
  const [isEnabled, setIsEnabled] = useState(true);
  const interactionEnabledRef = useRef(true);

  const raycastCache = useRef<{
    x: number;
    y: number;
    result: RaycastHit | null;
    timestamp: number;
  } | null>(null);

  useEffect(() => {
    interactionEnabledRef.current = isEnabled;
  }, [isEnabled]);

  const selectedObject = useCallback((): DynamicObject | null => {
    if (!state.selectedObjectId) return null;
    return objects.get(state.selectedObjectId) || null;
  }, [state.selectedObjectId, objects]);

  const hoveredObject = useCallback((): DynamicObject | null => {
    if (!state.hoveredObjectId) return null;
    return objects.get(state.hoveredObjectId) || null;
  }, [state.hoveredObjectId, objects]);

  const selectObject = useCallback((id: string | null): void => {
    objectManager?.selectObject(id);
    setState(prev => ({ ...prev, selectedObjectId: id }));
  }, [objectManager]);

  const setGizmoMode = useCallback((mode: 'translate' | 'rotate' | 'scale'): void => {
    setState(prev => ({
      ...prev,
      gizmo: { ...prev.gizmo, mode },
    }));
  }, []);

  const screenToWorld = useCallback((
    screenX: number,
    screenY: number,
    depth: number = 0
  ): Vec3 => {
    if (!canvas) return [0, 0, 0];

    const rect = canvas.getBoundingClientRect();
    const x = ((screenX - rect.left) / rect.width) * 2 - 1;
    const y = -((screenY - rect.top) / rect.height) * 2 + 1;

    const projectionMatrix = getProjectionMatrix();
    const viewMatrix = getViewMatrix();

    const clipPoint: Vec3 = [x, y, depth * 2 - 1];
    const invProjection = mat4.inverse(projectionMatrix);
    const invView = mat4.inverse(viewMatrix);

    const viewPoint = mat4.transformPoint(invProjection, clipPoint);
    const worldPoint = mat4.transformPoint(invView, viewPoint);

    return worldPoint;
  }, [canvas, getProjectionMatrix, getViewMatrix]);

  const worldToScreen = useCallback((
    worldPos: Vec3
  ): { x: number; y: number; depth: number } => {
    if (!canvas) return { x: 0, y: 0, depth: 0 };

    const rect = canvas.getBoundingClientRect();
    const projectionMatrix = getProjectionMatrix();
    const viewMatrix = getViewMatrix();

    const viewPos = mat4.transformPoint(viewMatrix, worldPos);
    const clipPos = mat4.transformPoint(projectionMatrix, viewPos);

    const x = (clipPos[0] + 1) * 0.5 * rect.width + rect.left;
    const y = (1 - clipPos[1]) * 0.5 * rect.height + rect.top;
    const depth = (clipPos[2] + 1) * 0.5;

    return { x, y, depth };
  }, [canvas, getProjectionMatrix, getViewMatrix]);

  const raycast = useCallback((
    screenX: number,
    screenY: number
  ): RaycastHit | null => {
    if (!occlusionCalculator || !interactionEnabledRef.current) return null;

    const now = performance.now();
    if (
      raycastCache.current &&
      raycastCache.current.x === screenX &&
      raycastCache.current.y === screenY &&
      now - raycastCache.current.timestamp < 16
    ) {
      return raycastCache.current.result;
    }

    const cameraPos = getCameraPosition();
    const nearPoint = screenToWorld(screenX, screenY, 0);
    const farPoint = screenToWorld(screenX, screenY, 1);
    const direction = vec3.normalize(vec3.sub(farPoint, cameraPos));

    const objectArray = Array.from(objects.values()).filter(o => o.isVisible);
    const result = occlusionCalculator.raycast(cameraPos, direction, objectArray, 100);

    raycastCache.current = {
      x: screenX,
      y: screenY,
      result,
      timestamp: now,
    };

    return result;
  }, [occlusionCalculator, objects, getCameraPosition, screenToWorld]);

  const handleMouseDown = useCallback((e: MouseEvent): void => {
    if (!interactionEnabledRef.current || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (e.button === 0) {
      const hit = raycast(e.clientX, e.clientY);

      if (hit) {
        selectObject(hit.objectId);

        const obj = objects.get(hit.objectId);
        if (obj) {
          setState(prev => ({
            ...prev,
            isDragging: true,
            gizmo: {
              ...prev.gizmo,
              active: true,
              startPosition: [...obj.position] as Vec3,
              startRotation: [...obj.rotation] as Vec3,
              startScale: [...obj.scale] as Vec3,
              startMouse: { x, y },
            },
          }));
        }
      } else {
        selectObject(null);
      }
    } else if (e.button === 1) {
      e.preventDefault();
      setState(prev => ({
        ...prev,
        isPanning: true,
        lastMousePosition: { x: e.clientX, y: e.clientY },
      }));
    } else if (e.button === 2) {
      e.preventDefault();
      setState(prev => ({
        ...prev,
        isOrbiting: true,
        lastMousePosition: { x: e.clientX, y: e.clientY },
      }));
    }
  }, [canvas, raycast, selectObject, objects]);

  const handleMouseMove = useCallback((e: MouseEvent): void => {
    if (!interactionEnabledRef.current || !canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const hit = raycast(e.clientX, e.clientY);
    const hoveredId = hit?.objectId || null;

    setState(prev => {
      let newState = { ...prev };

      if (hoveredId !== prev.hoveredObjectId) {
        newState.hoveredObjectId = hoveredId;
        canvas.style.cursor = hoveredId ? 'pointer' : 'default';
      }

      if (prev.isDragging && prev.selectedObjectId && prev.gizmo.active) {
        const obj = objects.get(prev.selectedObjectId);
        if (obj) {
          const deltaX = (x - prev.gizmo.startMouse.x) * 0.01;
          const deltaY = (y - prev.gizmo.startMouse.y) * 0.01;

          if (prev.gizmo.mode === 'translate') {
            const newPosition: Vec3 = [
              prev.gizmo.startPosition[0] + deltaX,
              prev.gizmo.startPosition[1] - deltaY,
              prev.gizmo.startPosition[2],
            ];
            objectManager?.updateObject(prev.selectedObjectId, { position: newPosition });
          } else if (prev.gizmo.mode === 'rotate') {
            const newRotation: Vec3 = [
              prev.gizmo.startRotation[0],
              prev.gizmo.startRotation[1] + deltaX,
              prev.gizmo.startRotation[2],
            ];
            objectManager?.updateObject(prev.selectedObjectId, { rotation: newRotation });
          } else if (prev.gizmo.mode === 'scale') {
            const scaleFactor = 1 + deltaX * 0.1;
            const newScale: Vec3 = [
              Math.max(0.01, prev.gizmo.startScale[0] * scaleFactor),
              Math.max(0.01, prev.gizmo.startScale[1] * scaleFactor),
              Math.max(0.01, prev.gizmo.startScale[2] * scaleFactor),
            ];
            objectManager?.updateObject(prev.selectedObjectId, { scale: newScale });
          }
        }
      }

      newState.lastMousePosition = { x: e.clientX, y: e.clientY };
      return newState;
    });
  }, [canvas, raycast, objects, objectManager]);

  const handleMouseUp = useCallback((e: MouseEvent): void => {
    setState(prev => ({
      ...prev,
      isDragging: false,
      isPanning: false,
      isOrbiting: false,
      gizmo: {
        ...prev.gizmo,
        active: false,
        axis: null,
      },
    }));
  }, []);

  const handleWheel = useCallback((e: WheelEvent): void => {
    if (!interactionEnabledRef.current) return;
    e.preventDefault();
  }, []);

  const handleContextMenu = useCallback((e: MouseEvent): void => {
    e.preventDefault();
  }, []);

  useEffect(() => {
    if (!canvas || !isEnabled) return;

    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);
    canvas.addEventListener('mouseleave', handleMouseUp);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('contextmenu', handleContextMenu);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      canvas.removeEventListener('mouseleave', handleMouseUp);
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [canvas, isEnabled, handleMouseDown, handleMouseMove, handleMouseUp, handleWheel, handleContextMenu]);

  const enableInteraction = useCallback((): void => {
    setIsEnabled(true);
  }, []);

  const disableInteraction = useCallback((): void => {
    setIsEnabled(false);
    if (canvas) {
      canvas.style.cursor = 'default';
    }
  }, [canvas]);

  return {
    state,
    selectedObject: selectedObject(),
    hoveredObject: hoveredObject(),
    selectObject,
    setGizmoMode,
    screenToWorld,
    worldToScreen,
    raycast,
    enableInteraction,
    disableInteraction,
  };
}

export default useEditorInteraction;
