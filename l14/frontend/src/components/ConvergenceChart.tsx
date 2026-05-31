import React, { useEffect, useRef } from 'react';
import {
  Chart,
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  Title,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { TrendingDown } from 'lucide-react';

Chart.register(
  LineController,
  LineElement,
  PointElement,
  LinearScale,
  LogarithmicScale,
  Title,
  Tooltip,
  Legend,
  Filler
);

interface ConvergenceChartProps {
  residuals: number[];
  tol?: number;
  loading?: boolean;
  solver?: string;
}

export const ConvergenceChart: React.FC<ConvergenceChartProps> = ({
  residuals,
  tol = 1e-6,
  loading,
  solver,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;

    const ctx = canvasRef.current.getContext('2d')!;

    if (chartRef.current) {
      chartRef.current.destroy();
    }

    const hasData = residuals && residuals.length > 0;
    const labels = hasData ? residuals.map((_, i) => i) : [];
    const data = hasData ? residuals : [];

    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, 'rgba(59, 130, 246, 0.3)');
    gradient.addColorStop(1, 'rgba(59, 130, 246, 0)');

    chartRef.current = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '残差 ||Ax-b||/||b||',
            data,
            borderColor: '#3b82f6',
            backgroundColor: gradient,
            borderWidth: 2,
            fill: true,
            tension: 0.3,
            pointRadius: data.length < 50 ? 3 : data.length < 200 ? 2 : 0,
            pointHoverRadius: 5,
            pointBackgroundColor: '#3b82f6',
            pointBorderColor: '#0f172a',
            pointBorderWidth: 2,
          },
          {
            label: `容差 (${tol.toExponential(0)})`,
            data: hasData ? new Array(data.length).fill(tol) : [],
            borderColor: '#10b981',
            borderWidth: 2,
            borderDash: [5, 5],
            fill: false,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: {
          duration: 300,
        },
        interaction: {
          intersect: false,
          mode: 'index',
        },
        plugins: {
          legend: {
            position: 'top',
            align: 'end',
            labels: {
              color: '#94a3b8',
              usePointStyle: true,
              padding: 15,
              font: {
                size: 11,
              },
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#f1f5f9',
            bodyColor: '#cbd5e1',
            borderColor: '#334155',
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            callbacks: {
              title: (items) => {
                if (items.length > 0) {
                  return `迭代次数: ${items[0].label}`;
                }
                return '';
              },
              label: (item) => {
                const value = item.raw as number;
                return `${item.dataset.label}: ${value.toExponential(4)}`;
              },
            },
          },
        },
        scales: {
          x: {
            display: true,
            title: {
              display: true,
              text: '迭代次数',
              color: '#94a3b8',
              font: {
                size: 12,
              },
            },
            grid: {
              color: 'rgba(51, 65, 85, 0.3)',
            },
            ticks: {
              color: '#64748b',
              maxTicksLimit: 10,
            },
          },
          y: {
            type: 'logarithmic',
            display: true,
            title: {
              display: true,
              text: '相对残差 (对数尺度)',
              color: '#94a3b8',
              font: {
                size: 12,
              },
            },
            grid: {
              color: 'rgba(51, 65, 85, 0.3)',
            },
            ticks: {
              color: '#64748b',
              callback: (value) => {
                const v = value as number;
                if (v >= 0.1 || v === 0) return v.toFixed(1);
                if (v >= 0.0001) return v.toFixed(4);
                return v.toExponential(0);
              },
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
  }, [residuals, tol]);

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingDown className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">残差收敛曲线</h3>
        </div>
        <div className="h-80 bg-slate-900 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!residuals || residuals.length === 0) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingDown className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">残差收敛曲线</h3>
          {solver && (
            <span className="ml-auto px-2 py-1 bg-slate-700 rounded text-xs text-slate-300 font-mono">
              {solver.toUpperCase()}
            </span>
          )}
        </div>
        <div className="h-80 bg-slate-900/50 rounded-lg flex items-center justify-center border-2 border-dashed border-slate-700">
          <div className="text-center text-slate-500">
            <TrendingDown className="w-12 h-12 mx-auto mb-2 opacity-50" />
            <p className="text-sm">求解开始后显示收敛曲线</p>
          </div>
        </div>
      </div>
    );
  }

  const finalResidual = residuals[residuals.length - 1];
  const converged = finalResidual <= tol;

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <TrendingDown className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-slate-200">残差收敛曲线</h3>
          {solver && (
            <span className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-300 font-mono">
              {solver.toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-xs text-slate-400">最终残差</div>
            <div
              className={`font-mono text-sm ${converged ? 'text-emerald-400' : 'text-amber-400'}`}
            >
              {finalResidual.toExponential(4)}
            </div>
          </div>
          <div
            className={`px-2 py-1 rounded text-xs font-medium ${
              converged
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
            }`}
          >
            {converged ? '已收敛' : '未收敛'}
          </div>
        </div>
      </div>

      <div className="h-80">
        <canvas ref={canvasRef} />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-400">迭代次数</div>
          <div className="font-mono text-lg text-white">{residuals.length - 1}</div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-400">初始残差</div>
          <div className="font-mono text-lg text-blue-400">
            {residuals[0]?.toExponential(2) || '-'}
          </div>
        </div>
        <div className="bg-slate-900/50 rounded-lg p-3 text-center">
          <div className="text-xs text-slate-400">收敛率</div>
          <div className="font-mono text-lg text-emerald-400">
            {residuals.length > 1
              ? ((residuals[0] / finalResidual).toExponential(2))
              : '-'}
          </div>
        </div>
      </div>
    </div>
  );
};
