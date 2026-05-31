import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { useAppStore } from '../store/useAppStore';
import { BatchSolveTimeChart } from '../components/BatchSolveTimeChart';
import { BatchResidualChart } from '../components/BatchResidualChart';
import type { BatchState, BatchSolveResult } from '../types';
import { api } from '../services/api';

export const BatchDetail: React.FC = () => {
  const { batchId } = useParams<{ batchId: string }>();
  const [batch, setBatch] = useState<BatchState | null>(null);
  const [batchResult, setBatchResult] = useState<BatchSolveResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [polling, setPolling] = useState(false);

  const fetchBatch = useCallback(async () => {
    if (!batchId) return;
    try {
      const data = await api.getBatch(batchId);
      setBatch(data);

      if (data.status === 'completed' || data.status === 'failed') {
        try {
          const result = await api.getBatchResult(batchId);
          setBatchResult(result);
        } catch (err) {
          console.error('Failed to fetch batch result:', err);
        }
        setPolling(false);
      }
    } catch (err) {
      console.error('Failed to fetch batch:', err);
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    if (!batchId) return;

    fetchBatch();

    let interval: NodeJS.Timeout | null = null;
    if (!batch || batch.status === 'processing' || batch.status === 'pending') {
      setPolling(true);
      interval = setInterval(fetchBatch, 2000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [batchId, fetchBatch, batch?.status]);

  const handleRefresh = () => {
    fetchBatch();
  };

  if (!batchId) {
    return <div className="p-8 text-center text-slate-400">Batch ID无效</div>;
  }

  if (loading && !batch) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="max-w-6xl mx-auto px-4 py-8">
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

  if (!batch) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="text-center py-16 bg-slate-800/30 rounded-xl border border-slate-700">
            <AlertCircle className="w-16 h-16 mx-auto mb-4 text-slate-600" />
            <p className="text-slate-400 mb-2">批量任务不存在</p>
            <p className="text-sm text-slate-500 font-mono">{batchId}</p>
          </div>
        </div>
      </div>
    );
  }

  const isProcessing = batch.status === 'processing' || batch.status === 'pending';

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <Link
              to="/"
              className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              返回求解器
            </Link>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-2 px-3 py-1.5 text-sm text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 ${polling ? 'animate-spin' : ''}`} />
              刷新
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4 mb-4">
            <h1 className="text-2xl sm:text-3xl font-bold text-white">批量求解任务详情</h1>
            <span className="px-3 py-1 bg-slate-800 rounded-full text-xs text-slate-400 font-mono">
              #{batchId.slice(0, 12)}
            </span>
            <span
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border ${
                batch.status === 'completed'
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                  : batch.status === 'failed'
                    ? 'bg-red-500/20 text-red-400 border-red-500/30'
                    : 'bg-blue-500/20 text-blue-400 border-blue-500/30'
              }`}
            >
              {isProcessing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {batch.status === 'completed'
                ? '已完成'
                : batch.status === 'failed'
                  ? '失败'
                  : batch.status === 'processing'
                    ? '计算中'
                    : '等待中'}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">求解器</div>
              <div className="text-white font-medium">{batch.solver.toUpperCase()}</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">总任务数</div>
              <div className="text-white font-mono">{batch.taskIds.length}</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">已完成</div>
              <div className="text-emerald-400 font-mono">{batch.completedCount}</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1">失败</div>
              <div className="text-red-400 font-mono">{batch.failedCount}</div>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700">
              <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                <Clock className="w-3 h-3" />
                进度
              </div>
              <div className="text-white font-mono">{batch.progress.toFixed(1)}%</div>
            </div>
          </div>

          {isProcessing && (
            <div className="mt-6 bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <span>求解进度</span>
                <span>{batch.progress.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-cyan-500 rounded-full transition-all duration-500 relative"
                  style={{ width: `${batch.progress}%` }}
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse" />
                </div>
              </div>
            </div>
          )}

          {batch.tasks && batch.tasks.length > 0 && (
            <div className="mt-6 bg-slate-800/50 rounded-xl border border-slate-700 p-4">
              <h3 className="font-semibold text-slate-200 mb-4">子任务状态</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-10 gap-2">
                {batch.tasks.map((task, i) => (
                  <Link
                    key={task.taskId}
                    to={`/tasks/${task.taskId}`}
                    className="flex items-center gap-2 p-2 bg-slate-900/50 rounded-lg hover:bg-slate-700/50 transition-colors"
                  >
                    {task.status === 'completed' ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                    ) : task.status === 'failed' ? (
                      <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    ) : task.status === 'processing' ? (
                      <Loader2 className="w-4 h-4 text-blue-400 animate-spin flex-shrink-0" />
                    ) : (
                      <Clock className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    )}
                    <span className="text-xs text-slate-300 font-mono">b{i + 1}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <BatchSolveTimeChart data={batchResult} loading={!batchResult} />
            <BatchResidualChart
              data={batchResult}
              tol={1e-6}
              loading={!batchResult}
            />
          </div>

          {batchResult && (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
              <h3 className="font-semibold text-slate-200 mb-4">各右端项详细结果</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-3 px-4 text-slate-400 font-medium">#</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-medium">求解时间</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-medium">迭代次数</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-medium">最终残差</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-medium">收敛</th>
                      <th className="text-left py-3 px-4 text-slate-400 font-medium">解前3个元素</th>
                    </tr>
                  </thead>
                  <tbody>
                    {batchResult.results.map((result, i) => (
                      <tr
                        key={i}
                        className="border-b border-slate-800 hover:bg-slate-800/30"
                      >
                        <td className="py-3 px-4 font-mono text-slate-300">b{i + 1}</td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {result.solveTime.toFixed(4)}s
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {result.iterations}
                        </td>
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {result.finalResidual.toExponential(2)}
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${
                              result.converged
                                ? 'bg-emerald-500/20 text-emerald-400'
                                : 'bg-red-500/20 text-red-400'
                            }`}
                          >
                            {result.converged ? '是' : '否'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs text-slate-400">
                          [{result.solutionFirst10.slice(0, 3).map((v) => v.toFixed(3)).join(', ')}...]
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
