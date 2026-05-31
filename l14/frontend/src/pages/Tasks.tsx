import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
  ArrowLeft,
  ListTodo,
  ChevronRight,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAppStore } from '../store/useAppStore';
import type { TaskListItem } from '../types';

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

export const Tasks: React.FC = () => {
  const { recentTasks, loading, fetchTasks } = useAppStore();

  useEffect(() => {
    fetchTasks(50);
  }, [fetchTasks]);

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    return date.toLocaleString('zh-CN');
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    if (seconds < 3600) return `${(seconds / 60).toFixed(1)}min`;
    return `${(seconds / 3600).toFixed(1)}h`;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            返回求解器
          </Link>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <ListTodo className="w-8 h-8 text-blue-400" />
            任务列表
          </h1>
          <p className="text-slate-400">查看所有求解任务的状态和结果</p>
        </div>

        {loading.tasks ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-24 bg-slate-800/50 rounded-xl animate-pulse"
              />
            ))}
          </div>
        ) : recentTasks.length === 0 ? (
          <div className="text-center py-16 bg-slate-800/30 rounded-xl border border-slate-700">
            <ListTodo className="w-16 h-16 mx-auto mb-4 text-slate-600" />
            <p className="text-slate-400 mb-2">暂无任务</p>
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-blue-400 hover:text-blue-300"
            >
              上传矩阵开始求解 <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {recentTasks.map((task) => {
              const status = STATUS_CONFIG[task.status];
              return (
                <Link
                  key={task.taskId}
                  to={`/tasks/${task.taskId}`}
                  className="block group"
                >
                  <div className="p-5 bg-slate-800/50 rounded-xl border border-slate-700 hover:border-slate-600 transition-all duration-200 group-hover:bg-slate-800">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-3">
                          <span
                            className={cn(
                              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border',
                              status.bg,
                              status.color
                            )}
                          >
                            {status.icon}
                            {status.label}
                          </span>
                          <span className="px-2.5 py-1 bg-slate-700 rounded text-xs text-slate-300 font-mono">
                            {SOLVER_NAMES[task.solver] || task.solver}
                          </span>
                          <span className="text-xs text-slate-500 font-mono">
                            #{task.taskId.slice(0, 8)}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
                          <div>
                            <div className="text-slate-500 text-xs">矩阵ID</div>
                            <div className="text-slate-300 font-mono">
                              {task.matrixId.slice(0, 12)}...
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">创建时间</div>
                            <div className="text-slate-300">{formatTime(task.createdAt)}</div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">迭代进度</div>
                            <div className="text-slate-300 font-mono">
                              {task.currentIter} / {task.maxIter}
                            </div>
                          </div>
                          <div>
                            <div className="text-slate-500 text-xs">用时</div>
                            <div className="text-slate-300 font-mono">
                              {task.elapsedTime > 0 ? formatDuration(task.elapsedTime) : '-'}
                            </div>
                          </div>
                        </div>

                        {task.status === 'processing' && (
                          <div className="mt-4">
                            <div className="flex justify-between text-xs text-slate-400 mb-1.5">
                              <span>求解进度</span>
                              <span>{task.progress.toFixed(1)}%</span>
                            </div>
                            <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500"
                                style={{ width: `${task.progress}%` }}
                              />
                            </div>
                          </div>
                        )}

                        {task.error && (
                          <div className="mt-3 text-sm text-red-400 bg-red-500/10 px-3 py-2 rounded-lg">
                            {task.error}
                          </div>
                        )}
                      </div>

                      <ChevronRight className="w-5 h-5 text-slate-600 group-hover:text-blue-400 transition-colors flex-shrink-0" />
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
