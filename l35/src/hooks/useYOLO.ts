import { useState, useRef, useCallback, useMemo } from "react";
import type { Detection } from "@/types";

const INPUT_SIZE = 640;
const CONF_THRESHOLD = 0.25;
const NMS_THRESHOLD = 0.45;
const TILE_OVERLAP = 0.2;

interface InferenceStats {
  fps: number;
  avgInferenceTime: number;
  tileCount: number;
  frameSkip: number;
}

interface Tile {
  x: number;
  y: number;
  w: number;
  h: number;
  scaleX: number;
  scaleY: number;
}

function computeTiles(frameW: number, frameH: number): Tile[] {
  if (frameW <= INPUT_SIZE && frameH <= INPUT_SIZE) {
    return [{ x: 0, y: 0, w: frameW, h: frameH, scaleX: INPUT_SIZE / frameW, scaleY: INPUT_SIZE / frameH }];
  }
  const tiles: Tile[] = [];
  const gridCols = frameW > INPUT_SIZE ? 2 : 1;
  const gridRows = frameH > INPUT_SIZE ? 2 : 1;
  const tileW = Math.ceil(frameW / gridCols / (1 - TILE_OVERLAP));
  const tileH = Math.ceil(frameH / gridRows / (1 - TILE_OVERLAP));
  const stepX = tileW * (1 - TILE_OVERLAP);
  const stepY = tileH * (1 - TILE_OVERLAP);
  for (let row = 0; row < gridRows; row++) {
    for (let col = 0; col < gridCols; col++) {
      const x = Math.min(col * stepX, frameW - tileW);
      const y = Math.min(row * stepY, frameH - tileH);
      const w = Math.min(tileW, frameW - x);
      const h = Math.min(tileH, frameH - y);
      tiles.push({ x, y, w, h, scaleX: INPUT_SIZE / w, scaleY: INPUT_SIZE / h });
    }
  }
  return tiles;
}

function iou(a: Float32Array, b: Float32Array, aOffset: number, bOffset: number): number {
  const x1 = Math.max(a[aOffset], b[bOffset]);
  const y1 = Math.max(a[aOffset + 1], b[bOffset + 1]);
  const x2 = Math.min(a[aOffset + 2], b[bOffset + 2]);
  const y2 = Math.min(a[aOffset + 3], b[bOffset + 3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a[aOffset + 2] - a[aOffset]) * (a[aOffset + 3] - a[aOffset + 1]);
  const areaB = (b[bOffset + 2] - b[bOffset]) * (b[bOffset + 3] - b[bOffset + 1]);
  return inter / (areaA + areaB - inter + 1e-6);
}

function nms(boxes: Float32Array, scores: Float32Array, count: number): number[] {
  const indices = new Array(count).fill(0).map((_, i) => i).sort((a, b) => scores[b] - scores[a]);
  const kept: number[] = [];
  const suppressed = new Uint8Array(count);
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (suppressed[idx]) continue;
    kept.push(idx);
    for (let j = i + 1; j < indices.length; j++) {
      const other = indices[j];
      if (suppressed[other]) continue;
      if (iou(boxes, boxes, idx * 4, other * 4) > NMS_THRESHOLD) {
        suppressed[other] = 1;
      }
    }
  }
  return kept;
}

