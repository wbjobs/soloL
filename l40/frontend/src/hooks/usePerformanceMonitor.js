import { useState, useEffect, useRef, useCallback } from 'react';

const DEFAULT_OPTIONS = {
  fpsThreshold: 30,
  memoryThreshold: 0.8,
  sampleWindow: 60,
  lodBiasLow: 0.7,
  lodBiasHigh: 1.0,
  lodBiasCritical: 0.5,
};

function usePerformanceMonitor(options = {}) {
  const config = { ...DEFAULT_OPTIONS, ...options };

  const [fps, setFps] = useState(60);
  const [memory, setMemory] = useState(null);
  const [isLowPerformance, setIsLowPerformance] = useState(false);
  const [lodBias, setLodBias] = useState(config.lodBiasHigh);
  const [drawCalls, setDrawCalls] = useState(0);
  const [triangleCount, setTriangleCount] = useState(0);

  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const fpsSamplesRef = useRef([]);
  const animationFrameRef = useRef(null);
  const lowFpsCounterRef = useRef(0);
  const highFpsCounterRef = useRef(0);

  const hasMemoryAPI = typeof performance !== 'undefined' && performance.memory;

  const getMemoryUsage = useCallback(() => {
    if (!hasMemoryAPI) return null;
    const mem = performance.memory;
    return {
      used: mem.usedJSHeapSize,
      total: mem.totalJSHeapSize,
      limit: mem.jsHeapSizeLimit,
      percentage: (mem.usedJSHeapSize / mem.jsHeapSizeLimit) * 100,
    };
  }, [hasMemoryAPI]);

  const checkPerformance = useCallback((currentFps, currentMemory) => {
    const fpsLow = currentFps < config.fpsThreshold;
    const memoryLow = currentMemory && currentMemory.percentage > config.memoryThreshold * 100;

    if (fpsLow || memoryLow) {
      lowFpsCounterRef.current++;
      highFpsCounterRef.current = 0;

      if (lowFpsCounterRef.current >= 30) {
        setIsLowPerformance(true);
        if (currentFps < 20 || (currentMemory && currentMemory.percentage > 90)) {
          setLodBias(config.lodBiasCritical);
        } else {
          setLodBias(config.lodBiasLow);
        }
      }
    } else {
      highFpsCounterRef.current++;
      lowFpsCounterRef.current = 0;

      if (highFpsCounterRef.current >= 120) {
        setIsLowPerformance(false);
        setLodBias(config.lodBiasHigh);
      }
    }
  }, [config]);

  const onLowMemory = useCallback((callback) => {
    if (!callback) return;
    const interval = setInterval(() => {
      const mem = getMemoryUsage();
      if (mem && mem.percentage > config.memoryThreshold * 100) {
        callback(mem);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [getMemoryUsage, config.memoryThreshold]);

  useEffect(() => {
    const measureFrame = () => {
      frameCountRef.current++;
      const now = performance.now();
      const elapsed = now - lastTimeRef.current;

      if (elapsed >= 1000) {
        const currentFps = Math.round((frameCountRef.current * 1000) / elapsed);

        fpsSamplesRef.current.push(currentFps);
        if (fpsSamplesRef.current.length > config.sampleWindow) {
          fpsSamplesRef.current.shift();
        }

        const avgFps = Math.round(
          fpsSamplesRef.current.reduce((a, b) => a + b, 0) / fpsSamplesRef.current.length
        );

        setFps(avgFps);

        const mem = getMemoryUsage();
        setMemory(mem);

        checkPerformance(avgFps, mem);

        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }

      animationFrameRef.current = requestAnimationFrame(measureFrame);
    };

    animationFrameRef.current = requestAnimationFrame(measureFrame);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [getMemoryUsage, checkPerformance, config.sampleWindow]);

  const updateStats = useCallback((stats) => {
    if (stats?.drawCalls !== undefined) {
      setDrawCalls(stats.drawCalls);
    }
    if (stats?.triangles !== undefined) {
      setTriangleCount(stats.triangles);
    }
  }, []);

  const reset = useCallback(() => {
    frameCountRef.current = 0;
    lastTimeRef.current = performance.now();
    fpsSamplesRef.current = [];
    lowFpsCounterRef.current = 0;
    highFpsCounterRef.current = 0;
    setFps(60);
    setMemory(null);
    setIsLowPerformance(false);
    setLodBias(config.lodBiasHigh);
    setDrawCalls(0);
    setTriangleCount(0);
  }, [config.lodBiasHigh]);

  return {
    fps,
    memory,
    isLowPerformance,
    lodBias,
    drawCalls,
    triangleCount,
    updateStats,
    reset,
    onLowMemory,
    hasMemoryAPI,
  };
}

export default usePerformanceMonitor;
