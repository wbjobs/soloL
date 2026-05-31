import React from 'react';
import type { ConditionNumberInfo } from '../types';
import { AlertTriangle, Info, Calculator } from 'lucide-react';

interface ConditionNumberWarningProps {
  info: ConditionNumberInfo | null;
  loading?: boolean;
}

export const ConditionNumberWarning: React.FC<ConditionNumberWarningProps> = ({
  info,
  loading,
}) => {
  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
        <div className="h-12 bg-slate-900 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!info) {
    return null;
  }

  const formatNumber = (n: number) => {
    if (!isFinite(n)) return '∞';
    if (n < 0.01 || n >= 1e10) return n.toExponential(2);
    if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2 });
    return n.toFixed(2);
  };

  const severity = info.isIllConditioned
    ? info.conditionNumber > 1e15
      ? 'critical'
      : 'warning'
    : 'normal';

  const severityConfig = {
    normal: {
      borderColor: 'border-emerald-500/30',
      bgColor: 'bg-emerald-500/10',
      iconColor: 'text-emerald-400',
      textColor: 'text-emerald-400',
      label: '良态',
      description: '矩阵条件良好，数值求解稳定',
    },
    warning: {
      borderColor: 'border-amber-500/30',
      bgColor: 'bg-amber-500/10',
      iconColor: 'text-amber-400',
      textColor: 'text-amber-400',
      label: '病态警告',
      description: '条件数 > 1e10，求解结果可能存在较大误差',
    },
    critical: {
      borderColor: 'border-red-500/30',
      bgColor: 'bg-red-500/10',
      iconColor: 'text-red-400',
      textColor: 'text-red-400',
      label: '严重病态',
      description: '条件数极高，数值求解可能不稳定，建议使用更高精度或预条件',
    },
  };

  const config = severityConfig[severity];

  return (
    <div
      className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-4`}
    >
      <div className="flex items-start gap-3">
        {severity === 'normal' ? (
          <Info className={`w-5 h-5 ${config.iconColor} flex-shrink-0 mt-0.5`} />
        ) : (
          <AlertTriangle className={`w-5 h-5 ${config.iconColor} flex-shrink-0 mt-0.5`} />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`font-semibold ${config.textColor}`}>
              {config.label}
            </span>
            {severity !== 'normal' && (
              <span className="text-xs bg-slate-800/50 px-2 py-0.5 rounded text-slate-400">
                {info.algorithm === 'lanczos_symmetric' ? 'Lanczos' : 'Arnoldi'}
              </span>
            )}
          </div>

          <p className="text-sm text-slate-400 mb-3">{config.description}</p>

          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                <Calculator className="w-3 h-3" />
                条件数 κ
              </div>
              <div className={`font-mono text-lg ${config.textColor}`}>
                {formatNumber(info.conditionNumber)}
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">最大特征值 |λ_max|</div>
              <div className="font-mono text-white">
                {formatNumber(info.lambdaMax)}
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3">
              <div className="text-xs text-slate-500 mb-1">最小特征值 |λ_min|</div>
              <div className="font-mono text-white">
                {formatNumber(info.lambdaMin)}
              </div>
            </div>
          </div>

          {info.warning && severity !== 'normal' && (
            <div className="mt-3 text-sm text-slate-300 bg-slate-900/50 rounded-lg p-3">
              {info.warning}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
