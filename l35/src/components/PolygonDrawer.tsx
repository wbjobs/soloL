import { useRef, useState, useEffect, useCallback } from "react";
import type { DefenseRegion } from "@/types";

interface PolygonDrawerProps {
  existingRegions: DefenseRegion[];
  onPolygonComplete: (polygon: Array<{ x: number; y: number }>) => void;
  width: number;
  height: number;
}

export default function PolygonDrawer({
  existingRegions,
  onPolygonComplete,
  width,
  height,
}: PolygonDrawerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [vertices, setVertices] = useState<Array<{ x: number; y: number }>>([]);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [isClosed, setIsClosed] = useState(false);

  const toNorm = useCallback(
    (px: number, py: number) => ({
      x: px / width,
      y: py / height,
    }),
    [width, height]
  );

  const toPixel = useCallback(
    (nx: number, ny: number) => ({
      x: nx * width,
      y: ny * height,
    }),
    [width, height]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);

    for (const region of existingRegions) {
      if (region.polygon.length < 3) continue;
      ctx.beginPath();
      const first = toPixel(region.polygon[0].x, region.polygon[0].y);
      ctx.moveTo(first.x, first.y);
      for (let i = 1; i < region.polygon.length; i++) {
        const p = toPixel(region.polygon[i].x, region.polygon[i].y);
        ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(0, 229, 160, 0.08)";
      ctx.fill();
      ctx.strokeStyle = "rgba(0, 229, 160, 0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    if (vertices.length < 2) {
      for (const v of vertices) {
        const p = toPixel(v.x, v.y);
        ctx.fillStyle = "#00E5A0";
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    ctx.beginPath();
    const first = toPixel(vertices[0].x, vertices[0].y);
    ctx.moveTo(first.x, first.y);
    for (let i = 1; i < vertices.length; i++) {
      const p = toPixel(vertices[i].x, vertices[i].y);
      ctx.lineTo(p.x, p.y);
    }
    if (isClosed) {
      ctx.closePath();
      ctx.fillStyle = "rgba(0, 229, 160, 0.15)";
      ctx.fill();
    }
    ctx.strokeStyle = "#00E5A0";
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const v of vertices) {
      const p = toPixel(v.x, v.y);
      ctx.fillStyle = "#00E5A0";
      ctx.strokeStyle = "#0A0E17";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }, [vertices, existingRegions, isClosed, toPixel, width, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (isClosed) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * width;
      const py = ((e.clientY - rect.top) / rect.height) * height;
      const norm = toNorm(px, py);

      if (vertices.length >= 3) {
        const first = toPixel(vertices[0].x, vertices[0].y);
        const dist = Math.hypot(px - first.x, py - first.y);
        if (dist < 15) {
          setIsClosed(true);
          onPolygonComplete(vertices);
          return;
        }
      }

      setVertices((prev) => [...prev, norm]);
    },
    [isClosed, vertices, onPolygonComplete, toNorm, toPixel, width, height]
  );

  const handleDoubleClick = useCallback(() => {
    if (isClosed || vertices.length < 3) return;
    setIsClosed(true);
    onPolygonComplete(vertices);
  }, [isClosed, vertices, onPolygonComplete]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * width;
      const py = ((e.clientY - rect.top) / rect.height) * height;

      for (let i = 0; i < vertices.length; i++) {
        const p = toPixel(vertices[i].x, vertices[i].y);
        if (Math.hypot(px - p.x, py - p.y) < 10) {
          setDragIdx(i);
          return;
        }
      }
    },
    [vertices, toPixel, width, height]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (dragIdx === null) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const px = ((e.clientX - rect.left) / rect.width) * width;
      const py = ((e.clientY - rect.top) / rect.height) * height;
      const norm = toNorm(px, py);
      setVertices((prev) => {
        const next = [...prev];
        next[dragIdx] = norm;
        return next;
      });
    },
    [dragIdx, toNorm, width, height]
  );

  const handleMouseUp = useCallback(() => {
    setDragIdx(null);
  }, []);

  const reset = useCallback(() => {
    setVertices([]);
    setIsClosed(false);
    setDragIdx(null);
  }, []);

  return (
    <div className="absolute inset-0">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="h-full w-full cursor-crosshair"
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      />
      <button
        onClick={reset}
        className="absolute right-2 top-2 rounded bg-[#1A1F2E] px-2 py-1 text-xs text-[#00E5A0] border border-[#2A3040] hover:bg-[#2A3040]"
      >
        重绘
      </button>
    </div>
  );
}
