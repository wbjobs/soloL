import React, { useEffect, useRef, useMemo, useCallback } from 'react';
import type { HeatmapData } from '../types';
import { Grid3X3, ZoomIn, ZoomOut } from 'lucide-react';

const MAX_RENDER_BINS = 5000;
const MAX_RENDER_POINTS = 2000;

interface MatrixHeatmapProps {
  data: HeatmapData | null;
  loading?: boolean;
}

export const MatrixHeatmap: React.FC<MatrixHeatmapProps> = ({ data, loading }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = React.useState(1);

  const colorScale = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1;
    const ctx = canvas.getContext('2d')!;
    const gradient = ctx.createLinearGradient(0, 0, 256, 0);
    gradient.addColorStop(0, 'rgba(15, 23, 42, 0)');
    gradient.addColorStop(0.2, 'rgba(59, 130, 246, 0.3)');
    gradient.addColorStop(0.5, 'rgba(147, 51, 234, 0.6)');
    gradient.addColorStop(0.8, 'rgba(236, 72, 153, 0.8)');
    gradient.addColorStop(1, 'rgba(251, 191, 36, 1)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 256, 1);
    return ctx.getImageData(0, 0, 256, 1).data;
  }, []);

  const sampledData = useMemo(() => {
    if (!data) return null;

    let bins = data.bins;
    if (bins.length > MAX_RENDER_BINS) {
      const step = Math.ceil(bins.length / MAX_RENDER_BINS);
      bins = bins.filter((_, i) => i % step === 0);
    }

    let samplePoints = data.samplePoints;
    if (samplePoints.length > MAX_RENDER_POINTS) {
      const step = Math.ceil(samplePoints.length / MAX_RENDER_POINTS);
      samplePoints = samplePoints.filter((_, i) => i % step === 0);
    }

    return { ...data, bins, samplePoints };
  }, [data]);

  const totalNnz = useMemo(() => {
    if (!data) return 0;
    let sum = 0;
    for (const b of data.bins) sum += b.count;
    return sum;
  }, [data]);

  const drawHeatmap = useCallback(() => {
    if (!sampledData || !canvasRef.current || !containerRef.current || loading) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;
    const ctx = canvas.getContext('2d')!;

    const maxSize = Math.min(container.clientWidth, 600);
    const { rows, cols } = sampledData;

    const scale = Math.min(maxSize / rows, maxSize / cols) * zoom;
    const displayRows = Math.floor(rows * scale);
    const displayCols = Math.floor(cols * scale);

    canvas.width = displayCols;
    canvas.height = displayRows;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, displayCols, displayRows);

    if (sampledData.bins.length === 0) return;

    const maxCount = Math.max(...sampledData.bins.map((b) => b.count), 1);
    const numBins = sampledData.numBins;

    const binPixelSize = Math.min(displayRows, displayCols) / numBins;

    for (const bin of sampledData.bins) {
      const intensity = Math.min(bin.count / maxCount, 1);
      const colorIdx = Math.floor(intensity * 255);
      const r = colorScale[colorIdx * 4];
      const g = colorScale[colorIdx * 4 + 1];
      const b = colorScale[colorIdx * 4 + 2];
      const a = colorScale[colorIdx * 4 + 3] / 255;

      ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${Math.max(a, 0.1)})`;
      ctx.fillRect(
        bin.x * binPixelSize,
        bin.y * binPixelSize,
        binPixelSize + 0.5,
        binPixelSize + 0.5
      );
    }

    if (sampledData.samplePoints.length > 0 && zoom > 1.5) {
      const xScale = displayCols / cols;
      const yScale = displayRows / rows;

      for (const point of sampledData.samplePoints) {
        const intensity = Math.min(Math.abs(point.value) / 10, 1);
        ctx.fillStyle = `rgba(255, 255, 255, ${0.3 + intensity * 0.5})`;
        ctx.beginPath();
        ctx.arc(point.x * xScale, point.y * yScale, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }, [sampledData, loading, zoom, colorScale]);

  useEffect(() => {
    drawHeatmap();
  }, [drawHeatmap]);

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Grid3X3 className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">非零元分布热力图</h3>
        </div>
        <div className="aspect-square bg-slate-900 rounded-lg animate-pulse flex items-center justify-center">
          <div className="text-slate-500 text-sm">正在生成热力图...</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Grid3X3 className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">非零元分布热力图</h3>
        </div>
        <div className="aspect-square bg-slate-900/50 rounded-lg flex items-center justify-center border-2 border-dashed border-slate-700">
          <div className="text-center text-slate-500">
            <Grid3X3 className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">上传矩阵后显示</p>
          </div>
        </div>
      </div>
    );
  }

  const isSampled = data.bins.length > MAX_RENDER_BINS || (data.samplePoints?.length || 0) > MAX_RENDER_POINTS;

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Grid3X3 className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-slate-200">非零元分布热力图</h3>
          {isSampled && (
            <span className="text-xs text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded-full">
              采样渲染
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
            className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            <ZoomOut className="w-4 h-4 text-slate-300" />
          </button>
          <span className="text-sm text-slate-400 font-mono w-16 text-center">
            {(zoom * 100).toFixed(0)}%
          </span>
          <button
            onClick={() => setZoom((z) => Math.min(3, z + 0.25))}
            className="p-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 transition-colors"
          >
            <ZoomIn className="w-4 h-4 text-slate-300" />
          </button>
        </div>
      </div>

      <div ref={containerRef} className="relative">
        <div className="aspect-square bg-slate-900 rounded-lg overflow-hidden flex items-center justify-center">
          <canvas
            ref={canvasRef}
            className="max-w-full max-h-full"
            style={{ imageRendering: 'pixelated' }}
          />
        </div>

        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end">
          <div className="bg-slate-900/80 backdrop-blur-sm px-3 py-2 rounded-lg">
            <div className="text-xs text-slate-400">矩阵维度</div>
            <div className="font-mono text-sm text-white">
              {data.rows.toLocaleString()} × {data.cols.toLocaleString()}
            </div>
          </div>
          <div className="bg-slate-900/80 backdrop-blur-sm px-3 py-2 rounded-lg">
            <div className="text-xs text-slate-400">非零元</div>
            <div className="font-mono text-sm text-blue-400">
              {totalNnz.toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-4">
        <div className="flex-1 h-3 rounded-full bg-gradient-to-r from-slate-800 via-blue-500/50 to-amber-400" />
        <div className="flex justify-between w-full text-xs text-slate-400">
          <span>稀疏</span>
          <span>密集</span>
        </div>
      </div>
    </div>
  );
};
