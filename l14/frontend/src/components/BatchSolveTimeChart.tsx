import React, { useEffect, useRef } from 'react';
import { Chart, registerables } from 'chart.js';
import type { BatchSolveResult } from '../types';
import { BarChart3 } from 'lucide-react';

Chart.register(...registerables);

interface BatchSolveTimeChartProps {
  data: BatchSolveResult | null;
  loading?: boolean;
}

export const BatchSolveTimeChart: React.FC<BatchSolveTimeChartProps> = ({ data, loading }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current || !data) return;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    const labels = data.results.map((_, i) => `b${i + 1}`);
    const colors = data.results.map((r) =>
      r.converged
        ? 'rgba(59, 130, 246, 0.8)'
        : 'rgba(239, 68, 68, 0.8)'
    );
    const borderColors = data.results.map((r) =>
      r.converged ? 'rgb(59, 130, 246)' : 'rgb(239, 68, 68)'
    );

    chartRef.current = new Chart(ctx, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: '求解时间 (秒)',
            data: data.solveTimes,
            backgroundColor: colors,
            borderColor: borderColors,
            borderWidth: 2,
            borderRadius: 4,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
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
                const idx = context.dataIndex;
                const result = data.results[idx];
                return [
                  `求解时间: ${data.solveTimes[idx].toFixed(4)} s`,
                  `迭代次数: ${result.iterations}`,
                  `最终残差: ${result.finalResidual.toExponential(2)}`,
                  `收敛: ${result.converged ? '是' : '否'}`,
                ];
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
              maxRotation: 45,
              minRotation: 45,
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
                  if (value >= 1) return value.toFixed(0) + 's';
                  if (value >= 0.001) return (value * 1000).toFixed(0) + 'ms';
                  return value.toExponential(1) + 's';
                }
                return value;
              },
            },
            title: {
              display: true,
              text: '求解时间 (对数刻度)',
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
  }, [data]);

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">求解时间对比</h3>
        </div>
        <div className="h-64 bg-slate-900 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const avgTime = data.solveTimes.reduce((a, b) => a + b, 0) / data.solveTimes.length;
  const maxTime = Math.max(...data.solveTimes);
  const minTime = Math.min(...data.solveTimes);

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-slate-200">求解时间对比</h3>
        </div>
        <div className="flex gap-4 text-xs">
          <div className="text-center">
            <div className="text-slate-500">平均</div>
            <div className="text-white font-mono">{avgTime.toFixed(3)}s</div>
          </div>
          <div className="text-center">
            <div className="text-slate-500">最快</div>
            <div className="text-emerald-400 font-mono">{minTime.toFixed(3)}s</div>
          </div>
          <div className="text-center">
            <div className="text-slate-500">最慢</div>
            <div className="text-amber-400 font-mono">{maxTime.toFixed(3)}s</div>
          </div>
        </div>
      </div>

      <div className="h-64">
        <canvas ref={canvasRef} />
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-blue-500" />
          <span className="text-slate-400">已收敛</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded bg-red-500" />
          <span className="text-slate-400">未收敛</span>
        </div>
      </div>
    </div>
  );
};
