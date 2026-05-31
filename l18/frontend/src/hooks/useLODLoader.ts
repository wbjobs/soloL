import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import type { PointCloudChunk, LODLevel } from '../types';
import { isChunkInFrustum, distanceToChunk, getLODLevelForDistance } from '../utils/chunkUtils';
import { pointCloudAPI } from '../services/pointCloud';

interface UseLODLoaderOptions {
  pointCloudId: string | null;
  cameraRef: React.RefObject<THREE.PerspectiveCamera | null>;
  sceneRef: React.RefObject<THREE.Scene | null>;
  chunkSize?: number;
  lodDistances?: number[];
  maxLoadedChunks?: number;
  onChunkLoaded?: (chunk: PointCloudChunk) => void;
  onChunkUnloaded?: (chunkId: string) => void;
}

interface UseLODLoaderReturn {
  loadedChunks: Map<string, PointCloudChunk>;
  visibleChunks: Set<string>;
  loadingChunks: Set<string>;
  currentLOD: LODLevel;
  isLoading: boolean;
  updateLOD: () => void;
  forceLoadChunk: (chunkId: string, lodLevel: LODLevel) => Promise<void>;
  unloadAllChunks: () => void;
}

export const useLODLoader = (
  options: UseLODLoaderOptions
): UseLODLoaderReturn => {
  const {
    pointCloudId,
    cameraRef,
    sceneRef,
    lodDistances = [10, 30, 60, 100],
    maxLoadedChunks = 50,
    onChunkLoaded,
    onChunkUnloaded,
  } = options;

  const [loadedChunks, setLoadedChunks] = useState<Map<string, PointCloudChunk>>(new Map());
  const [visibleChunks, setVisibleChunks] = useState<Set<string>>(new Set());
  const [loadingChunks, setLoadingChunks] = useState<Set<string>>(new Set());
  const [currentLOD, setCurrentLOD] = useState<LODLevel>(1);
  const [isLoading, setIsLoading] = useState(false);

  const animationFrameRef = useRef<number | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const chunkObjectsRef = useRef<Map<string, THREE.Points>>(new Map());

  const getCameraPos = useCallback(() => cameraRef.current?.position.clone() || null, [cameraRef]);
  const getViewProjMatrix = useCallback(() => {
    if (!cameraRef.current) return null;
    return new THREE.Matrix4().multiplyMatrices(
      cameraRef.current.projectionMatrix,
      cameraRef.current.matrixWorldInverse
    );
  }, [cameraRef]);

  const createChunkMesh = useCallback((chunk: PointCloudChunk): THREE.Points => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(chunk.points, 3));
    if (chunk.colors) {
      geometry.setAttribute('color', new THREE.BufferAttribute(chunk.colors, 3));
    }
    const material = new THREE.PointsMaterial({
      size: 0.1,
      vertexColors: !!chunk.colors,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.name = chunk.id;
    points.frustumCulled = false;
    return points;
  }, []);

  const loadChunkData = useCallback(
    async (chunkId: string, lodLevel: LODLevel): Promise<PointCloudChunk | null> => {
      if (!pointCloudId || loadingChunks.has(chunkId)) return null;
      setLoadingChunks((prev) => new Set(prev).add(chunkId));
      setIsLoading(true);
      try {
        const chunk = await pointCloudAPI.loadChunk(pointCloudId, chunkId, lodLevel);
        setLoadedChunks((prev) => {
          const newMap = new Map(prev);
          newMap.set(chunkId, chunk);
          return newMap;
        });
        if (sceneRef.current) {
          const mesh = createChunkMesh(chunk);
          chunkObjectsRef.current.set(chunkId, mesh);
          sceneRef.current.add(mesh);
        }
        onChunkLoaded?.(chunk);
        return chunk;
      } catch (error) {
        console.error(`Failed to load chunk ${chunkId}:`, error);
        return null;
      } finally {
        setLoadingChunks((prev) => {
          const newSet = new Set(prev);
          newSet.delete(chunkId);
          return newSet;
        });
        setIsLoading((prev) => loadingChunks.size > 1 || prev);
      }
    },
    [pointCloudId, loadingChunks, sceneRef, createChunkMesh, onChunkLoaded]
  );

  const unloadChunk = useCallback(
    (chunkId: string) => {
      setLoadedChunks((prev) => {
        const newMap = new Map(prev);
        newMap.delete(chunkId);
        return newMap;
      });
      const mesh = chunkObjectsRef.current.get(chunkId);
      if (mesh && sceneRef.current) {
        sceneRef.current.remove(mesh);
        mesh.geometry.dispose();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose());
        } else {
          mesh.material.dispose();
        }
        chunkObjectsRef.current.delete(chunkId);
      }
      onChunkUnloaded?.(chunkId);
    },
    [sceneRef, onChunkUnloaded]
  );

  const unloadAllChunks = useCallback(() => {
    loadedChunks.forEach((_, chunkId) => unloadChunk(chunkId));
    setVisibleChunks(new Set());
    setLoadedChunks(new Map());
    chunkObjectsRef.current.clear();
  }, [loadedChunks, unloadChunk]);

  const updateLOD = useCallback(() => {
    const cameraPos = getCameraPos();
    const viewMatrix = getViewProjMatrix();
    if (!cameraPos || !viewMatrix || !pointCloudId) return;

    const cameraPosition = { x: cameraPos.x, y: cameraPos.y, z: cameraPos.z };
    const distance = Math.sqrt(
      cameraPosition.x ** 2 + cameraPosition.y ** 2 + cameraPosition.z ** 2
    );
    const newLOD = getLODLevelForDistance(distance, lodDistances) as LODLevel;
    setCurrentLOD(newLOD);

    const newVisibleChunks = new Set<string>();
    loadedChunks.forEach((chunk, chunkId) => {
      if (isChunkInFrustum(chunk, viewMatrix)) newVisibleChunks.add(chunkId);
    });
    setVisibleChunks(newVisibleChunks);

    const loadedArray = Array.from(loadedChunks.entries());
    if (loadedArray.length > maxLoadedChunks) {
      const sorted = loadedArray.sort((a, b) => {
        const distA = distanceToChunk(cameraPosition, a[1]);
        const distB = distanceToChunk(cameraPosition, b[1]);
        return distB - distA;
      });
      sorted.slice(maxLoadedChunks).forEach(([chunkId]) => {
        if (!newVisibleChunks.has(chunkId)) unloadChunk(chunkId);
      });
    }
  }, [getCameraPos, getViewProjMatrix, pointCloudId, lodDistances, loadedChunks, maxLoadedChunks, unloadChunk]);

  const forceLoadChunk = useCallback(
    async (chunkId: string, lodLevel: LODLevel) => {
      await loadChunkData(chunkId, lodLevel);
    },
    [loadChunkData]
  );

  useEffect(() => {
    const animate = () => {
      const now = performance.now();
      if (now - lastUpdateRef.current > 500) {
        updateLOD();
        lastUpdateRef.current = now;
      }
      animationFrameRef.current = requestAnimationFrame(animate);
    };
    animationFrameRef.current = requestAnimationFrame(animate);
    return () => {
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [updateLOD]);

  useEffect(() => () => unloadAllChunks(), [unloadAllChunks]);

  return {
    loadedChunks,
    visibleChunks,
    loadingChunks,
    currentLOD,
    isLoading,
    updateLOD,
    forceLoadChunk,
    unloadAllChunks,
  };
};

export default useLODLoader;
