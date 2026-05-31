import { useState, useRef, useEffect, useCallback } from "react";
import { Play, Pause, Square, Trash2, Check, X, AlertTriangle } from "lucide-react";
import type { AnnotationDetection, ActionType } from "@/types";

interface AnnotationToolProps {
  videoRef: React.RefObject<HTMLVideoElement>;
  sourceId: string;
  isPlaying: boolean;
  onPlayPause: (playing: boolean) => void;
  onCommit: (detections: AnnotationDetection[]) => Promise<void>;
  modelDetections: AnnotationDetection[];
}

const ACTION_TYPES: ActionType[] = ["normal", "fall", "chasing", "running", "loitering"];

export default function AnnotationTool({
  videoRef,
  sourceId,
  isPlaying,
  onPlayPause,
  onCommit,
  modelDetections,
}: AnnotationToolProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isAnnotating, setIsAnnotating] = useState(false);
  const [isDrawing, setIsDrawing] = useState(false);
  const [detections, setDetections] = useState<AnnotationDetection[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBbox, setCurrentBbox] = useState<[number, number, number, number] | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
  const [hasConflicts, setHasConflicts] = useState(false);
  const [wsVersion, setWsVersion] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!isAnnotating) return;
    onPlayPause(false);
  }, [isAnnotating, onPlayPause]);

  useEffect(() => {
    if (!sourceId || !isAnnotating) return;

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${window.location.host}/ws`);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type?.startsWith("annotation-")) {
          if (msg.sourceId === sourceId && msg.version > wsVersion) {
            setHasConflicts(true);
            setWsVersion(msg.version);
          }
        }
      } catch { void 0; }
    };

    return () => {
      ws.close();
      wsRef.current = null;
    };
  }, [sourceId, isAnnotating, wsVersion]);

  useEffect(() => {
    if (!isAnnotating) {
      setDetections(modelDetections.map((d) => ({ ...d, isCorrection: false })));
    }
  }, [isAnnotating, modelDetections]);

  const getNormalizedCoords = useCallback(
    (e: React.MouseEvent): { x: number; y: number } => {
      const rect = containerRef.current?.getBoundingClientRect();
      const video = videoRef.current;
      if (!rect || !video) return { x: 0, y: 0 };

      const videoRatio = video.videoWidth / video.videoHeight;
      const containerRatio = rect.width / rect.height;

      let renderWidth: number, renderHeight: number, offsetX: number, offsetY: number;

      if (videoRatio > containerRatio) {
        renderWidth = rect.width;
        renderHeight = rect.width / videoRatio;
        offsetX = 0;
        offsetY = (rect.height - renderHeight) / 2;
      } else {
        renderWidth = rect.height * videoRatio;
        renderHeight = rect.height;
        offsetX = (rect.width - renderWidth) / 2;
        offsetY = 0;
      }

      const x = Math.max(0, Math.min(1, (e.clientX - rect.left - offsetX) / renderWidth));
      const y = Math.max(0, Math.min(1, (e.clientY - rect.top - offsetY) / renderHeight));

      return { x, y };
    },
    [videoRef]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!isAnnotating) return;
      if (e.button !== 0) return;

      const coords = getNormalizedCoords(e);
      const clicked = detections.find((d) => {
        const [bx, by, bw, bh] = d.bbox;
        return coords.x >= bx && coords.x <= bx + bw && coords.y >= by && coords.y <= by + bh;
      });

      if (clicked) {
        setSelectedId(clicked.id);
        return;
      }

      setIsDrawing(true);
      setDrawStart(coords);
      setSelectedId(null);
    },
    [isAnnotating, getNormalizedCoords, detections]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDrawing || !drawStart) return;

      const coords = getNormalizedCoords(e);
      const x = Math.min(drawStart.x, coords.x);
      const y = Math.min(drawStart.y, coords.y);
      const w = Math.abs(coords.x - drawStart.x);
      const h = Math.abs(coords.y - drawStart.y);

      setCurrentBbox([x, y, w, h]);
    },
    [isDrawing, drawStart, getNormalizedCoords]
  );

  const handleMouseUp = useCallback(() => {
    if (!isDrawing || !currentBbox) {
      setIsDrawing(false);
      return;
    }

    const [, , w, h] = currentBbox;
    if (w > 0.02 && h > 0.02) {
      const newDetection: AnnotationDetection = {
        id: `det-${Date.now()}`,
        bbox: currentBbox,
        confidence: 1.0,
        label: "person",
        isCorrection: true,
      };
      setDetections((prev) => [...prev, newDetection]);
      setSelectedId(newDetection.id);
    }

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentBbox(null);
  }, [isDrawing, currentBbox]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!isAnnotating) return;

      const coords = getNormalizedCoords(e);
      const clicked = detections.find((d) => {
        const [bx, by, bw, bh] = d.bbox;
        return coords.x >= bx && coords.x <= bx + bw && coords.y >= by && coords.y <= by + bh;
      });

      if (clicked) {
        setContextMenu({ x: e.clientX, y: e.clientY, id: clicked.id });
      }
    },
    [isAnnotating, getNormalizedCoords, detections]
  );

  const handleActionSelect = (action: ActionType) => {
    if (!contextMenu) return;
    setDetections((prev) =>
      prev.map((d) =>
        d.id === contextMenu.id ? { ...d, actionLabel: action, isCorrection: true } : d
      )
    );
    setContextMenu(null);
  };

  const handleDelete = () => {
    if (!selectedId) return;
    setDetections((prev) => prev.filter((d) => d.id !== selectedId));
    setSelectedId(null);
  };

  const handleCommit = async () => {
    const corrections = detections.filter((d) => d.isCorrection);
    if (corrections.length === 0) return;

    await onCommit(corrections);
    setIsAnnotating(false);
    setDetections([]);
    setSelectedId(null);
    setHasConflicts(false);
  };

  const handleCancel = () => {
    setIsAnnotating(false);
    setDetections([]);
    setSelectedId(null);
    setContextMenu(null);
    setHasConflicts(false);
  };

  const renderBbox = (d: AnnotationDetection, idx: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    const video = videoRef.current;
    if (!rect || !video) return null;

    const videoRatio = video.videoWidth / video.videoHeight;
    const containerRatio = rect.width / rect.height;

    let renderWidth: number, renderHeight: number, offsetX: number, offsetY: number;

    if (videoRatio > containerRatio) {
      renderWidth = rect.width;
      renderHeight = rect.width / videoRatio;
      offsetX = 0;
      offsetY = (rect.height - renderHeight) / 2;
    } else {
      renderWidth = rect.height * videoRatio;
      renderHeight = rect.height;
      offsetX = (rect.width - renderWidth) / 2;
      offsetY = 0;
    }

    const [bx, by, bw, bh] = d.bbox;
    const x = offsetX + bx * renderWidth;
    const y = offsetY + by * renderHeight;
    const w = bw * renderWidth;
    const h = bh * renderHeight;

    const isSelected = d.id === selectedId;
    const color = d.isCorrection ? "#FF6B35" : "#00E5A0";

    return (
      <div
        key={d.id || idx}
        style={{
          position: "absolute",
          left: x,
          top: y,
          width: w,
          height: h,
          border: `2px solid ${color}`,
          boxShadow: isSelected ? `0 0 12px ${color}` : `0 0 4px ${color}`,
          cursor: isAnnotating ? "pointer" : "default",
          zIndex: isSelected ? 10 : 5,
        }}
        onClick={() => isAnnotating && setSelectedId(d.id)}
      >
        {d.actionLabel && (
          <div
            style={{
              position: "absolute",
              top: -20,
              left: -2,
              padding: "2px 6px",
              background: color,
              color: "#0A0E17",
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {d.actionLabel}
          </div>
        )}
        {d.isCorrection && (
          <div
            style={{
              position: "absolute",
              top: 0,
              right: -20,
              width: 16,
              height: 16,
              background: "#FF6B35",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              color: "#0A0E17",
              fontWeight: 700,
            }}
          >
            C
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full"
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
      onClick={() => setContextMenu(null)}
    >
      {detections.map((d, i) => renderBbox(d, i))}

      {currentBbox && (
        <div
          style={{
            position: "absolute",
            left: currentBbox[0] * (containerRef.current?.clientWidth || 0),
            top: currentBbox[1] * (containerRef.current?.clientHeight || 0),
            width: currentBbox[2] * (containerRef.current?.clientWidth || 0),
            height: currentBbox[3] * (containerRef.current?.clientHeight || 0),
            border: "2px dashed #00E5A0",
            background: "rgba(0, 229, 160, 0.1)",
            pointerEvents: "none",
          }}
        />
      )}

      <div
        style={{
          position: "absolute",
          top: 16,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 8,
          padding: "8px 12px",
          background: "rgba(10, 14, 23, 0.9)",
          backdropFilter: "blur(8px)",
          borderRadius: 8,
          border: "1px solid #1E293B",
          zIndex: 20,
        }}
      >
        <button
          onClick={() => onPlayPause(!isPlaying)}
          style={{
            padding: 8,
            background: "transparent",
            border: "1px solid #1E293B",
            borderRadius: 6,
            color: isPlaying ? "#00E5A0" : "#64748B",
            cursor: "pointer",
          }}
        >
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </button>

        <button
          onClick={() => setIsAnnotating(!isAnnotating)}
          style={{
            padding: 8,
            background: isAnnotating ? "rgba(0, 229, 160, 0.2)" : "transparent",
            border: `1px solid ${isAnnotating ? "#00E5A0" : "#1E293B"}`,
            borderRadius: 6,
            color: isAnnotating ? "#00E5A0" : "#64748B",
            cursor: "pointer",
          }}
        >
          <Square size={16} />
        </button>

        {isAnnotating && (
          <>
            <button
              onClick={handleDelete}
              disabled={!selectedId}
              style={{
                padding: 8,
                background: "transparent",
                border: "1px solid #1E293B",
                borderRadius: 6,
                color: selectedId ? "#EF4444" : "#374151",
                cursor: selectedId ? "pointer" : "not-allowed",
              }}
            >
              <Trash2 size={16} />
            </button>

            <button
              onClick={handleCommit}
              style={{
                padding: "8px 12px",
                background: "#00E5A0",
                border: "none",
                borderRadius: 6,
                color: "#0A0E17",
                fontWeight: 600,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Check size={16} />
              Commit
            </button>

            <button
              onClick={handleCancel}
              style={{
                padding: 8,
                background: "transparent",
                border: "1px solid #1E293B",
                borderRadius: 6,
                color: "#64748B",
                cursor: "pointer",
              }}
            >
              <X size={16} />
            </button>

            {hasConflicts && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "0 8px",
                  color: "#F59E0B",
                  fontSize: 12,
                }}
              >
                <AlertTriangle size={14} />
                Conflict
              </div>
            )}
          </>
        )}
      </div>

      {contextMenu && (
        <div
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
            background: "rgba(10, 14, 23, 0.95)",
            border: "1px solid #1E293B",
            borderRadius: 8,
            padding: 4,
            zIndex: 100,
          }}
        >
          {ACTION_TYPES.map((action) => (
            <div
              key={action}
              onClick={() => handleActionSelect(action)}
              style={{
                padding: "6px 12px",
                cursor: "pointer",
                borderRadius: 4,
                color: "#94A3B8",
                fontSize: 12,
                textTransform: "capitalize",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(0, 229, 160, 0.2)";
                e.currentTarget.style.color = "#00E5A0";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "#94A3B8";
              }}
            >
              {action}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
