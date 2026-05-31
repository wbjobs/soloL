import React, { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppStore } from '../store/useAppStore';
import { FileUpload } from '../components/FileUpload';
import { SolverConfig } from '../components/SolverConfig';
import { MatrixHeatmap } from '../components/MatrixHeatmap';
import { MatrixStats } from '../components/MatrixStats';
import { TaskList } from '../components/TaskList';
import { ConditionNumberWarning } from '../components/ConditionNumberWarning';
import type { SolverType } from '../types';

export const Home: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentMatrix,
    matrixStats,
    heatmapData,
    conditionInfo,
    recentTasks,
    loading,
    error,
    uploadMatrix,
    submitSolve,
    submitBatchSolve,
    fetchTasks,
    fetchMatrixStats,
    fetchHeatmapData,
    fetchConditionInfo,
    setError,
  } = useAppStore();

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  useEffect(() => {
    if (currentMatrix) {
      fetchMatrixStats(currentMatrix.matrixId);
      fetchHeatmapData(currentMatrix.matrixId);
      fetchConditionInfo(currentMatrix.matrixId);
    }
  }, [currentMatrix, fetchMatrixStats, fetchHeatmapData, fetchConditionInfo]);

  const handleUpload = useCallback(
    async (file: File) => {
      const matrix = await uploadMatrix(file);
      return matrix;
    },
    [uploadMatrix]
  );

  const handleSubmit = useCallback(
    async (config: {
      solver: SolverType;
      tol: number;
      maxIter: number;
      isBatch: boolean;
      rhsIndices?: number[];
    }) => {
      if (!currentMatrix) return;

      try {
        if (config.isBatch) {
          const batchId = await submitBatchSolve({
            matrixId: currentMatrix.matrixId,
            solver: config.solver,
            tol: config.tol,
            maxIter: config.maxIter,
          });
          navigate(`/batch/${batchId}`);
        } else {
          const taskId = await submitSolve({
            matrixId: currentMatrix.matrixId,
            solver: config.solver,
            tol: config.tol,
            maxIter: config.maxIter,
            rhsIndex: config.rhsIndices?.[0],
          });
          navigate(`/tasks/${taskId}`);
        }
      } catch (err) {
        console.error('Submit failed:', err);
      }
    },
    [currentMatrix, submitSolve, submitBatchSolve, navigate]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3 tracking-tight">
            高性能稀疏矩阵线性方程组求解器
          </h2>
          <p className="text-slate-400 max-w-2xl mx-auto">
            支持 CG、GMRES、SuperLU 三种求解器，处理最高 1M × 1M 规模的稀疏矩阵，
            提供实时收敛曲线和矩阵结构可视化分析
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 space-y-6">
            <FileUpload
              onUpload={handleUpload}
              currentMatrix={currentMatrix}
              loading={loading.upload}
              error={error}
            />
            <SolverConfig
              matrixInfo={currentMatrix}
              onSubmit={handleSubmit}
              loading={loading.submit}
              loadingBatch={loading.submitBatch}
            />
            <TaskList tasks={recentTasks} loading={loading.tasks} />
          </div>

          <div className="lg:col-span-7 space-y-6">
            <ConditionNumberWarning
              info={conditionInfo}
              loading={loading.condition}
            />
            <MatrixStats
              stats={matrixStats}
              loading={loading.stats}
            />
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <MatrixHeatmap
                data={heatmapData}
                loading={loading.heatmap}
              />
              <div className="space-y-6">
                <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
                  <h3 className="font-semibold text-slate-200 mb-4">求解器说明</h3>
                  <div className="space-y-3 text-sm text-slate-400">
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-blue-500 flex-shrink-0" />
                      <div>
                        <span className="text-white font-medium">CG</span>
                        {' '}- 共轭梯度法，适用于对称正定矩阵，收敛速度快
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-purple-500 flex-shrink-0" />
                      <div>
                        <span className="text-white font-medium">GMRES</span>
                        {' '}- 通用最小残差法，适用于非对称矩阵，稳定性好
                      </div>
                    </div>
                    <div className="flex items-start gap-2">
                      <div className="w-2 h-2 mt-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                      <div>
                        <span className="text-white font-medium">SuperLU</span>
                        {' '}- LU分解直接求解，结果精确，适合中小规模矩阵
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-blue-500/10 to-cyan-500/10 rounded-xl border border-blue-500/20 p-6">
                  <h3 className="font-semibold text-blue-400 mb-3">系统参数</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-slate-500">最大矩阵规模</div>
                      <div className="text-white font-mono">1,000,000 × 1M</div>
                    </div>
                    <div>
                      <div className="text-slate-500">任务超时</div>
                      <div className="text-white font-mono">300 秒</div>
                    </div>
                    <div>
                      <div className="text-slate-500">最大文件大小</div>
                      <div className="text-white font-mono">512 MB</div>
                    </div>
                    <div>
                      <div className="text-slate-500">支持格式</div>
                      <div className="text-white font-mono">Matrix Market (.mtx)</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
