import { useState, useEffect, useRef, useCallback } from "react";
import { Play, Pause, Clock, TrendingUp, AlertTriangle } from "lucide-react";

interface SnapshotCompareProps {
  sourceId: string;
  width?: number;
  height?: number;
}

interface HeatmapData {
  grid: number[][];
  maxDensity: number;
}

interface SnapshotComparison {
  current: HeatmapData;
  previous: HeatmapData;
  countDiff: number;
  percentageDiff: number;
  anomalyDiff: number;
  currentCount: number;
  previousCount: number;
  trendData: {
    labels: string[];
    current: number[];
    previous: number[];
  };
}

const DIFFERENCE_THRESHOLD = 0.3;

export default function SnapshotCompare({
  sourceId,
  width = 800,
  height = 400,
}: SnapshotCompareProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeOffset, setTimeOffset] = useState(0);
  const [comparison, setComparison] = useState<SnapshotComparison | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const canvasRefCurrent = useRef<HTMLCanvasElement>(null);
  const canvasRefPrevious = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);

  const fetchComparison = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetch(`/api/snapshots/compare/${sourceId}?offset=${timeOffset}`);
      if (!res.ok) throw new Error("Failed to fetch comparison");
      const data = await res.json();
      setComparison(data);
    } catch {
      setComparison(null);
    } finally {
      setIsLoading(false);
    }
  }, [sourceId, timeOffset]);

  useEffect(() => {
    fetchComparison();
  }, [fetchComparison]);

  useEffect(() => {
    if (!isPlaying) {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
      return;
    }

    let lastTime = performance.now();
    const animate = (now: number) => {
      if (now - lastTime >= 1000) {
        setTimeOffset((prev) => (prev + 1) % 24);
        lastTime = now;
      }
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [isPlaying]);

  useEffect(() => {
    if (!comparison) return;

    const renderHeatmap = (
      canvas: HTMLCanvasElement,
      data: HeatmapData,
      color: [number, number, number]
    ) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { grid, maxDensity } = data;
      const canvasW = canvas.width;
      const canvasH = canvas.height;
      const gridH = grid.length;
      const gridW = grid[0]?.length || 0;

      if (gridW === 0 || gridH === 0) return;

      const cellW = canvasW / gridW;
      const cellH = canvasH / gridH;

      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          const intensity = maxDensity > 0 ? grid[y][x] / maxDensity : 0;
          const alpha = Math.min(intensity, 1) * 0.7;
          ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
          ctx.fillRect(x * cellW, y * cellH, cellW + 1, cellH + 1);
        }
      }
    };

    const renderDifference = (
      canvas: HTMLCanvasElement,
      current: HeatmapData,
      previous: HeatmapData
    ) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const { grid: currGrid, maxDensity: currMax } = current;
      const { grid: prevGrid, maxDensity: prevMax } = previous;
      const canvasW = canvas.width;
      const canvasH = canvas.height;
      const gridH = currGrid.length;
      const gridW = currGrid[0]?.length || 0;

      if (gridW === 0 || gridH === 0) return;

      const cellW = canvasW / gridW;
      const cellH = canvasH / gridH;

      for (let y = 0; y < gridH; y++) {
        for (let x = 0; x < gridW; x++) {
          const currVal = currMax > 0 ? currGrid[y][x] / currMax : 0;
          const prevVal = prevMax > 0 ? (prevGrid[y]?.[x] || 0) / prevMax : 0;
          const diff = Math.abs(currVal - prevVal);

          if (diff > DIFFERENCE_THRESHOLD) {
            ctx.strokeStyle = "rgba(239, 68, 68, 0.8)";
            ctx.lineWidth = 2;
            ctx.strokeRect(x * cellW + 1, y * cellH + 1, cellW - 2, cellH - 2);
          }
        }
      }
    };

    if (canvasRefCurrent.current) {
      renderHeatmap(canvasRefCurrent.current, comparison.current, [0, 229, 160]);
      renderDifference(canvasRefCurrent.current, comparison.current, comparison.previous);
    }

    if (canvasRefPrevious.current) {
      renderHeatmap(canvasRefPrevious.current, comparison.previous, [59, 130, 246]);
    }
  }, [comparison]);

  useEffect(() => {
    if (!comparison || !chartRef.current) return;

    const canvas = chartRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { trendData } = comparison;
    const canvasW = canvas.width;
    const canvasH = canvas.height;
    const padding = { top: 20, right: 20, bottom: 30, left: 50 };
    const chartW = canvasW - padding.left - padding.right;
    const chartH = canvasH - padding.top - padding.bottom;

    ctx.clearRect(0, 0, canvasW, canvasH);

    const allValues = [...trendData.current, ...trendData.previous];
    const maxVal = Math.max(...allValues, 1);
    const minVal = Math.min(...allValues, 0);
    const valRange = maxVal - minVal || 1;

    ctx.strokeStyle = "#1E293B";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartH * i) / 4;
      ctx.beginPath();
      ctx.moveTo(padding.left, y);
      ctx.lineTo(canvasW - padding.right, y);
      ctx.stroke();

      const val = maxVal - (valRange * i) / 4;
      ctx.fillStyle = "#64748B";
      ctx.font = "10px 'JetBrains Mono', monospace";
      ctx.textAlign = "right";
      ctx.fillText(val.toFixed(0), padding.left - 8, y + 4);
    }

    const drawLine = (data: number[], color: string) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();

      data.forEach((val, i) => {
        const x = padding.left + (chartW * i) / (data.length - 1);
        const y = padding.top + chartH - ((val - minVal) / valRange) * chartH;

        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });

      ctx.stroke();
    };

    drawLine(trendData.current, "#00E5A0");
    drawLine(trendData.previous, "#3B82F6");

    trendData.labels.forEach((label, i) => {
      const x = padding.left + (chartW * i) / (trendData.labels.length - 1);
      ctx.fillStyle = "#64748B";
      ctx.font = "9px 'JetBrains Mono', monospace";
      ctx.textAlign = "center";
      ctx.fillText(label, x, canvasH - 8);
    });
  }, [comparison]);

  const formatDiff = (diff: number) => {
    const sign = diff >= 0 ? "+" : "";
    return `${sign}${diff.toFixed(1)}`;
  };

  const formatPercentage = (pct: number) => {
    const sign = pct >= 0 ? "+" : "";
    return `${sign}${pct.toFixed(1)}%`;
  };

  return (
    <div
      style={{
        background: "rgba(10, 14, 23, 0.95)",
        backdropFilter: "blur(8px)",
        border: "1px solid #1E293B",
        borderRadius: 8,
        padding: 16,
        width,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <TrendingUp size={18} style={{ color: "#00E5A0" }} />
          <span style={{ color: "#F1F5F9", fontWeight: 600, fontSize: 14 }}>
            Snapshot Comparison
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            style={{
              padding: 6,
              background: "rgba(0, 229, 160, 0.2)",
              border: "1px solid #00E5A0",
              borderRadius: 6,
              color: "#00E5A0",
              cursor: "pointer",
            }}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div
          style={{
            padding: 40,
            textAlign: "center",
            color: "#64748B",
            fontSize: 13,
          }}
        >
          Loading comparison data...
        </div>
      ) : (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 8,
                  fontSize: 12,
                  color: "#00E5A0",
                }}
              >
                <div
                  style={{ width: 10, height: 10, background: "#00E5A0", borderRadius: 2 }}
                />
                Current
              </div>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: height / 2,
                  background: "#0F172A",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <canvas
                  ref={canvasRefCurrent}
                  width={width / 2 - 22}
                  height={height / 2}
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
            </div>

            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 8,
                  fontSize: 12,
                  color: "#3B82F6",
                }}
              >
                <div
                  style={{ width: 10, height: 10, background: "#3B82F6", borderRadius: 2 }}
                />
                24h Ago
              </div>
              <div
                style={{
                  position: "relative",
                  width: "100%",
                  height: height / 2,
                  background: "#0F172A",
                  borderRadius: 4,
                  overflow: "hidden",
                }}
              >
                <canvas
                  ref={canvasRefPrevious}
                  width={width / 2 - 22}
                  height={height / 2}
                  style={{ width: "100%", height: "100%" }}
                />
              </div>
            </div>
          </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div
          style={{
            padding: 12,
            background: "rgba(15, 23, 42, 0.5)",
            borderRadius: 6,
            border: "1px solid #1E293B",
          }}
        >
          <div style={{ color: "#64748B", fontSize: 11, marginBottom: 4 }}>
            Count Diff
          </div>
          <div
            style={{
              color: comparison && comparison.countDiff >= 0 ? "#00E5A0" : "#EF4444",
              fontSize: 20,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {comparison ? formatDiff(comparison.countDiff) : "--"}
          </div>
          <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>
            {comparison
              ? `${comparison.currentCount} vs ${comparison.previousCount}`
              : "--"}
          </div>
        </div>

        <div
          style={{
            padding: 12,
            background: "rgba(15, 23, 42, 0.5)",
            borderRadius: 6,
            border: "1px solid #1E293B",
          }}
        >
          <div style={{ color: "#64748B", fontSize: 11, marginBottom: 4 }}>
            Percentage
          </div>
          <div
            style={{
              color:
                comparison && comparison.percentageDiff >= 0 ? "#00E5A0" : "#EF4444",
              fontSize: 20,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {comparison ? formatPercentage(comparison.percentageDiff) : "--"}
          </div>
          <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>
            vs previous
          </div>
        </div>

        <div
          style={{
            padding: 12,
            background: "rgba(15, 23, 42, 0.5)",
            borderRadius: 6,
            border: "1px solid #1E293B",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              color: "#64748B",
              fontSize: 11,
              marginBottom: 4,
            }}
          >
            <AlertTriangle size={12} />
            Anomaly Diff
          </div>
          <div
            style={{
              color: comparison && comparison.anomalyDiff > 0 ? "#F59E0B" : "#00E5A0",
              fontSize: 20,
              fontWeight: 700,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            {comparison ? formatDiff(comparison.anomalyDiff) : "--"}
          </div>
          <div style={{ color: "#475569", fontSize: 10, marginTop: 2 }}>
            24h change
          </div>
        </div>
      </div>

      <div
        style={{
          background: "rgba(15, 23, 42, 0.5)",
          borderRadius: 6,
          border: "1px solid #1E293B",
          padding: 12,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 8,
            fontSize: 12,
            color: "#94A3B8",
          }}
        >
          <Clock size={14} />
          Count Trend (24h)
        </div>
        <canvas
          ref={chartRef}
          width={width - 56}
          height={120}
          style={{ width: "100%", height: 120 }}
        />
      </div>

      <div style={{ marginTop: 16 }}>
        <input
          type="range"
          min="0"
          max="23"
          value={timeOffset}
          onChange={(e) => setTimeOffset(Number(e.target.value))}
          style={{
            width: "100%",
            accentColor: "#00E5A0",
          }}
        />
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            color: "#64748B",
            fontSize: 10,
            marginTop: 4,
          }}
        >
          <span>00:00</span>
          <span>{timeOffset.toString().padStart(2, "0")}:00</span>
          <span>23:00</span>
        </div>
      </div>
        </>
      )}
    </div>
  );
}
