import { Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAnnotationStore } from '@/store/useAnnotationStore';

interface LabelLegendProps {
  className?: string;
}

export default function LabelLegend({ className }: LabelLegendProps) {
  const { labels, currentLabelId, setCurrentLabelId } = useAnnotationStore();

  return (
    <div className={cn('panel', className)}>
      <div className="panel-header flex items-center gap-2">
        <Tag size={14} className="text-primary" />
        <span>标签图例</span>
      </div>
      <div className="panel-body">
        <div className="space-y-1">
          {labels.map((label) => {
            const isSelected = currentLabelId === label.id;
            return (
              <button
                key={label.id}
                onClick={() => setCurrentLabelId(label.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-2 py-1.5 rounded-md transition-colors text-left',
                  isSelected ? 'bg-primary/20' : 'hover:bg-surface-hover'
                )}
              >
                <div
                  className="w-4 h-4 rounded-sm shrink-0"
                  style={{ backgroundColor: label.color }}
                />
                <span
                  className={cn(
                    'text-sm truncate',
                    isSelected ? 'text-white font-medium' : 'text-gray-300'
                  )}
                >
                  {label.name}
                </span>
                {isSelected && (
                  <span className="ml-auto text-xs text-primary font-mono">
                    ID: {label.id}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
