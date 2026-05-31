import React from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  PlayCircle,
  ChevronRight,
  ListTodo,
} from 'lucide-react';
import { cn } from '../lib/utils';
import type { TaskListItem } from '../types';

interface TaskListProps {
  tasks: TaskListItem[];
  loading?: boolean;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; icon: React.ReactNode; color: string; bg: string }
> = {
  pending: {
    label: '等待中',
    icon: <Clock className="w-4 h-4" />,
    color: 'text-slate-400',
    bg: 'bg-slate-500/20 border-slate-500/30',
  },
  processing: {
    label: '计算中',
    icon: <Loader2 className="w-4 h-4 animate-spin" />,
    color: 'text-blue-400',
    bg: 'bg-blue-500/20 border-blue-500/30',
  },
  completed: {
    label: '已完成',
    icon: <CheckCircle2 className="w-4 h-4" />,
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/20 border-emerald-500/30',
  },
  failed: {
    label: '失败',
    icon: <XCircle className="w-4 h-4" />,
    color: 'text-red-400',
    bg: 'bg-red-500/20 border-red-500/30',
  },
};

const SOLVER_NAMES: Record<string, string> = {
  cg: 'CG',
  gmres: 'GMRES',
  superlu: 'SuperLU',
};

export const TaskList: React.FC<TaskListProps> = ({ tasks, loading }) => {
  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}min`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  if (loading) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <ListTodo className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">最近任务</h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-20 bg-slate-900/50 rounded-lg animate-pulse"
            />
          ))}
        </div>
      </div>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <div className="flex items-center gap-2 mb-4">
          <ListTodo className="w-5 h-5 text-slate-400" />
          <h3 className="font-semibold text-slate-200">最近任务</h3>
        </div>
        <div className="py-12 text-center text-slate-500">
          <PlayCircle className="w-12 h-12 mx-auto mb-3 opacity-50" />
          <p className="text-sm">暂无求解任务</p>
          <p className="text-xs mt-1">上传矩阵并开始求解</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <ListTodo className="w-5 h-5 text-blue-400" />
          <h3 className="font-semibold text-slate-200">最近任务</h3>
          <span className="text-xs text-slate-500 bg-slate-700 px-2 py-0.5 rounded">
            {tasks.length}
          </span>
        </div>
        <Link
          to="/tasks"
          className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
        >
          查看全部 <ChevronRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="space-y-3">
        {tasks.slice(0, 5).map((task) => {
          const status = STATUS_CONFIG[task.status];
          return (
            <Link
              key={task.taskId}
              to={`/tasks/${task.taskId}`}
              className="block group"
            >
              <div className="p-4 bg-slate-900/50 rounded-lg border border-transparent hover:border-slate-600 transition-all duration-200 group-hover:bg-slate-900">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border',
                          status.bg,
                          status.color
                        )}
                      >
                        {status.icon}
                        {status.label}
                      </span>
                      <span className="px-2 py-0.5 bg-slate-700 rounded text-xs text-slate-300 font-mono">
                        {SOLVER_NAMES[task.solver] || task.solver}
                      </span>
                    </div>

                    <div className="text-xs text-slate-400 mb-2 truncate">
                      矩阵: {task.matrixId.slice(0, 8)}...
                    </div>

                    <div className="flex items-center gap-4 text-xs text-slate-500">
                      <span>{formatTime(task.createdAt)}</span>
                      {task.elapsedTime > 0 && (
                        <span>用时: {formatDuration(task.elapsedTime)}</span>
                      )}
                      {task.currentIter > 0 && (
                        <span>
                          迭代: {task.currentIter}/{task.maxIter}
                        </span>
                      )}
                    </div>
                  </div>

                  <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 transition-colors flex-shrink-0" />
                </div>

                {task.status === 'processing' && (
                  <div className="mt-3">
                    <div className="flex justify-between text-xs text-slate-400 mb-1">
                      <span>进度</span>
                      <span>{task.progress.toFixed(0)}%</span>
                    </div>
                    <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-300"
                        style={{ width: `${task.progress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
};