export function useYOLO() {
  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<any>(null);
  const frameCountRef = useRef(0);
  const frameSkipRef = useRef(0);
  const fpsRef = useRef(0);
  const avgTimeRef = useRef(0);
  const lastTimeRef = useRef(performance.now());
  const inferenceTimesRef = useRef<number[]>([]);
  const tileCountRef = useRef(0);
  const canvasRef = useRef<HTMLCanvasElement | OffscreenCanvas | null>(null);

  const inferenceStats: InferenceStats = useMemo(() => ({
    fps: fpsRef.current,
    avgInferenceTime: avgTimeRef.current,
    tileCount: tileCountRef.current,
    frameSkip: frameSkipRef.current,
  }), [fpsRef.current, avgTimeRef.current, tileCountRef.current, frameSkipRef.current]);

  const preprocessTile = useCallback((
    source: HTMLVideoElement | HTMLCanvasElement,
    tile: Tile
  ): Float32Array => {
    let canvas = canvasRef.current;
    if (!canvas) {
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE);
      } else {
        canvas = document.createElement("canvas");
        canvas.width = INPUT_SIZE;
        canvas.height = INPUT_SIZE;
      }
      canvasRef.current = canvas;
    }
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
    ctx.clearRect(0, 0, INPUT_SIZE, INPUT_SIZE);
    ctx.drawImage(source, tile.x, tile.y, tile.w, tile.h, 0, 0, INPUT_SIZE, INPUT_SIZE);
    const imageData = ctx.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
    const data = imageData.data;
    const float32Data = new Float32Array(INPUT_SIZE * INPUT_SIZE * 3);
    const size = INPUT_SIZE * INPUT_SIZE;
    for (let i = 0; i < size; i++) {
      const j = i * 4;
      float32Data[i] = data[j] / 255;
      float32Data[size + i] = data[j + 1] / 255;
      float32Data[size * 2 + i] = data[j + 2] / 255;
    }
    return float32Data;
  }, []);

  const runInference = useCallback(async (float32Data: Float32Array, ort: any): Promise<Float32Array | null> => {
    if (!sessionRef.current) return null;
    const tensor = new ort.Tensor("float32", float32Data, [1, 3, INPUT_SIZE, INPUT_SIZE]);
    const inputName = sessionRef.current.inputNames[0];
    const results = await sessionRef.current.run({ [inputName]: tensor });
    const outputName = sessionRef.current.outputNames[0];
    return results[outputName]?.data as Float32Array || null;
  }, []);

  const postprocess = useCallback((
    output: Float32Array,
    tile: Tile,
    frameW: number,
    frameH: number,
    boxes: Float32Array,
    scores: Float32Array,
    startIdx: number
  ): number => {
    const numDetections = output.length / 84;
    let count = 0;
    for (let i = 0; i < numDetections; i++) {
      const offset = i * 84;
      let maxScore = 0;
      let maxClassId = 0;
      for (let c = 0; c < 80; c++) {
        const score = output[offset + 4 + c];
        if (score > maxScore) {
          maxScore = score;
          maxClassId = c;
        }
      }
      if (maxScore < CONF_THRESHOLD || maxClassId !== 0) continue;
      const cx = output[offset] / INPUT_SIZE;
      const cy = output[offset + 1] / INPUT_SIZE;
      const w = output[offset + 2] / INPUT_SIZE;
      const h = output[offset + 3] / INPUT_SIZE;
      const x1 = (cx - w / 2) * tile.w + tile.x;
      const y1 = (cy - h / 2) * tile.h + tile.y;
      const x2 = (cx + w / 2) * tile.w + tile.x;
      const y2 = (cy + h / 2) * tile.h + tile.y;
      if (x1 < 0 || y1 < 0 || x2 > frameW || y2 > frameH) continue;
      const idx = (startIdx + count) * 4;
      boxes[idx] = x1;
      boxes[idx + 1] = y1;
      boxes[idx + 2] = x2;
      boxes[idx + 3] = y2;
      scores[startIdx + count] = maxScore;
      count++;
    }
    return count;
  }, []);

  const loadModel = useCallback(async () => {
    if (sessionRef.current || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const ort = await import("onnxruntime-web");
      ort.env.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 4);
      ort.env.wasm.proxy = false;
      ort.env.wasm.simd = true;
      const resp = await fetch("/models/yolov8n.onnx", { method: "HEAD" });
      if (!resp.ok) {
        setError("Model not found at /models/yolov8n.onnx");
        setIsLoading(false);
        return;
      }
      let providers = ["webgl", "wasm"];
      try {
        sessionRef.current = await ort.InferenceSession.create("/models/yolov8n.onnx", {
          executionProviders: providers,
          graphOptimizationLevel: "all",
          enableCpuMemArena: true,
        });
      } catch {
        providers = ["wasm"];
        sessionRef.current = await ort.InferenceSession.create("/models/yolov8n.onnx", {
          executionProviders: providers,
          graphOptimizationLevel: "all",
        });
      }
      setIsLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load model");
      sessionRef.current = null;
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  const processFrame = useCallback(async (
    video: HTMLVideoElement | HTMLCanvasElement
  ): Promise<Detection[]> => {
    if (!sessionRef.current) return [];
    frameCountRef.current++;
    if (frameSkipRef.current > 0) {
      frameSkipRef.current--;
      return [];
    }
    const startTime = performance.now();
    try {
      const ort = await import("onnxruntime-web");
      const frameW = video instanceof HTMLVideoElement ? (video.videoWidth || INPUT_SIZE) : (video.width || INPUT_SIZE);
      const frameH = video instanceof HTMLVideoElement ? (video.videoHeight || INPUT_SIZE) : (video.height || INPUT_SIZE);
      const tiles = computeTiles(frameW, frameH);
      tileCountRef.current = tiles.length;
      const maxDetections = 8400 * tiles.length;
      const allBoxes = new Float32Array(maxDetections * 4);
      const allScores = new Float32Array(maxDetections);
      let totalCount = 0;
      for (const tile of tiles) {
        const float32Data = preprocessTile(video, tile);
        const output = await runInference(float32Data, ort);
        if (!output) continue;
        const count = postprocess(output, tile, frameW, frameH, allBoxes, allScores, totalCount);
        totalCount += count;
      }
      const kept = nms(allBoxes, allScores, totalCount);
      const detections: Detection[] = kept.map((idx) => {
        const off = idx * 4;
        const x = allBoxes[off] / frameW;
        const y = allBoxes[off + 1] / frameH;
        const w = (allBoxes[off + 2] - allBoxes[off]) / frameW;
        const h = (allBoxes[off + 3] - allBoxes[off + 1]) / frameH;
        return {
          bbox: [x, y, w, h] as [number, number, number, number],
          confidence: allScores[idx],
          classId: 0,
          label: "person",
        };
      });
      const inferenceTime = performance.now() - startTime;
      inferenceTimesRef.current.push(inferenceTime);
      if (inferenceTimesRef.current.length > 30) {
        inferenceTimesRef.current.shift();
      }
      avgTimeRef.current = inferenceTimesRef.current.reduce((a, b) => a + b, 0) / inferenceTimesRef.current.length;
      if (inferenceTime > 33) {
        frameSkipRef.current = Math.min(2, Math.ceil(inferenceTime / 33) - 1);
      }
      const now = performance.now();
      if (now - lastTimeRef.current >= 1000) {
        fpsRef.current = Math.round((frameCountRef.current * 1000) / (now - lastTimeRef.current));
        frameCountRef.current = 0;
        lastTimeRef.current = now;
      }
      return detections;
    } catch {
      return [];
    }
  }, [preprocessTile, runInference, postprocess]);

  return {
    isLoaded,
    isLoading,
    error,
    loadModel,
    processFrame,
    inferenceStats,
  };
}
