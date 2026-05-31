import { useCallback } from 'react';
import { cn } from '@/lib/utils';
import type { QualityAssessment, ControversialPoint } from '@/services/collaboration';

interface QualityPanelProps {
  quality: QualityAssessment | null;
  controversialPoints: ControversialPoint[];
  onAssessQuality: () => void;
  onJumpToControversial: (pointIndex: number) => void;
  isLoading: boolean;
  className?: string;
}

const QUALITY_COLORS = {
  excellent: 'text-green-400',
  good: 'text-yellow-400',
  poor: 'text-red-400',
};

const QUALITY_LABELS = {
  excellent: '优秀',
  good: '良好',
  poor: '较差',
};

export default function QualityPanel({
  quality,
  controversialPoints,
  onAssessQuality,
  onJumpToControversial,
  isLoading,
  className,
}: QualityPanelProps) {
  const getAlphaColor = (alpha: number) => {
    if (alpha >= 0.8) return 'text-green-400';
    if (alpha >= 0.6) return 'text-yellow-400';
    return 'text-red-400';
  };

  const getAlphaLabel = (alpha: number) => {
    if (alpha >= 0.8) return '一致性极好';
    if (alpha >= 0.6) return '一致性良好';
    if (alpha >= 0.4) return '一致性一般';
    return '一致性较差，需要重新标注';
  };

  return (
    <div className={cn(
      'bg-surface border border-surface-border rounded-lg p-4 space-y-4',
      className
    )}>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-200">标注质量评估</h3>
        <button
          onClick={onAssessQuality}
          disabled={isLoading}
          className="px-3 py-1 bg-primary hover:bg-primary/80 disabled:bg-primary/50 text-white text-xs rounded-md transition-colors"
        >
          {isLoading ? '评估中...' : '重新评估'}
        </button>
      </div>

      {quality ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-dark rounded-md p-3">
              <div className="text-xs text-gray-400 mb-1">Krippendorff's α</div>
              <div className={cn('text-lg font-mono font-bold', getAlphaColor(quality.krippendorffAlpha || 0))}>
                {quality.krippendorffAlpha?.toFixed(3) || '-'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {quality.krippendorffAlpha !== undefined ? getAlphaLabel(quality.krippendorffAlpha) : ''}
              </div>
            </div>

            <div className="bg-surface-dark rounded-md p-3">
              <div className="text-xs text-gray-400 mb-1">整体熵值</div>
              <div className="text-lg font-mono font-bold text-blue-400">
                {quality.overallEntropy?.toFixed(3) || '-'}
              </div>
              <div className="text-xs text-gray-500 mt-1">
                {quality.overallEntropy !== undefined && quality.overallEntropy > 0.8 ? '高不确定性' : '低不确定性'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-dark rounded-md p-3">
              <div className="text-xs text-gray-400 mb-1">已标注点数</div>
              <div className="text-lg font-mono font-bold text-gray-200">
                {quality.details?.annotatedPointCount?.toLocaleString() || '-'}
              </div>
            </div>

            <div className="bg-surface-dark rounded-md p-3">
              <div className="text-xs text-gray-400 mb-1">总标注次数</div>
              <div className="text-lg font-mono font-bold text-gray-200">
                {quality.details?.totalAnnotations?.toLocaleString() || '-'}
              </div>
            </div>
          </div>

          {quality.needsReview && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-md p-3">
              <div className="flex items-center gap-2 text-red-400">
                <div className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
                <span className="text-sm font-medium">需要重新标注</span>
              </div>
              <div className="text-xs text-red-300/80 mt-1">
                标注一致性低于阈值 (alpha {'<'} 0.6)，请检查争议区域
              </div>
            </div>
          )}

          <div className="bg-surface-dark rounded-md p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-gray-400">质量等级</div>
              <div className={cn('text-sm font-bold', QUALITY_COLORS[quality.details?.qualityLevel || 'poor'])}>
                {QUALITY_LABELS[quality.details?.qualityLevel || 'poor']}
              </div>
            </div>
            <div className="w-full h-2 bg-surface-border rounded-full overflow-hidden">
              <div
                className={cn('h-full transition-all duration-500', {
                  'bg-green-500': quality.details?.qualityLevel === 'excellent',
                  'bg-yellow-500': quality.details?.qualityLevel === 'good',
                  'bg-red-500': quality.details?.qualityLevel === 'poor',
                })}
                style={{ width: `${Math.max(0, Math.min(100, (quality.krippendorffAlpha || 0) * 100))}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>0</span>
              <span>0.6 (阈值)</span>
              <span>1.0</span>
            </div>
          </div>

          {controversialPoints.length > 0 && (
            <div className="bg-surface-dark rounded-md p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs text-gray-400">
                  争议点 <span className="text-purple-400 font-mono">({controversialPoints.length})</span>
                </div>
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                  <span className="text-xs text-purple-400">紫色闪烁</span>
                </div>
              </div>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {controversialPoints.slice(0, 10).map((cp) => (
                  <div
                    key={cp.id}
                    className="flex items-center justify-between p-2 bg-surface-hover rounded-md cursor-pointer hover:bg-surface-border transition-colors"
                    onClick={() => onJumpToControversial(cp.pointIndex)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-gray-400">#{cp.pointIndex}</span>
                      <span className="text-xs text-purple-400">熵: {cp.entropy.toFixed(2)}</span>
                    </div>
                    <div className="text-xs text-gray-500">
                      {cp.annotatorCount}人标注
                    </div>
                  </div>
                ))}
                {controversialPoints.length > 10 && (
                  <div className="text-xs text-gray-500 text-center py-1">
                    还有 {controversialPoints.length - 10} 个争议点...
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="text-xs text-gray-500">
            评估时间: {new Date(quality.assessmentDate).toLocaleString()}
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <div className="text-sm mb-2">尚未进行质量评估</div>
          <div className="text-xs">点击"重新评估"按钮开始评估</div>
        </div>
      )}
    </div>
  );
}
