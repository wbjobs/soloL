import { useRef, useEffect } from "react";
import type { Detection, AnomalyEvent, Annotation } from "@/types";

interface DetectionOverlayProps {
  detections: Detection[];
  anomalies: AnomalyEvent[];
  annotations: Annotation[];
  currentAnnotation: Annotation | null;
  isCompareMode: boolean;
  compareData: any | null;
  width: number;
  height: number;
}

export default function DetectionOverlay({
  detections,
  anomalies,
  annotations,
  currentAnnotation,
  isCompareMode,
  compareData,
  width,
  height,
}: DetectionOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);

  useEffect(() => {
    timeRef.current = requestAnimationFrame(() => {
      render();
    });
    return () => cancelAnimationFrame(timeRef.current);
  });

  const render = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    if (isCompareMode && compareData) {
      renderCompareMode(ctx, compareData);
    } else {
      renderDetections(ctx, detections, "#00E5A0", 2);
      renderAnomalies(ctx, anomalies);
      renderAnnotations(ctx, annotations);
      if (currentAnnotation) {
        renderCurrentAnnotation(ctx, currentAnnotation);
      }
    }
  };

  const renderDetections = (
    ctx: CanvasRenderingContext2D,
    dets: Detection[],
    color: string,
    lineWidth: number
  ) => {
    for (const det of dets) {
      const [bx, by, bw, bh] = det.bbox;
      const x = bx * width;
      const y = by * height;
      const w = bw * width;
      const h = bh * height;

      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.strokeRect(x, y, w, h);
      ctx.shadowBlur = 0;

      const label = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
      ctx.font = "12px 'JetBrains Mono', monospace";
      const textW = ctx.measureText(label).width;
      ctx.fillStyle = color + "D9";
      ctx.fillRect(x, y - 18, textW + 8, 18);
      ctx.fillStyle = "#0A0E17";
      ctx.fillText(label, x + 4, y - 5);
    }
  };

  const renderAnomalies = (ctx: CanvasRenderingContext2D, anomalies: AnomalyEvent[]) => {
    const time = Date.now() / 1000;
    for (const anomaly of anomalies) {
      const [bx, by, bw, bh] = anomaly.bbox;
      const x = bx * width;
      const y = by * height;
      const w = bw * width;
      const h = bh * height;

      const pulseScale = 1 + 0.1 * Math.sin(time * 4);
      const cx = x + w / 2;
      const cy = y + h / 2;
      const pw = w * pulseScale;
      const ph = h * pulseScale;
      const px = cx - pw / 2;
      const py = cy - ph / 2;

      const severityColor = anomaly.severity === "high"
        ? "#FF3D71"
        : anomaly.severity === "medium"
        ? "#FFA500"
        : "#FFD700";

      ctx.strokeStyle = severityColor;
      ctx.lineWidth = 4;
      ctx.shadowColor = severityColor;
      ctx.shadowBlur = 12 + 6 * Math.sin(time * 4);
      ctx.strokeRect(px, py, pw, ph);
      ctx.shadowBlur = 0;

      const badgeLabel = `ANOMALY: ${anomaly.label.replace("_", " ")}`;
      ctx.font = "bold 11px 'JetBrains Mono', monospace";
      const badgeW = ctx.measureText(badgeLabel).width;
      ctx.fillStyle = severityColor;
      ctx.fillRect(x, y - 22, badgeW + 12, 20);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(badgeLabel, x + 6, y - 8);
    }
  };

  const renderAnnotations = (ctx: CanvasRenderingContext2D, annotations: Annotation[]) => {
    for (const ann of annotations) {
      if (ann.type === "bbox" && ann.bbox) {
        const [bx, by, bw, bh] = ann.bbox;
        const x = bx * width;
        const y = by * height;
        const w = bw * width;
        const h = bh * height;

        ctx.strokeStyle = "#3B82F6";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);

        ctx.font = "11px 'JetBrains Mono', monospace";
        const labelW = ctx.measureText(ann.label).width;
        ctx.fillStyle = "#3B82F6";
        ctx.fillRect(x, y - 16, labelW + 8, 16);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(ann.label, x + 4, y - 4);
      } else if (ann.type === "polygon" && ann.points) {
        ctx.strokeStyle = "#3B82F6";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ann.points.forEach((p, i) => {
          const px = p.x * width;
          const py = p.y * height;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  };

  const renderCurrentAnnotation = (ctx: CanvasRenderingContext2D, ann: Annotation) => {
    if (ann.type === "bbox" && ann.bbox) {
      const [bx, by, bw, bh] = ann.bbox;
      const x = bx * width;
      const y = by * height;
      const w = bw * width;
      const h = bh * height;

      ctx.strokeStyle = "#F59E0B";
      ctx.lineWidth = 3;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);

      const handleSize = 8;
      ctx.fillStyle = "#F59E0B";
      const corners = [
        [x, y],
        [x + w, y],
        [x, y + h],
        [x + w, y + h],
        [x + w / 2, y],
        [x + w / 2, y + h],
        [x, y + h / 2],
        [x + w, y + h / 2],
      ];
      for (const [hx, hy] of corners) {
        ctx.fillRect(hx - handleSize / 2, hy - handleSize / 2, handleSize, handleSize);
      }

      ctx.font = "11px 'JetBrains Mono', monospace";
      const labelW = ctx.measureText(ann.label).width;
      ctx.fillStyle = "#F59E0B";
      ctx.fillRect(x, y - 16, labelW + 8, 16);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillText(ann.label, x + 4, y - 4);
    }
  };

  const renderCompareMode = (ctx: CanvasRenderingContext2D, compareData: any) => {
    const midX = width / 2;

    ctx.strokeStyle = "#64748B";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(midX, 0);
    ctx.lineTo(midX, height);
    ctx.stroke();

    ctx.font = "14px 'JetBrains Mono', monospace";
    ctx.fillStyle = "#00E5A0";
    ctx.fillText("BASELINE", 10, 25);
    ctx.fillStyle = "#3B82F6";
    ctx.fillText("CURRENT", midX + 10, 25);

    if (compareData.baseline?.detections) {
      for (const det of compareData.baseline.detections) {
        const [bx, by, bw, bh] = det.bbox;
        const x = bx * width * 0.5;
        const y = by * height;
        const w = bw * width * 0.5;
        const h = bh * height;

        ctx.strokeStyle = "#00E5A0";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        const label = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
        const textW = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(0, 229, 160, 0.85)";
        ctx.fillRect(x, y - 18, textW + 8, 18);
        ctx.fillStyle = "#0A0E17";
        ctx.fillText(label, x + 4, y - 5);
      }
    }

    if (compareData.current?.detections) {
      for (const det of compareData.current.detections) {
        const [bx, by, bw, bh] = det.bbox;
        const x = midX + bx * width * 0.5;
        const y = by * height;
        const w = bw * width * 0.5;
        const h = bh * height;

        ctx.strokeStyle = "#3B82F6";
        ctx.lineWidth = 2;
        ctx.strokeRect(x, y, w, h);

        const label = `${det.label} ${(det.confidence * 100).toFixed(0)}%`;
        const textW = ctx.measureText(label).width;
        ctx.fillStyle = "rgba(59, 130, 246, 0.85)";
        ctx.fillRect(x, y - 18, textW + 8, 18);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(label, x + 4, y - 5);
      }
    }

    if (compareData.differences?.newDetections) {
      for (const det of compareData.differences.newDetections) {
        const [bx, by, bw, bh] = det.bbox;
        const x = midX + bx * width * 0.5;
        const y = by * height;
        const w = bw * width * 0.5;
        const h = bh * height;

        ctx.strokeStyle = "#FF3D71";
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 3]);
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);

        ctx.fillStyle = "#FF3D71";
        ctx.fillRect(x, y - 18, 50, 18);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText("NEW", x + 4, y - 5);
      }
    }
  };

  return (
    <canvas
      ref={canvasRef}
      width={width}
      height={height}
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
}
