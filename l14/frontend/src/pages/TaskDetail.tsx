import React, { useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  Clock,
  AlertCircle,
  RefreshCw,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { ConvergenceChart } from '../components/ConvergenceChart';
import { SolveResult } from '../components/SolveResult';
import { MatrixStats } from '../components/MatrixStats';
import { MatrixHeatmap } from '../components/MatrixHeatmap';

export const TaskDetail: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const {
    currentTask,
    matrixStats,
    heatmapData,
    loading,
    error,
    fetchTask,
    fetchMatrixStats,
    fetchHeatmapData,
    pollTaskProgress,
  } = useAppStore();

  useEffect(() => {
    if (!taskId) return;

    let stopPolling: (() => void) | undefined;

    const init = async () => {
      await fetchTask(taskId);

      if (currentTask && currentTask.status !== 'completed' && currentTask.status !== 'failed') {
        stopPolling = pollTaskProgress(taskId, 1500);
      }
    };

    init();

    return () => {
      if (stopPolling) {
        stopPolling();
      }
    };
  }, [taskId, fetchTask, pollTaskProgress, currentTask]);

  useEffect(() => {
    if (currentTask) {
      fetchMatrixStats(currentTask.matrixId);
      fetchHeatmapData(currentTask.matrixId);
    }
  }, [currentTask, fetchMatrixStats, fetchHeatmapData]);

  const handleRefresh = () => {
    if (taskId) {
      fetchTask(taskId);
    }
  };

  const SOLVER_NAMES: Record<string, string> = {
    cg: '共轭梯度法 (CG)',
    gmres: 'GMRES',
    superlu: 'SuperLU 直接求解',
  };

  if (!taskId) {
    return <div className="p-8 text-center text-slate-400">任务ID无效</div>;
  }

  if (loading.task && !currentTask) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-8">
            <Link
              to="/tasks"
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              返回任务列表
            </Link>
          </div>
          <div className="space-y-6">
            <div className="h-24 bg-slate-800/50 rounded-xl animate-pulse" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="h-96 bg-slate-800/50 rounded-xl animate-pulse" />
              <div className="h-96 bg-slate-800/50 rounded-xl animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!currentTask) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="flex items-center gap-3 mb-8">
            <Link
              to="/tasks"
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              返回任务列表
            </Link>
          </div>
          <div className="text-center py-16 bg-slate-800/30 rounded-xl border border-slate-700">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-slate-600" />
            <p className="text-slate-400 mb-2">任务不存在</p>
            <p className="text-sm text-slate-500 font-mono">{taskId}</p>
          </div>
        </div>
      </div>
    );
  }

  const isProcessing = currentTask.status === 'processing' || currentTask.status === 'pending';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <Link
              to="/tasks"
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              返回任务列表
            </Link>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <RefreshCw className="w-4 h-4" />
              刷新
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4 mb-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">求解任务详情</h1>
            <span className="px-3 py-1 bg-slate-800 rounded-full text-xs text-slate-400 font-mono">
              #{taskId.slice(0, 12)}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${
                currentTask.status === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : currentTask.status === 'failed'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                    : 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
              }`}
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {currentTask.status === 'completed'
                ? '已完成'
                : currentTask.status === 'failed'
                  ? '失败'
                  : currentTask.status === 'processing'
                    ? '计算中'
                    : '等待中'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">求解器</div>
              <div className="text-white font-medium">
                {SOLVER_NAMES[currentTask.solver] || currentTask.solver}
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">矩阵ID</div>
              <div className="text-white font-mono text-sm">
                {currentTask.matrixId.slice(0, 12)}...
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                已用时间
              </div>
              <div className="text-white font-mono">
                {currentTask.elapsedTime < 1
                  ? `${(currentTask.elapsedTime * 1000).toFixed(0)} ms`
                  : `${currentTask.elapsedTime.toFixed(2)} s`}
              </div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">迭代进度</div>
              <div className="text-white font-mono">
                {currentTask.currentIter} / {currentTask.maxIter}
              </div>
            </div>
          </div>

          {isProcessing && (
            <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>求解进度</span>
                <span>{currentTask.progress.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500 relative"
                  style={{ width: `${currentTask.progress}%` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse" />
                </div>
              </div>
            </div>
          )}

          {currentTask.error && (
            <div className="mt-6 bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-400 font-medium mb-1">求解失败</p>
                  <p className="text-sm text-red-300/70">{currentTask.error}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <SolveResult
            result={currentTask.result || null}
            error={currentTask.error}
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ConvergenceChart
              residuals={currentTask.residualHistory || []}
              tol={1e-6}
              solver={currentTask.solver}
              loading={isProcessing}
            />
            <MatrixHeatmap
              data={heatmapData}
              loading={loading.heatmap}
            />
          </div>

          <MatrixStats
            stats={matrixStats}
            loading={loading.stats}
          />
        </div>
      </div>
    </div>
  );
};
