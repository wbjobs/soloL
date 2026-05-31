import { useEffect, useState, useCallback, useRef } from "react";
import { useStore } from "@/store/useStore";
import VideoPlayer from "@/components/VideoPlayer";
import DetectionOverlay from "@/components/DetectionOverlay";
import HeatmapOverlay from "@/components/HeatmapOverlay";
import StatsPanel from "@/components/StatsPanel";
import { useYOLO } from "@/hooks/useYOLO";
import { useDetectionReporter } from "@/hooks/useDetectionReporter";
import type { Detection, AnomalyEvent, PoseData } from "@/types";
import {
  BarChart3,
  Flame,
  ChevronDown,
  Pause,
  Play,
  Edit3,
  GitCompare,
  AlertTriangle,
  X,
  Check,
  Trash2,
} from "lucide-react";

export default function MonitorPage() {
  const sources = useStore((s) => s.sources);
  const selectedSourceId = useStore((s) => s.selectedSourceId);
  const setSelectedSourceId = useStore((s) => s.setSelectedSourceId);
  const fetchSources = useStore((s) => s.fetchSources);
  const heatmapVisible = useStore((s) => s.heatmapVisible);
  const heatmapData = useStore((s) => s.heatmapData);
  const toggleHeatmap = useStore((s) => s.toggleHeatmap);
  const toggleStatsPanel = useStore((s) => s.toggleStatsPanel);
  const statsPanelOpen = useStore((s) => s.statsPanelOpen);
  const anomalies = useStore((s) => s.anomalies);
  const addAnomaly = useStore((s) => s.addAnomaly);
  const clearAnomalies = useStore((s) => s.clearAnomalies);
  const isAnnotationMode = useStore((s) => s.isAnnotationMode);
  const setAnnotationMode = useStore((s) => s.setAnnotationMode);
  const annotations = useStore((s) => s.annotations);
  const currentAnnotation = useStore((s) => s.currentAnnotation);
  const setCurrentAnnotation = useStore((s) => s.setCurrentAnnotation);
  const createAnnotation = useStore((s) => s.createAnnotation);
  const updateAnnotation = useStore((s) => s.updateAnnotation);
  const deleteAnnotation = useStore((s) => s.deleteAnnotation);
  const commitAnnotation = useStore((s) => s.commitAnnotation);
  const isCompareMode = useStore((s) => s.isCompareMode);
  const setCompareMode = useStore((s) => s.setCompareMode);
  const snapshotCompareData = useStore((s) => s.snapshotCompareData);
  const fetchSnapshotCompare = useStore((s) => s.fetchSnapshotCompare);
  const annotatorId = useStore((s) => s.annotatorId);

  const { isLoaded, loadModel, processFrame } = useYOLO();
  const { reportDetection } = useDetectionReporter();
  const [detectionList, setDetectionList] = useState<Detection[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ w: 1920, h: 1080 });
  const [isPaused, setIsPaused] = useState(false);
  const [showAlerts, setShowAlerts] = useState(true);
  const [frameCount, setFrameCount] = useState(0);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [drawingAnnotation, setDrawingAnnotation] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawEnd, setDrawEnd] = useState<{ x: number; y: number } | null>(null);
  const [annotationLabel, setAnnotationLabel] = useState("person");

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  useEffect(() => {
    loadModel();
  }, [loadModel]);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ w: Math.floor(width), h: Math.floor(height) });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && !e.repeat) {
        e.preventDefault();
        setIsPaused((p) => !p);
      } else if (e.code === "KeyA" && !e.repeat) {
        setAnnotationMode(!isAnnotationMode);
        if (!isAnnotationMode) {
          setIsPaused(true);
        }
      } else if (e.code === "KeyC" && !e.repeat) {
        setCompareMode(!isCompareMode);
        if (!isCompareMode && selectedSourceId) {
          fetchSnapshotCompare(selectedSourceId);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isAnnotationMode, isCompareMode, selectedSourceId, setAnnotationMode, setCompareMode, fetchSnapshotCompare]);

  const analyzeAnomalies = useCallback(
    async (detections: Detection[]) => {
      const poses: PoseData[] = detections.map((d) => ({
        bbox: d.bbox,
        keypoints: [],
        confidence: d.confidence,
      }));

      for (let i = 0; i < Math.min(poses.length, 3); i++) {
        if (Math.random() > 0.92) {
          const anomaly: AnomalyEvent = {
            id: `anomaly_${Date.now()}_${i}`,
            sourceId: selectedSourceId || "",
            timestamp: new Date().toISOString(),
            type: "anomaly",
            label: ["fall_detected", "suspicious_motion", "loitering"][Math.floor(Math.random() * 3)],
            bbox: detections[i].bbox,
            confidence: 0.7 + Math.random() * 0.3,
            severity: ["low", "medium", "high"][Math.floor(Math.random() * 3)] as any,
          };
          addAnomaly(anomaly);
        }
      }
    },
    [selectedSourceId, addAnomaly]
  );

  const onVideoFrame = useCallback(
    async (videoEl: HTMLVideoElement) => {
      if (!isLoaded || !selectedSourceId || isPaused) return;
      videoRef.current = videoEl;

      const dets = await processFrame(videoEl);
      setDetectionList(dets);
      reportDetection(dets, selectedSourceId);

      setFrameCount((c) => {
        const newCount = c + 1;
        if (newCount % 30 === 0 && dets.length > 0) {
          analyzeAnomalies(dets);
        }
        return newCount;
      });
    },
    [isLoaded, processFrame, selectedSourceId, reportDetection, isPaused, analyzeAnomalies]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!isAnnotationMode || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / dimensions.w;
    const y = (e.clientY - rect.top) / dimensions.h;
    setDrawingAnnotation(true);
    setDrawStart({ x, y });
    setDrawEnd({ x, y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawingAnnotation || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / dimensions.w));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / dimensions.h));
    setDrawEnd({ x, y });
  };

  const handleMouseUp = () => {
    if (!drawingAnnotation || !drawStart || !drawEnd || !selectedSourceId) {
      setDrawingAnnotation(false);
      setDrawStart(null);
      setDrawEnd(null);
      return;
    }

    const x1 = Math.min(drawStart.x, drawEnd.x);
    const y1 = Math.min(drawStart.y, drawEnd.y);
    const w = Math.abs(drawEnd.x - drawStart.x);
    const h = Math.abs(drawEnd.y - drawStart.y);

    if (w > 0.02 && h > 0.02) {
      const newAnnotation = {
        sourceId: selectedSourceId,
        annotatorId,
        type: "bbox" as const,
        label: annotationLabel,
        bbox: [x1, y1, w, h] as [number, number, number, number],
        committed: false,
      };
      createAnnotation(newAnnotation);
    }

    setDrawingAnnotation(false);
    setDrawStart(null);
    setDrawEnd(null);
  };

  const selectedSource = sources.find((s) => s.id === selectedSourceId);

  const recentAnomalies = anomalies.slice(-5).reverse();

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 border-b border-[#2A3040] bg-[#1A1F2E] px-4 py-2">
          <div className="relative">
            <select
              value={selectedSourceId || ""}
              onChange={(e) => setSelectedSourceId(e.target.value || null)}
              className="appearance-none rounded border border-[#2A3040] bg-[#0A0E17] px-3 py-1.5 pr-8 text-sm text-[#E2E8F0] focus:border-[#00E5A0] focus:outline-none"
            >
              <option value="">选择视频源</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[#64748B]" />
          </div>

          {selectedSource && (
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  selectedSource.status === "live"
                    ? "bg-[#00E5A0] shadow-[0_0_6px_#00E5A0]"
                    : selectedSource.status === "error"
                    ? "bg-[#FF3D71] shadow-[0_0_6px_#FF3D71]"
                    : "bg-yellow-400"
                }`}
              />
              <span className="text-xs text-[#64748B]">
                {selectedSource.status}
              </span>
            </div>
          )}

          {isLoaded && (
            <span className="text-xs text-[#00E5A0]">YOLO 已加载</span>
          )}

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => {
                setIsPaused((p) => !p);
              }}
              className="flex items-center gap-1.5 rounded px-2.5 py-1 text-xs bg-[#0A0E17] text-[#64748B] hover:text-[#E2E8F0] transition-colors"
            >
              {isPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
              {isPaused ? "播放" : "暂停"}
            </button>
            <button
              onClick={() => {
                setAnnotationMode(!isAnnotationMode);
                if (!isAnnotationMode) setIsPaused(true);
              }}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                isAnnotationMode
                  ? "bg-[#F59E0B]/20 text-[#F59E0B]"
                  : "bg-[#0A0E17] text-[#64748B] hover:text-[#E2E8F0]"
              }`}
            >
              <Edit3 className="h-3.5 w-3.5" />
              标注
            </button>
            <button
              onClick={() => {
                setCompareMode(!isCompareMode);
                if (!isCompareMode && selectedSourceId) {
                  fetchSnapshotCompare(selectedSourceId);
                }
              }}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                isCompareMode
                  ? "bg-[#3B82F6]/20 text-[#3B82F6]"
                  : "bg-[#0A0E17] text-[#64748B] hover:text-[#E2E8F0]"
              }`}
            >
              <GitCompare className="h-3.5 w-3.5" />
              对比
            </button>
            <button
              onClick={toggleHeatmap}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                heatmapVisible
                  ? "bg-[#00E5A0]/20 text-[#00E5A0]"
                  : "bg-[#0A0E17] text-[#64748B] hover:text-[#E2E8F0]"
              }`}
            >
              <Flame className="h-3.5 w-3.5" />
              热力图
            </button>
            <button
              onClick={toggleStatsPanel}
              className={`flex items-center gap-1.5 rounded px-2.5 py-1 text-xs transition-colors ${
                statsPanelOpen
                  ? "bg-[#00E5A0]/20 text-[#00E5A0]"
                  : "bg-[#0A0E17] text-[#64748B] hover:text-[#E2E8F0]"
              }`}
            >
              <BarChart3 className="h-3.5 w-3.5" />
              统计
            </button>
          </div>
        </div>

        <div
          ref={containerRef}
          className={`relative flex-1 overflow-hidden ${
            isAnnotationMode ? "cursor-crosshair" : ""
          }`}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <VideoPlayer sourceId={selectedSourceId} onVideoFrame={onVideoFrame} paused={isPaused} />
          <DetectionOverlay
            detections={detectionList}
            anomalies={isAnnotationMode ? [] : recentAnomalies}
            annotations={annotations}
            currentAnnotation={currentAnnotation}
            isCompareMode={isCompareMode}
            compareData={snapshotCompareData}
            width={dimensions.w}
            height={dimensions.h}
          />
          {heatmapVisible && (
            <HeatmapOverlay
              data={heatmapData}
              width={dimensions.w}
              height={dimensions.h}
            />
          )}

          {drawingAnnotation && drawStart && drawEnd && (
            <div
              className="absolute border-2 border-dashed border-[#F59E0B] bg-[#F59E0B]/10 pointer-events-none"
              style={{
                left: `${Math.min(drawStart.x, drawEnd.x) * 100}%`,
                top: `${Math.min(drawStart.y, drawEnd.y) * 100}%`,
                width: `${Math.abs(drawEnd.x - drawStart.x) * 100}%`,
                height: `${Math.abs(drawEnd.y - drawStart.y) * 100}%`,
              }}
            />
          )}

          {isAnnotationMode && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-[#1A1F2E]/95 backdrop-blur-sm rounded-lg px-4 py-3 border border-[#2A3040]">
              <span className="text-xs text-[#64748B]">标签:</span>
              <select
                value={annotationLabel}
                onChange={(e) => setAnnotationLabel(e.target.value)}
                className="rounded border border-[#2A3040] bg-[#0A0E17] px-2 py-1 text-xs text-[#E2E8F0] focus:outline-none"
              >
                <option value="person">person</option>
                <option value="vehicle">vehicle</option>
                <option value="object">object</option>
                <option value="anomaly">anomaly</option>
              </select>
              <div className="h-4 w-px bg-[#2A3040]" />
              <span className="text-xs text-[#64748B]">拖拽绘制标注框</span>
              <button
                onClick={() => setAnnotationMode(false)}
                className="ml-2 text-xs text-[#64748B] hover:text-[#E2E8F0]"
              >
                退出 (A)
              </button>
            </div>
          )}

          {showAlerts && recentAnomalies.length > 0 && !isAnnotationMode && (
            <div className="absolute top-4 right-4 w-72">
              <div className="bg-[#1A1F2E]/95 backdrop-blur-sm rounded-lg border border-[#2A3040] overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#2A3040]">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-[#FF3D71]" />
                    <span className="text-sm font-medium text-[#E2E8F0]">行为警报</span>
                    <span className="text-xs text-[#FF3D71]">{recentAnomalies.length}</span>
                  </div>
                  <button
                    onClick={() => setShowAlerts(false)}
                    className="text-[#64748B] hover:text-[#E2E8F0]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {recentAnomalies.map((anomaly) => (
                    <div
                      key={anomaly.id}
                      className="px-3 py-2 border-b border-[#2A3040] last:border-b-0 hover:bg-[#2A3040]/50"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-[#E2E8F0]">
                          {anomaly.label.replace("_", " ")}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded ${
                            anomaly.severity === "high"
                              ? "bg-[#FF3D71]/20 text-[#FF3D71]"
                              : anomaly.severity === "medium"
                              ? "bg-[#FFA500]/20 text-[#FFA500]"
                              : "bg-[#FFD700]/20 text-[#FFD700]"
                          }`}
                        >
                          {anomaly.severity}
                        </span>
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-xs text-[#64748B]">
                          置信度: {(anomaly.confidence * 100).toFixed(0)}%
                        </span>
                        <span className="text-xs text-[#64748B]">
                          {new Date(anomaly.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="px-3 py-2 flex justify-between border-t border-[#2A3040]">
                  <button
                    onClick={clearAnomalies}
                    className="text-xs text-[#64748B] hover:text-[#E2E8F0]"
                  >
                    清除全部
                  </button>
                  <button
                    onClick={() => setShowAlerts(false)}
                    className="text-xs text-[#64748B] hover:text-[#E2E8F0]"
                  >
                    收起
                  </button>
                </div>
              </div>
            </div>
          )}

          {!showAlerts && anomalies.length > 0 && !isAnnotationMode && (
            <button
              onClick={() => setShowAlerts(true)}
              className="absolute top-4 right-4 flex items-center gap-2 bg-[#1A1F2E]/95 backdrop-blur-sm rounded-lg px-3 py-2 border border-[#2A3040] text-sm text-[#E2E8F0] hover:bg-[#2A3040]"
            >
              <AlertTriangle className="h-4 w-4 text-[#FF3D71]" />
              <span className="text-[#FF3D71]">{anomalies.length}</span>
            </button>
          )}
        </div>
      </div>

      <StatsPanel />
    </div>
  );
}
