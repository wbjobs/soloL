import React, { useState } from 'react';
import { Play, Cpu, Zap, Calculator, AlertTriangle, Layers, Users } from 'lucide-react';
import { cn } from '../lib/utils';
import type { SolverType, MatrixInfo } from '../types';

interface SolverConfigProps {
  matrixInfo: MatrixInfo | null;
  onSubmit: (config: {
    solver: SolverType;
    tol: number;
    maxIter: number;
    isBatch: boolean;
    rhsIndices?: number[];
  }) => void;
  loading?: boolean;
  loadingBatch?: boolean;
}

const SOLVERS: {
  type: SolverType;
  name: string;
  description: string;
  icon: React.ReactNode;
  color: string;
}[] = [
  {
    type: 'cg',
    name: '共轭梯度法 (CG)',
    description: '适用于对称正定矩阵，收敛快，内存占用小',
    icon: <Zap className="w-5 h-5" />,
    color: 'from-blue-500 to-cyan-500',
  },
  {
    type: 'gmres',
    name: 'GMRES',
    description: '通用迭代法，适用于非对称矩阵，稳定性好',
    icon: <Cpu className="w-5 h-5" />,
    color: 'from-purple-500 to-pink-500',
  },
  {
    type: 'superlu',
    name: 'SuperLU 直接求解',
    description: 'LU分解直接求解，适用于中小规模矩阵，结果精确',
    icon: <Calculator className="w-5 h-5" />,
    color: 'from-amber-500 to-orange-500',
  },
];

