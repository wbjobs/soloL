import { useRef, useEffect, useState } from "react";
import type { HeatmapData } from "@/types";

interface HeatmapOverlayProps {
  data: HeatmapData | null;
  width: number;
  height: number;
}

export default function HeatmapOverlay({ data, width, height }: HeatmapOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [opacity, setOpacity] = useState(0.6);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !data) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    const { grid, maxDensity } = data;
    const rows = grid.length;
    if (rows === 0) return;
    const cols = grid[0].length;
    const cellW = width / cols;
    const cellH = height / rows;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = grid[r][c];
        const norm = maxDensity > 0 ? val / maxDensity : 0;
        if (norm < 0.01) continue;

        const red = 255;
        const green = Math.floor(255 * (1 - norm));
        ctx.fillStyle = `rgba(${red}, ${green}, 0, ${norm * opacity})`;
        ctx.fillRect(c * cellW, r * cellH, cellW, cellH);
      }
    }
  }, [data, width, height, opacity]);

  if (!data) return null;

  return (
    <div className="pointer-events-auto absolute inset-0">
      <canvas
        ref={canvasRef}
        width={width}
        height={height}
        className="h-full w-full"
      />
      <div className="absolute bottom-2 right-2 flex items-center gap-2 rounded bg-[#1A1F2E]/80 px-2 py-1">
        <span className="text-xs text-[#64748B]">透明度</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => setOpacity(parseFloat(e.target.value))}
          className="h-1 w-20 cursor-pointer accent-[#00E5A0]"
        />
      </div>
    </div>
  );
}
