import React from 'react';
import {
  Clock,
  Hash,
  Target,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ListOrdered,
} from 'lucide-react';
import type { SolveResult as SolveResultType } from '../types';

interface SolveResultProps {
  result: SolveResultType | null;
  loading?: boolean;
  error?: string | null;
}

export const SolveResult: React.FC<SolveResultProps> = ({ result, loading, error }) => {
  const formatValue = (val: number) => {
    if (Math.abs(val) < 0.0001 || Math.abs(val) > 10000) {
      return val.toExponential(6);
    }
    return val.toFixed(8);
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <h3 className="font-semibold text-slate-200 mb-4">求解结果</h3>
        <div className="space-y-4">
          <div className="h-24 bg-slate-900/50 rounded-lg animate-pulse" />
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 bg-slate-900/50 rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
        <div className="flex items-start gap-3">
          <XCircle className="w-6 h-6 text-red-400 flex-shrink-0" />
          <div>
            <h3 className="font-semibold text-red-400 mb-1">求解失败</h3>
            <p className="text-sm text-red-300/70">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <h3 className="font-semibold text-slate-200 mb-4">求解结果</h3>
        <div className="py-12 text-center text-slate-500">
          <Target className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">完成求解后显示结果</p>
        </div>
      </div>
    );
  }

  const SOLVER_NAMES: Record<string, string> = {
    cg: '共轭梯度法 (CG)',
    gmres: 'GMRES',
    superlu: 'SuperLU 直接求解',
  };

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold text-slate-200">求解结果</h3>
        <div
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
            result.converged
              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
          }`}
        >
          {result.converged ? (
            <CheckCircle2 className="w-3.5 h-3.5" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5" />
          )}
          {result.converged ? '已收敛' : '未收敛'}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Hash className="w-3.5 h-3.5" />
            求解器
          </div>
          <div className="text-white font-medium">
            {SOLVER_NAMES[result.solver] || result.solver}
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Clock className="w-3.5 h-3.5" />
            求解时间
          </div>
          <div className="text-white font-mono font-medium">
            {result.solveTime < 1
              ? `${(result.solveTime * 1000).toFixed(2)} ms`
              : `${result.solveTime.toFixed(3)} s`}
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <ListOrdered className="w-3.5 h-3.5" />
            迭代次数
          </div>
          <div className="text-white font-mono font-medium text-lg">
            {result.iterations}
          </div>
        </div>

        <div className="bg-slate-900/50 rounded-lg p-4">
          <div className="flex items-center gap-2 text-slate-400 text-xs mb-2">
            <Target className="w-3.5 h-3.5" />
            最终残差
          </div>
          <div
            className={`font-mono font-medium text-lg ${
              result.converged ? 'text-emerald-400' : 'text-amber-400'
            }`}
          >
            {result.finalResidual.toExponential(4)}
          </div>
        </div>
      </div>

      <div className="bg-slate-900/50 rounded-lg p-4">
        <div className="flex items-center gap-2 text-slate-400 text-sm mb-3">
          <Hash className="w-4 h-4" />
          解向量前 10 个元素 (x₁...x₁₀)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {result.solutionFirst10.map((val, idx) => (
            <div
              key={idx}
              className="bg-slate-800/50 rounded-lg p-3 text-center border border-slate-700/50"
            >
              <div className="text-xs text-slate-500 mb-1 font-mono">x[{idx + 1}]</div>
              <div
                className={`font-mono text-sm ${
                  Math.abs(val) < 1e-10 ? 'text-slate-500' : 'text-blue-400'
                }`}
              >
                {formatValue(val)}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
