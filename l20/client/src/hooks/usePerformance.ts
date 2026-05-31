import { useState, useRef, useCallback } from 'react';
import { PerformanceMetrics } from '../types';

export function usePerformance() {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    fps: 0,
    segmentationTime: 0,
    faceMeshTime: 0,
    renderTime: 0
  });

  const frameCountRef = useRef(0);
  const lastFpsUpdateRef = useRef(performance.now());
  const startTimeRef = useRef<number>(0);

  const startFrame = useCallback(() => {
    startTimeRef.current = performance.now();
  }, []);

  const endFrame = useCallback(() => {
    frameCountRef.current++;
    const now = performance.now();

    if (now - lastFpsUpdateRef.current >= 1000) {
      const fps = Math.round((frameCountRef.current * 1000) / (now - lastFpsUpdateRef.current));
      const renderTime = now - startTimeRef.current;
      setMetrics(prev => ({ ...prev, fps, renderTime: Math.round(renderTime * 100) / 100 }));
      frameCountRef.current = 0;
      lastFpsUpdateRef.current = now;
    }
  }, []);

  const measureSegmentation = useCallback(<T>(fn: () => T): T => {
    const start = performance.now();
    const result = fn();
    const time = performance.now() - start;
    setMetrics(prev => ({ ...prev, segmentationTime: Math.round(time * 100) / 100 }));
    return result;
  }, []);

  const measureSegmentationAsync = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const result = await fn();
    const time = performance.now() - start;
    setMetrics(prev => ({ ...prev, segmentationTime: Math.round(time * 100) / 100 }));
    return result;
  }, []);

  const measureFaceMesh = useCallback(<T>(fn: () => T): T => {
    const start = performance.now();
    const result = fn();
    const time = performance.now() - start;
    setMetrics(prev => ({ ...prev, faceMeshTime: Math.round(time * 100) / 100 }));
    return result;
  }, []);

  const measureFaceMeshAsync = useCallback(async <T>(fn: () => Promise<T>): Promise<T> => {
    const start = performance.now();
    const result = await fn();
    const time = performance.now() - start;
    setMetrics(prev => ({ ...prev, faceMeshTime: Math.round(time * 100) / 100 }));
    return result;
  }, []);

  const measureRender = useCallback(<T>(fn: () => T): T => {
    const start = performance.now();
    const result = fn();
    const time = performance.now() - start;
    setMetrics(prev => ({ ...prev, renderTime: Math.round(time * 100) / 100 }));
    return result;
  }, []);

  return {
    metrics,
    startFrame,
    endFrame,
    measureSegmentation,
    measureSegmentationAsync,
    measureFaceMesh,
    measureFaceMeshAsync,
    measureRender
  };
}
