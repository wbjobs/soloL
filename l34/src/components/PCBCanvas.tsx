import { useRef, useEffect, useCallback, useState } from 'react';
import { useStore } from '@/store/useStore';
import {
  createWebGLHeatmapRenderer,
  type WebGLHeatmapRenderer,
} from '@/utils/webglHeatmap';
import type { FieldType, HeatSource, HeatSourceType } from '@/types';

const GRID_SIZE = 20;
const DEFAULT_SOURCE_SIZE: Record<HeatSourceType, { w: number; h: number }> = {
  resistor: { w: 6, h: 2 },
  ic_chip: { w: 12, h: 12 },
  custom: { w: 10, h: 10 },
};
const DEFAULT_POWER: Record<HeatSourceType, number> = {
  resistor: 0.25,
  ic_chip: 1.0,
  custom: 0.5,
};

function generateId(): string {
  return `hs_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export default function PCBCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const glRendererRef = useRef<WebGLHeatmapRenderer | null>(null);
  const lastSimKey = useRef<string>('');

  const boardData = useStore((s) => s.boardData);
  const heatSources = useStore((s) => s.heatSources);
  const simResult = useStore((s) => s.simResult);
  const selectedTool = useStore((s) => s.selectedTool);
  const canvasState = useStore((s) => s.canvasState);
  const selectedHeatSourceId = useStore((s) => s.selectedHeatSourceId);
  const selectedLayer = useStore((s) => s.selectedLayer);
  const fieldType = useStore((s) => s.fieldType);

  const addHeatSource = useStore((s) => s.addHeatSource);
  const setCanvasState = useStore((s) => s.setCanvasState);
  const setSelectedHeatSourceId = useStore((s) => s.setSelectedHeatSourceId);
  const setSelectedTool = useStore((s) => s.setSelectedTool);

  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    value: number;
    type: FieldType;
  } | null>(null);

  const isPanning = useRef(false);
  const panStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });
  const canvasSize = useRef({ w: 0, h: 0 });

  useEffect(() => {
    const glCanvas = glCanvasRef.current;
    if (!glCanvas) return;
    const renderer = createWebGLHeatmapRenderer(glCanvas);
    glRendererRef.current = renderer;
    return () => {
      if (renderer) {
        renderer.dispose();
        glRendererRef.current = null;
      }
    };
  }, []);

  const updateGLHeatmap = useCallback(() => {
    const renderer = glRendererRef.current;
    if (!renderer || !simResult || !boardData) return;

    const key = `${simResult.board_id}_${simResult.max_temp}_${simResult.min_temp}_${simResult.grid_rows}_${simResult.grid_cols}_${selectedLayer}_${fieldType}`;
    if (key === lastSimKey.current) return;
    lastSimKey.current = key;

    let dataMatrix: number[][] | null = null;
    let minVal: number = 0;
    let maxVal: number = 0;

    if (fieldType === 'temperature') {
      const matrices = simResult.temperature_matrices;
      if (matrices && matrices.length > selectedLayer) {
        dataMatrix = matrices[selectedLayer];
        minVal = simResult.min_temp;
        maxVal = simResult.max_temp;
      }
    } else if (fieldType === 'current_density' && simResult.current_density) {
      dataMatrix = simResult.current_density;
      minVal = 0;
      maxVal = simResult.max_current_density || 1;
    } else if (fieldType === 'heat_flow_x' && simResult.heat_flow) {
      const qx = simResult.heat_flow.qx;
      if (qx && qx.length > selectedLayer) {
        dataMatrix = qx[selectedLayer];
        minVal = -Math.max(Math.abs(Math.min(...qx[selectedLayer].flat())), Math.abs(Math.max(...qx[selectedLayer].flat())));
        maxVal = Math.max(Math.abs(Math.min(...qx[selectedLayer].flat())), Math.abs(Math.max(...qx[selectedLayer].flat())));
      }
    } else if (fieldType === 'heat_flow_y' && simResult.heat_flow) {
      const qy = simResult.heat_flow.qy;
      if (qy && qy.length > selectedLayer) {
        dataMatrix = qy[selectedLayer];
        minVal = -Math.max(Math.abs(Math.min(...qy[selectedLayer].flat())), Math.abs(Math.max(...qy[selectedLayer].flat())));
        maxVal = Math.max(Math.abs(Math.min(...qy[selectedLayer].flat())), Math.abs(Math.max(...qy[selectedLayer].flat())));
      }
    }

    if (dataMatrix) {
      renderer.updateTemperatureData(
        dataMatrix,
        simResult.grid_rows,
        simResult.grid_cols
      );
      renderer.valueRange = { min: minVal, max: maxVal };
    }
  }, [simResult, boardData, selectedLayer, fieldType]);

  const screenToWorld = useCallback(
    (sx: number, sy: number) => {
      const cx = canvasSize.current.w / 2;
      const cy = canvasSize.current.h / 2;
      let wx = (sx - cx - canvasState.panX) / canvasState.zoom;
      let wy = (sy - cy - canvasState.panY) / canvasState.zoom;
      if (boardData) {
        wx += boardData.dimensions.width / 2;
        wy += boardData.dimensions.height / 2;
      }
      return { x: wx, y: wy };
    },
    [canvasState.zoom, canvasState.panX, canvasState.panY, boardData]
  );

  const worldToScreen = useCallback(
    (wx: number, wy: number) => {
      if (boardData) {
        wx -= boardData.dimensions.width / 2;
        wy -= boardData.dimensions.height / 2;
      }
      const cx = canvasSize.current.w / 2;
      const cy = canvasSize.current.h / 2;
      return {
        x: wx * canvasState.zoom + cx + canvasState.panX,
        y: wy * canvasState.zoom + cy + canvasState.panY,
      };
    },
    [canvasState.zoom, canvasState.panX, canvasState.panY, boardData]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvasSize.current.w;
    const h = canvasSize.current.h;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = '#0A1520';
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    const cx = w / 2;
    const cy = h / 2;
    ctx.translate(cx + canvasState.panX, cy + canvasState.panY);
    ctx.scale(canvasState.zoom, canvasState.zoom);
    if (boardData) {
      ctx.translate(-boardData.dimensions.width / 2, -boardData.dimensions.height / 2);
    }

    drawGrid(ctx, w, h);

    if (boardData) {
      drawBoard(ctx);
      drawComponents(ctx);
      drawHeatSources(ctx);
    }

    ctx.restore();
  }, [boardData, heatSources, simResult, canvasState, selectedHeatSourceId]);

  const renderGLHeatmap = useCallback(() => {
    const renderer = glRendererRef.current;
    if (!renderer || !simResult || !boardData) return;

    updateGLHeatmap();

    const bw = boardData.dimensions.width;
    const bh = boardData.dimensions.height;
    const topLeft = worldToScreen(0, 0);
    const bottomRight = worldToScreen(bw, bh);
    const boardX = topLeft.x;
    const boardY = topLeft.y;
    const boardW = bottomRight.x - topLeft.x;
    const boardH = bottomRight.y - topLeft.y;

    renderer.render(
      boardX,
      boardY,
      boardW,
      boardH,
      canvasSize.current.w,
      canvasSize.current.h,
      canvasState.zoom,
      simResult.min_temp,
      simResult.max_temp
    );
  }, [simResult, boardData, canvasState, worldToScreen, updateGLHeatmap]);

  function drawGrid(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const zoom = canvasState.zoom;
    const panX = canvasState.panX;
    const panY = canvasState.panY;
    const halfW = w / 2;
    const halfH = h / 2;

    const startX = Math.floor((-halfW - panX) / zoom / GRID_SIZE) * GRID_SIZE;
    const endX = Math.ceil((halfW - panX) / zoom / GRID_SIZE) * GRID_SIZE;
    const startY = Math.floor((-halfH - panY) / zoom / GRID_SIZE) * GRID_SIZE;
    const endY = Math.ceil((halfH - panY) / zoom / GRID_SIZE) * GRID_SIZE;

    ctx.strokeStyle = 'rgba(0, 245, 212, 0.05)';
    ctx.lineWidth = 0.5 / zoom;
    ctx.beginPath();
    for (let x = startX; x <= endX; x += GRID_SIZE) {
      ctx.moveTo(x, startY);
      ctx.lineTo(x, endY);
    }
    for (let y = startY; y <= endY; y += GRID_SIZE) {
      ctx.moveTo(startX, y);
      ctx.lineTo(endY, y);
    }
    ctx.stroke();
  }

  function drawBoard(ctx: CanvasRenderingContext2D) {
    if (!boardData) return;

    const { outline, traces, pads } = boardData;
    const bw = boardData.dimensions.width;
    const bh = boardData.dimensions.height;

    if (outline.length > 0) {
      ctx.beginPath();
      ctx.moveTo(outline[0][0], outline[0][1]);
      for (let i = 1; i < outline.length; i++) {
        ctx.lineTo(outline[i][0], outline[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(0, 80, 40, 0.3)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = 'rgba(0, 80, 40, 0.3)';
      ctx.fillRect(0, 0, bw, bh);
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.4)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(0, 0, bw, bh);
    }

    ctx.strokeStyle = 'rgba(200, 160, 50, 0.5)';
    ctx.lineCap = 'round';
    for (const trace of traces) {
      ctx.lineWidth = trace.width;
      ctx.beginPath();
      ctx.moveTo(trace.start_x, trace.start_y);
      ctx.lineTo(trace.end_x, trace.end_y);
      ctx.stroke();
    }

    for (const pad of pads) {
      ctx.fillStyle = 'rgba(200, 160, 50, 0.6)';
      if (pad.shape === 'circle') {
        const r = Math.max(pad.width, pad.height) / 2;
        ctx.beginPath();
        ctx.arc(pad.x, pad.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(
          pad.x - pad.width / 2,
          pad.y - pad.height / 2,
          pad.width,
          pad.height
        );
      }
    }
  }

  function drawComponents(ctx: CanvasRenderingContext2D) {
    if (!boardData) return;
    for (const comp of boardData.components) {
      ctx.strokeStyle = 'rgba(0, 245, 212, 0.25)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(
        comp.x - comp.width / 2,
        comp.y - comp.height / 2,
        comp.width,
        comp.height
      );
      ctx.fillStyle = 'rgba(0, 245, 212, 0.6)';
      ctx.font = `bold ${Math.max(6, Math.min(comp.width * 0.25, 9))}px JetBrains Mono, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(comp.name, comp.x, comp.y);
    }
  }

  function drawHeatSources(ctx: CanvasRenderingContext2D) {
    for (const hs of heatSources) {
      const isSelected = hs.id === selectedHeatSourceId;
      const colors: Record<HeatSourceType, string> = {
        resistor: '#FF6B6B',
        ic_chip: '#4ECDC4',
        custom: '#FFE66D',
      };
      const color = colors[hs.type];

      ctx.fillStyle = color + '40';
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 2 : 1;

      ctx.fillRect(hs.x - hs.width / 2, hs.y - hs.height / 2, hs.width, hs.height);
      ctx.strokeRect(hs.x - hs.width / 2, hs.y - hs.height / 2, hs.width, hs.height);

      if (isSelected) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(
          hs.x - hs.width / 2 - 3,
          hs.y - hs.height / 2 - 3,
          hs.width + 6,
          hs.height + 6
        );
        ctx.setLineDash([]);
      }

      ctx.fillStyle = color;
      ctx.font = `bold ${Math.max(5, Math.min(hs.width * 0.25, 10))}px JetBrains Mono, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${hs.power}W`, hs.x, hs.y);
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const syncSize = (width: number, height: number) => {
      canvasSize.current = { w: width, h: height };
      const canvas = canvasRef.current;
      if (canvas) {
        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
        const ctx = canvas.getContext('2d');
        if (ctx) ctx.scale(dpr, dpr);
      }
      const glCanvas = glCanvasRef.current;
      if (glCanvas) {
        glCanvas.style.width = `${width}px`;
        glCanvas.style.height = `${height}px`;
      }
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        syncSize(width, height);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const render = () => {
      draw();
      if (simResult && boardData) {
        renderGLHeatmap();
      }
      animFrameRef.current = requestAnimationFrame(render);
    };
    animFrameRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animFrameRef.current);
  }, [draw, renderGLHeatmap, simResult, boardData]);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(20, canvasState.zoom * delta));
      setCanvasState({ zoom: newZoom });
    },
    [canvasState.zoom, setCanvasState]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && e.ctrlKey)) {
        isPanning.current = true;
        panStart.current = {
          x: e.clientX,
          y: e.clientY,
          panX: canvasState.panX,
          panY: canvasState.panY,
        };
        e.preventDefault();
      }
    },
    [canvasState.panX, canvasState.panY]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;

      if (isPanning.current) {
        const dx = e.clientX - panStart.current.x;
        const dy = e.clientY - panStart.current.y;
        setCanvasState({
          panX: panStart.current.panX + dx,
          panY: panStart.current.panY + dy,
        });
        return;
      }

      if (simResult && boardData) {
        const world = screenToWorld(sx, sy);
        const rows = simResult.grid_rows;
        const cols = simResult.grid_cols;
        const bw = boardData.dimensions.width;
        const bh = boardData.dimensions.height;

        const mx = Math.floor((world.x / bw) * cols);
        const my = Math.floor((world.y / bh) * rows);

        if (mx >= 0 && mx < cols && my >= 0 && my < rows) {
          let value: number | null = null;
          if (fieldType === 'temperature' && simResult.temperature_matrices.length > selectedLayer) {
            value = simResult.temperature_matrices[selectedLayer][my][mx];
          } else if (fieldType === 'current_density' && simResult.current_density) {
            value = simResult.current_density[my][mx];
          } else if (fieldType === 'heat_flow_x' && simResult.heat_flow?.qx.length > selectedLayer) {
            value = simResult.heat_flow.qx[selectedLayer][my][mx];
          } else if (fieldType === 'heat_flow_y' && simResult.heat_flow?.qy.length > selectedLayer) {
            value = simResult.heat_flow.qy[selectedLayer][my][mx];
          }
          if (value !== null) {
            setTooltip({ x: sx, y: sy, value, type: fieldType });
          } else {
            setTooltip(null);
          }
        } else {
          setTooltip(null);
        }
      }
    },
    [canvasState, simResult, boardData, screenToWorld, setCanvasState]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (isPanning.current) {
        isPanning.current = false;
        return;
      }

      if (e.button !== 0 || e.ctrlKey) return;
      if (selectedTool === 'select') {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const rect = canvas.getBoundingClientRect();
        const sx = e.clientX - rect.left;
        const sy = e.clientY - rect.top;
        const world = screenToWorld(sx, sy);

        let found = false;
        for (const hs of heatSources) {
          if (
            world.x >= hs.x - hs.width / 2 &&
            world.x <= hs.x + hs.width / 2 &&
            world.y >= hs.y - hs.height / 2 &&
            world.y <= hs.y + hs.height / 2
          ) {
            setSelectedHeatSourceId(hs.id);
            found = true;
            break;
          }
        }
        if (!found) setSelectedHeatSourceId(null);
        return;
      }

      if (!boardData) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const world = screenToWorld(sx, sy);

      const size = DEFAULT_SOURCE_SIZE[selectedTool];
      const source: HeatSource = {
        id: generateId(),
        type: selectedTool,
        x: world.x,
        y: world.y,
        width: size.w,
        height: size.h,
        power: DEFAULT_POWER[selectedTool],
      };
      addHeatSource(source);
      setSelectedHeatSourceId(source.id);
      setSelectedTool('select');
    },
    [
      selectedTool,
      boardData,
      heatSources,
      screenToWorld,
      addHeatSource,
      setSelectedHeatSourceId,
      setSelectedTool,
    ]
  );

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
    setTooltip(null);
  }, []);

  const cursorClass =
    selectedTool === 'select'
      ? 'cursor-default'
      : 'cursor-crosshair';

  return (
    <div ref={containerRef} className="relative flex-1 overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`block w-full h-full ${cursorClass}`}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onContextMenu={(e) => e.preventDefault()}
      />
      <canvas
        ref={glCanvasRef}
        className="absolute inset-0 pointer-events-none"
        style={{ width: '100%', height: '100%' }}
      />
      {tooltip && (
        <div
          className="absolute pointer-events-none px-2 py-1 rounded text-xs font-mono whitespace-nowrap z-10"
          style={{
            left: tooltip.x + 12,
            top: tooltip.y - 28,
            backgroundColor: 'rgba(13, 27, 42, 0.9)',
            border: '1px solid rgba(0, 245, 212, 0.4)',
            color: '#E0E7EE',
          }}
        >
          {tooltip.type === 'temperature' && `${tooltip.value.toFixed(1)}°C`}
          {tooltip.type === 'current_density' && `${(tooltip.value / 1e6).toFixed(2)} A/mm²`}
          {(tooltip.type === 'heat_flow_x' || tooltip.type === 'heat_flow_y') && `${tooltip.value.toFixed(1)} W/m²`}
        </div>
      )}
      {!boardData && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <div className="text-[var(--text-secondary)] text-lg font-semibold mb-2">
              No Board Loaded
            </div>
            <div className="text-[var(--text-secondary)] text-sm opacity-60">
              Upload a Gerber file or load the demo board to begin
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
