import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAnnotationStore } from '@/store/useAnnotationStore';
import type { LabelDefinition } from '@/types';

interface LabelSelectorProps {
  className?: string;
}

export default function LabelSelector({ className }: LabelSelectorProps) {
  const { labels, currentLabelId, setCurrentLabelId } = useAnnotationStore();

  const handleLabelClick = (label: LabelDefinition) => {
    setCurrentLabelId(label.id);
  };

  return (
    <div className={cn('panel p-3', className)}>
      <h3 className="text-sm font-semibold text-gray-200 mb-3">标签选择</h3>
      <div className="grid grid-cols-4 gap-2">
        {labels.map((label) => {
          const isSelected = currentLabelId === label.id;
          return (
            <button
              key={label.id}
              onClick={() => handleLabelClick(label)}
              className={cn(
                'relative group flex flex-col items-center gap-1 p-2 rounded-lg transition-all duration-200',
                isSelected
                  ? 'bg-primary/20 ring-2 ring-primary'
                  : 'hover:bg-surface-hover'
              )}
              title={label.name}
            >
              <div
                className={cn(
                  'w-8 h-8 rounded-md flex items-center justify-center transition-transform',
                  isSelected && 'scale-110'
                )}
                style={{ backgroundColor: label.color }}
              >
                {isSelected && <Check size={16} className="text-white" />}
              </div>
              <span className="text-xs text-gray-300 truncate w-full text-center">
                {label.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
