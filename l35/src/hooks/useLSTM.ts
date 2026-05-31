import { useState, useRef, useCallback, useMemo } from "react";
import type { FramePoses, BehaviorAnomalyEvent, ActionPrediction, Keypose } from "@/types";

const WINDOW_SIZE = 16;
const STRIDE = 4;
const ANOMALY_THRESHOLD = 0.7;

interface InferenceStats {
  fps: number;
  avgInferenceTime: number;
  windowCount: number;
}

function normalizePoses(poses: Keypose[][]): Keypose[][] {
  return poses.map((pose) => {
    if (pose.length < 11) return pose;
    const hip = pose[11] || pose[0];
    if (!hip) return pose;
    const hipX = hip.x;
    const hipY = hip.y;
    let maxDist = 0;
    pose.forEach((kp) => {
      const dist = Math.sqrt(Math.pow(kp.x - hipX, 2) + Math.pow(kp.y - hipY, 2));
      maxDist = Math.max(maxDist, dist);
    });
    const scale = maxDist || 1;
    return pose.map((kp) => ({
      x: (kp.x - hipX) / scale,
      y: (kp.y - hipY) / scale,
      confidence: kp.confidence,
    }));
  });
}

export function useLSTM() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<BehaviorAnomalyEvent[]>([]);

  const frameBufferRef = useRef<FramePoses[]>([]);
  const lastProcessedFrameRef = useRef(-1);
  const fpsRef = useRef(0);
  const avgTimeRef = useRef(0);
  const windowCountRef = useRef(0);
  const frameCountRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const inferenceTimesRef = useRef<number[]>([]);

  const inferenceStats: InferenceStats = useMemo(() => ({
    fps: fpsRef.current,
    avgInferenceTime: avgTimeRef.current,
    windowCount: windowCountRef.current,
  }), []);

  const loadModel = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/behavior/health");
      if (!res.ok) throw new Error("Backend service unavailable");
      setIsLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize");
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const analyzePoses = useCallback(async (frameData: FramePoses) => {
    if (!isLoaded) return [];

    frameCountRef.current++;
    frameBufferRef.current.push(frameData);

    if (frameBufferRef.current.length > WINDOW_SIZE * 2) {
      frameBufferRef.current.shift();
    }

    const frameIndex = frameData.frameIndex;
    if (frameIndex - lastProcessedFrameRef.current < STRIDE) {
      return [];
    }

    if (frameBufferRef.current.length < WINDOW_SIZE) {
      return [];
    }

    const window = frameBufferRef.current.slice(-WINDOW_SIZE);
    const normalizedWindow = window.map((f) => ({
      frameIndex: f.frameIndex,
      poses: normalizePoses(f.poses),
    }));

    const startTime = performance.now();
    windowCountRef.current++;

    try {
      const res = await fetch("/api/behavior/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ window: normalizedWindow }),
      });

      if (!res.ok) throw new Error("Analysis failed");

      const data = await res.json();
      const predictions: ActionPrediction[] = data.predictions || [];

      const newAnomalies: BehaviorAnomalyEvent[] = predictions
        .filter((p) => p.confidence > ANOMALY_THRESHOLD && p.action !== "normal")
        .map((p) => ({
          id: `anomaly-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          timestamp: new Date(),
          action: p.action,
          confidence: p.confidence,
          bbox: [0, 0, 1, 1] as [number, number, number, number],
        }));

      if (newAnomalies.length > 0) {
        setAnomalies((prev) => [...newAnomalies, ...prev].slice(0, 50));
      }

      lastProcessedFrameRef.current = frameIndex;

      const inferenceTime = performance.now() - startTime;
      inferenceTimesRef.current.push(inferenceTime);
      if (inferenceTimesRef.current.length > 30) {
        inferenceTimesRef.current.shift();
      }
      avgTimeRef.current = inferenceTimesRef.current.reduce((a, b) => a + b, 0) / inferenceTimesRef.current.length;

      const now = performance.now();
      if (now - lastTimeRef.current >= 1000) {
        fpsRef.current = Math.round((frameCountRef.current * 1000) / (now - lastTimeRef.current));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }

      return predictions;
    } catch {
      return [];
    }
  }, [isLoaded]);

  return {
    isLoaded,
    isLoading,
    error,
    loadModel,
    analyzePoses,
    anomalies,
    inferenceStats,
  };
}
