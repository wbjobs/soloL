import { History, Tag, Wand2, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useHistoryStore } from '@/store/useHistoryStore';
import type { HistoryEntry } from '@/types';

interface HistoryPanelProps {
  className?: string;
}

const getTypeIcon = (type: HistoryEntry['type']) => {
  switch (type) {
    case 'label':
      return <Tag size={14} />;
    case 'inference':
      return <Wand2 size={14} className="text-purple-400" />;
    case 'import':
      return <Upload size={14} className="text-green-400" />;
    default:
      return <History size={14} />;
  }
};

const getTypeLabel = (type: HistoryEntry['type']) => {
  switch (type) {
    case 'label':
      return '标注';
    case 'inference':
      return 'AI预测';
    case 'import':
      return '导入';
    default:
      return '操作';
  }
};

const formatTime = (date: Date) => {
  return new Date(date).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

export default function HistoryPanel({ className }: HistoryPanelProps) {
  const { history, currentIndex } = useHistoryStore();

  return (
    <div className={cn('panel flex flex-col', className)}>
      <div className="panel-header flex items-center gap-2 shrink-0">
        <History size={14} className="text-primary" />
        <span>操作历史</span>
        <span className="ml-auto text-xs text-gray-400 font-mono">
          {history.length} 条
        </span>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-24 text-gray-500">
            <History size={24} className="mb-2 opacity-50" />
            <span className="text-xs">暂无操作记录</span>
          </div>
        ) : (
          <div className="space-y-1">
            {[...history].reverse().map((entry, idx) => {
              const actualIndex = history.length - 1 - idx;
              const isActive = actualIndex === currentIndex;
              const isFuture = actualIndex > currentIndex;

              return (
                <div
                  key={entry.id}
                  className={cn(
                    'flex items-start gap-2 px-2 py-1.5 rounded-md text-sm transition-colors',
                    isActive
                      ? 'bg-primary/20 border border-primary/30'
                      : isFuture
                      ? 'opacity-40'
                      : 'hover:bg-surface-hover'
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 p-1 rounded',
                      isActive ? 'bg-primary text-white' : 'text-gray-400'
                    )}
                  >
                    {getTypeIcon(entry.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'font-medium truncate',
                          isActive ? 'text-white' : 'text-gray-300'
                        )}
                      >
                        {entry.description}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                      <span>{getTypeLabel(entry.type)}</span>
                      <span>·</span>
                      <span>{formatTime(entry.timestamp)}</span>
                      {entry.afterState.pointIndices.length > 0 && (
                        <>
                          <span>·</span>
                          <span className="font-mono">
                            {entry.afterState.pointIndices.length} 点
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
