import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAnnotationStore } from '@/store/useAnnotationStore';
import { usePointCloudStore } from '@/store/usePointCloudStore';

interface AnnotationStatsProps {
  className?: string;
}

export default function AnnotationStats({ className }: AnnotationStatsProps) {
  const { labels } = useAnnotationStore();
  const { currentPointCloud } = usePointCloudStore();

  const mockStats = labels.map((label) => ({
    ...label,
    count: Math.floor(Math.random() * 10000),
  }));

  const totalPoints = currentPointCloud?.totalPoints || 0;
  const annotatedPoints = mockStats.reduce((sum, s) => sum + s.count, 0);
  const progress = totalPoints > 0 ? (annotatedPoints / totalPoints) * 100 : 0;

  return (
    <div className={cn('panel', className)}>
      <div className="panel-header flex items-center gap-2">
        <BarChart3 size={14} className="text-primary" />
        <span>标注统计</span>
      </div>
      <div className="panel-body space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">总点数</span>
            <span className="text-white font-mono">{totalPoints.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">已标注</span>
            <span className="text-white font-mono">{annotatedPoints.toLocaleString()}</span>
          </div>
          <div className="h-2 bg-surface-dark rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="text-xs text-gray-400 text-right">
            完成度: {progress.toFixed(1)}%
          </div>
        </div>

        <div className="border-t border-surface-border pt-4">
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {mockStats.map((stat) => {
              const percentage = annotatedPoints > 0 ? (stat.count / annotatedPoints) * 100 : 0;
              return (
                <div key={stat.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-sm"
                        style={{ backgroundColor: stat.color }}
                      />
                      <span className="text-gray-300">{stat.name}</span>
                    </div>
                    <span className="text-gray-400 font-mono">
                      {stat.count.toLocaleString()}
                    </span>
                  </div>
                  <div className="h-1 bg-surface-dark rounded-full overflow-hidden">
                    <div
                      className="h-full transition-all duration-300"
                      style={{ width: `${percentage}%`, backgroundColor: stat.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