export const SolverConfig: React.FC<SolverConfigProps> = ({
  matrixInfo,
  onSubmit,
  loading,
  loadingBatch,
}) => {
  const [selectedSolver, setSelectedSolver] = useState<SolverType>('cg');
  const [tol, setTol] = useState(1e-6);
  const [maxIter, setMaxIter] = useState(1000);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedRhsIndex, setSelectedRhsIndex] = useState(0);

  const isSquare = matrixInfo && matrixInfo.shape[0] === matrixInfo.shape[1];
  const isLarge = matrixInfo && matrixInfo.shape[0] > 10000;
  const highCondition = matrixInfo && matrixInfo.conditionNumber && matrixInfo.conditionNumber > 1e8;
  const hasMultipleRhs = matrixInfo && (matrixInfo.numRhs || 1) > 1;
  const numRhs = matrixInfo?.numRhs || 1;

  const solver = SOLVERS.find((s) => s.type === selectedSolver)!;

  const isLoading = loading || loadingBatch;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-slate-200 mb-4">选择求解器</h3>
        <div className="grid gap-3">
          {SOLVERS.map((s) => (
            <button
              key={s.type}
              onClick={() => setSelectedSolver(s.type)}
              disabled={!matrixInfo || loading}
              className={cn(
                'relative p-4 rounded-xl border-2 text-left transition-all duration-200',
                selectedSolver === s.type
                  ? cn(
                      'border-transparent bg-gradient-to-r',
                      s.color,
                      'bg-opacity-20',
                      'ring-2 ring-offset-2 ring-offset-slate-900'
                    )
                  : 'border-slate-700 bg-slate-800/50 hover:border-slate-600',
                (!matrixInfo || loading) && 'opacity-50 cursor-not-allowed'
              )}
              style={
                selectedSolver === s.type
                  ? {
                      backgroundImage: `linear-gradient(135deg, var(--tw-gradient-stops))`,
                      backgroundClip: 'padding-box',
                    }
                  : {}
              }
            >
              <div
                className={cn(
                  'p-3 rounded-lg bg-slate-900/80 backdrop-blur-sm',
                  selectedSolver === s.type && 'bg-slate-900/60'
                )}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={cn(
                      'w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br',
                      s.color
                    )}
                  >
                    <div className="text-white">{s.icon}</div>
                  </div>
                  <div className="flex-1">
                    <p
                      className={cn(
                        'font-semibold',
                        selectedSolver === s.type ? 'text-white' : 'text-slate-200'
                      )}
                    >
                      {s.name}
                    </p>
                    <p className="text-sm text-slate-400">{s.description}</p>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {selectedSolver !== 'superlu' && (
        <div className="space-y-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
          <h4 className="font-medium text-slate-200">迭代参数</h4>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm text-slate-400">收敛容差 (tol)</label>
              <span className="font-mono text-sm text-blue-400">{tol.toExponential(0)}</span>
            </div>
            <input
              type="range"
              min="-12"
              max="-1"
              step="1"
              value={Math.log10(tol)}
              onChange={(e) => setTol(Math.pow(10, Number(e.target.value)))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>1e-12</span>
              <span>1e-6</span>
              <span>1e-1</span>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <label className="text-sm text-slate-400">最大迭代次数</label>
              <span className="font-mono text-sm text-blue-400">{maxIter}</span>
            </div>
            <input
              type="range"
              min="100"
              max="5000"
              step="100"
              value={maxIter}
              onChange={(e) => setMaxIter(Number(e.target.value))}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>100</span>
              <span>2500</span>
              <span>5000</span>
            </div>
          </div>
        </div>
      )}

      {hasMultipleRhs && (
        <div className="space-y-4 p-4 bg-slate-800/50 rounded-xl border border-slate-700">
          <h4 className="font-medium text-slate-200 flex items-center gap-2">
            <Layers className="w-4 h-4" />
            求解模式
            <span className="ml-auto text-xs font-normal text-slate-500">
              检测到 {numRhs} 个右端项
            </span>
          </h4>

          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => setIsBatchMode(false)}
              disabled={isLoading}
              className={cn(
                'p-3 rounded-lg border-2 text-left transition-all duration-200',
                !isBatchMode
                  ? 'border-cyan-500/50 bg-cyan-500/10'
                  : 'border-slate-700 bg-slate-900/50 hover:border-slate-600',
                isLoading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <Users className="w-4 h-4 text-slate-400" />
                <span
                  className={cn(
                    'font-medium text-sm',
                    !isBatchMode ? 'text-cyan-400' : 'text-slate-300'
                  )}
                >
                  单右端项
                </span>
              </div>
              <p className="text-xs text-slate-500">求解指定的单个 b 向量</p>
            </button>

            <button
              onClick={() => setIsBatchMode(true)}
              disabled={isLoading}
              className={cn(
                'p-3 rounded-lg border-2 text-left transition-all duration-200',
                isBatchMode
                  ? 'border-purple-500/50 bg-purple-500/10'
                  : 'border-slate-700 bg-slate-900/50 hover:border-slate-600',
                isLoading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                <Layers className="w-4 h-4 text-slate-400" />
                <span
                  className={cn(
                    'font-medium text-sm',
                    isBatchMode ? 'text-purple-400' : 'text-slate-300'
                  )}
                >
                  批量求解
                </span>
              </div>
              <p className="text-xs text-slate-500">并行求解全部 {numRhs} 个 b 向量</p>
            </button>
          </div>

          {!isBatchMode && (
            <div>
              <div className="flex justify-between items-center mb-2">
                <label className="text-sm text-slate-400">选择右端项</label>
                <span className="font-mono text-sm text-cyan-400">
                  b<sub>{selectedRhsIndex + 1}</sub>
                </span>
              </div>
              <input
                type="range"
                min="0"
                max={numRhs - 1}
                step="1"
                value={selectedRhsIndex}
                onChange={(e) => setSelectedRhsIndex(Number(e.target.value))}
                disabled={isLoading}
                className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-cyan-500"
              />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>b₁</span>
                <span>b{Math.ceil(numRhs / 2)}</span>
                <span>b{numRhs}</span>
              </div>
            </div>
          )}

          {isBatchMode && (
            <div className="p-3 bg-purple-500/10 rounded-lg border border-purple-500/30">
              <p className="text-xs text-purple-300/80">
                系统将为每个右端项创建独立的并行求解任务，完成后可对比各 b 向量的求解时间和收敛特性。
              </p>
            </div>
          )}
        </div>
      )}

      {!isSquare && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-400 font-medium">矩阵非方阵</p>
              <p className="text-sm text-amber-300/70">
                线性方程组求解需要方阵 (n × n)
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedSolver === 'superlu' && isLarge && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-400 font-medium">大规模矩阵建议</p>
              <p className="text-sm text-amber-300/70">
                对于 {matrixInfo!.shape[0].toLocaleString()} 阶矩阵，建议使用迭代法 (CG/GMRES)
              </p>
            </div>
          </div>
        </div>
      )}

      {selectedSolver === 'cg' && highCondition && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-lg">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-amber-400 font-medium">条件数较大</p>
              <p className="text-sm text-amber-300/70">
                条件数 ≈ {matrixInfo!.conditionNumber!.toExponential(2)}，可能影响CG收敛性
              </p>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() =>
          onSubmit({
            solver: selectedSolver,
            tol,
            maxIter,
            isBatch: isBatchMode,
            rhsIndices: !isBatchMode ? [selectedRhsIndex] : undefined,
          })
        }
        disabled={!matrixInfo || !isSquare || isLoading}
        className={cn(
          'w-full py-4 px-6 rounded-xl font-semibold text-white transition-all duration-200',
          'flex items-center justify-center gap-3',
          isBatchMode
            ? 'bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-500/25 hover:shadow-purple-500/40'
            : 'bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40',
          'disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none',
          isLoading && 'animate-pulse'
        )}
      >
        {isLoading ? (
          <>
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>正在提交任务...</span>
          </>
        ) : (
          <>
            {isBatchMode ? (
              <>
                <Layers className="w-5 h-5" />
                <span>开始批量求解 {numRhs} 个右端项</span>
              </>
            ) : (
              <>
                <Play className="w-5 h-5" />
                <span>开始求解 Ax = b{hasMultipleRhs ? ` (b${selectedRhsIndex + 1})` : ''}</span>
              </>
            )}
          </>
        )}
      </button>
    </div>
  );
};
