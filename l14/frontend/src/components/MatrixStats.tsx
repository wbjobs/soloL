import React from 'react';
import {
  Grid3X3,
  Hash,
  BarChart3,
  Activity,
  Ruler,
  Layers,
} from 'lucide-react';
import type { MatrixStats as MatrixStatsType } from '../types';

interface MatrixStatsProps {
  stats: MatrixStatsType | null;
  loading?: boolean;
}

export const MatrixStats: React.FC<MatrixStatsProps> = ({ stats, loading }) => {
  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">矩阵统计信息</h3>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 bg-slate-900/50 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">矩阵统计信息</h3>
        </div>
        <div className="py-8 text-center text-slate-500">
          <BarChart3 className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">上传矩阵后显示统计</p>
        </div>
      </div>
    );
  }

  const formatNumber = (n: number) => {
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(2) + 'K';
    return n.toFixed(2);
  };

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center gap-2 mb-4">
        <BarChart3 className="w-5 h-5 text-blue-400" />
        <h3 className="font-semibold text-slate-200">矩阵统计信息</h3>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Grid3X3 className="w-3.5 h-3.5" />
            维度
          </div>
          <div className="text-white font-mono font-medium">
            {stats.shape[0].toLocaleString()} × {stats.shape[1].toLocaleString()}
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Hash className="w-3.5 h-3.5" />
            非零元
          </div>
          <div className="text-white font-mono font-medium">
            {stats.nnz.toLocaleString()}
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Layers className="w-3.5 h-3.5" />
            稀疏度
          </div>
          <div className="text-emerald-400 font-mono font-medium">
            {(stats.sparsity * 100).toFixed(4)}%
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Activity className="w-3.5 h-3.5" />
            条件数估计
          </div>
          <div
            className={`font-mono font-medium ${
              stats.conditionNumber === null
                ? 'text-slate-500'
                : stats.conditionNumber > 1e8
                  ? 'text-amber-400'
                  : 'text-blue-400'
            }`}
          >
            {stats.conditionNumber === null
              ? 'N/A'
              : stats.conditionNumber === Infinity
                ? '∞'
                : stats.conditionNumber.toExponential(2)}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-3">
            <Ruler className="w-4 h-4" />
            每行非零元分布
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">均值</span>
              <span className="font-mono text-slate-300">
                {formatNumber(stats.rowNonzeroStats.mean)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">标准差</span>
              <span className="font-mono text-slate-300">
                ±{formatNumber(stats.rowNonzeroStats.std)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">最大</span>
              <span className="font-mono text-blue-400">
                {stats.rowNonzeroStats.max.toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-sm mb-3">
            <Ruler className="w-4 h-4" />
            每列非零元分布
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">均值</span>
              <span className="font-mono text-slate-300">
                {formatNumber(stats.colNonzeroStats.mean)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">标准差</span>
              <span className="font-mono text-slate-300">
                ±{formatNumber(stats.colNonzeroStats.std)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">最大</span>
              <span className="font-mono text-blue-400">
                {stats.colNonzeroStats.max.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
