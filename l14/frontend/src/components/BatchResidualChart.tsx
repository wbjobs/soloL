import React, { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import type { BatchSolveResult } from '../types';
import { LineChart, Eye, EyeOff } from 'lucide-react';
import { cn } from '../lib/utils';

Chart.register(...registerables);

interface BatchResidualChartProps {
  data: BatchSolveResult | null;
  tol?: number;
  loading?: boolean;
}

export const BatchResidualChart: React.FC<BatchResidualChartProps> = ({
  data,
  tol = 1e-6,
  loading,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const [visibleIndices, setVisibleIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (data) {
      setVisibleIndices(new Set(data.results.map((_, i) => i)));
    }
  }, [data]);

  useEffect(() => {
    if (!canvasRef.current || !data) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const maxLen = Math.max(...data.residualHistories.map((r) => r.length), 1);
    const labels = Array.from({ length: maxLen }, (_, i) => i);

    const colorPalette = [
      '#3b82f6',
      '#8b5cf6',
      '#ec4899',
      '#f59e0b',
      '#10b981',
      '#06b6d4',
      '#f43f5e',
      '#6366f1',
      '#84cc16',
      '#14b8a6',
    ];

    const datasets = data.residualHistories.map((residuals, i) => {
      const baseColor = colorPalette[i % colorPalette.length];
      const visible = visibleIndices.has(i);

      return {
        label: `b${i + 1}`,
        data: residuals,
        borderColor: visible ? baseColor : 'transparent',
        backgroundColor: visible ? baseColor + '20' : 'transparent',
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.2,
        fill: false,
        hidden: !visible,
      };
    });

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          ...datasets,
          {
            label: '收敛阈值',
            data: Array(maxLen).fill(tol),
            borderColor: 'rgba(239, 68, 68, 0.6)',
            borderWidth: 2,
            borderDash: [5, 5],
            pointRadius: 0,
            fill: false,
            order: -1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#e2e8f0',
            bodyColor: '#94a3b8',
            borderColor: 'rgba(59, 130, 246, 0.3)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
              label: (context) => {
                if (context.dataset.label === '收敛阈值') {
                  return `阈值: ${tol.toExponential(1)}`;
                }
                const idx = context.dataIndex;
                const value = context.raw as number;
                return `${context.dataset.label}: ${value.toExponential(3)}`;
              },
            },
          },
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(148, 163, 184, 0.1)',
            },
            ticks: {
              color: '#94a3b8',
              maxTicksLimit: 10,
            },
            title: {
              display: true,
              text: '迭代次数',
              color: '#94a3b8',
            },
          },
          y: {
            type: 'logarithmic',
            grid: {
              color: 'rgba(148, 163, 184, 0.1)',
            },
            ticks: {
              color: '#94a3b8',
              callback: (value) => {
                if (typeof value === 'number') {
                  return value.toExponential(0);
                }
                return value;
              },
            },
            title: {
              display: true,
              text: '残差 (对数刻度)',
              color: '#94a3b8',
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
    };
  }, [data, tol, visibleIndices]);

  const toggleIndex = (idx: number) => {
    setVisibleIndices((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) {
        next.delete(idx);
      } else {
        next.add(idx);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (visibleIndices.size === data?.results.length) {
      setVisibleIndices(new Set());
    } else if (data) {
      setVisibleIndices(new Set(data.results.map((_, i) => i)));
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <LineChart className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">残差收敛对比</h3>
        </div>
        <div className="h-64 bg-slate-900 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const colorPalette = [
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
    '#f59e0b',
    '#10b981',
    '#06b6d4',
    '#f43f5e',
    '#6366f1',
    '#84cc16',
    '#14b8a6',
  ];

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <LineChart className="w-5 h-5 text-purple-400" />
          <h3 className="font-semibold text-slate-200">残差收敛对比</h3>
        </div>
        <button
          onClick={toggleAll}
          className="inline-flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          {visibleIndices.size === data.results.length ? (
            <><EyeOff className="w-3.5 h-3.5" /> 全部隐藏</>
          ) : (
            <><Eye className="w-3.5 h-3.5" /> 全部显示</>
          )}
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {data.results.map((result, i) => {
          const color = colorPalette[i % colorPalette.length];
          const visible = visibleIndices.has(i);
          return (
            <button
              key={i}
              onClick={() => toggleIndex(i)}
              className={cn(
                'inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-all',
                visible
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-800 text-slate-500 hover:bg-slate-700'
              )}
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: color, opacity: visible ? 1 : 0.3 }}
              />
              <span>b{i + 1}</span>
              <span
                className={cn(
                  'w-1.5 h-1.5 rounded-full',
                  result.converged ? 'bg-emerald-400' : 'bg-red-400'
                )}
              />
            </button>
          );
        })}
      </div>

      <div className="h-64">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
};
