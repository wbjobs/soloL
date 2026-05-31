import { useState, useCallback } from 'react';
import { Play, RotateCcw, BarChart3, TrendingUp, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { simulationAPI } from '../../utils/api';
import { MonteCarloParams, KrigingParams, SimulationParams, Point3D } from '../../../shared/types';

interface MonteCarloPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function MonteCarloPanel({ isOpen, onToggle }: MonteCarloPanelProps) {
  const { gridId, trajectories, setMonteCarloResult } = useStore();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentSim, setCurrentSim] = useState(0);
  const [totalSims, setTotalSims] = useState(0);
  const [mcId, setMcId] = useState<string | null>(null);
  const [expandedParams, setExpandedParams] = useState(true);

  const [monteCarloParams, setMonteCarloParams] = useState<MonteCarloParams>({
    numSimulations: 50,
    rangeDistribution: { mean: 200, std: 30, min: 100, max: 400 },
    sillDistribution: { mean: 1.0, std: 0.2, min: 0.5, max: 2.0 },
    permeabilityDistribution: { mean: 100, std: 30, min: 10, max: 500 },
    porosityDistribution: { mean: 0.25, std: 0.05, min: 0.1, max: 0.4 }
  });

  const [baseKrigingParams] = useState<KrigingParams>({
    model: 'spherical',
    range: 200,
    sill: 1.0,
    nugget: 0.01,
    searchRadius: 150,
    maxNeighbors: 12
  });

  const [simParams] = useState<SimulationParams>({
    totalTime: 365 * 5,
    timeStep: 30,
    initialPressure: 3000,
    wellPressure: 1000,
    reservoirPressure: 3500,
    rockProperties: {
      permeability: 100,
      porosity: 0.25,
      compressibility: 1e-6,
      relativePermeabilityOil: 1.0,
      relativePermeabilityWater: 0.8
    },
    fluidProperties: {
      oilViscosity: 1.5,
      waterViscosity: 0.8,
      oilDensity: 850,
      waterDensity: 1000,
      formationVolumeFactorOil: 1.2,
      formationVolumeFactorWater: 1.0
    }
  });

  const wellPoints = useCallback((): Point3D[] => {
    const points: Point3D[] = [];
    trajectories.forEach(traj => {
      if (traj.samplePoints.length > 0) {
        const midIdx = Math.floor(traj.samplePoints.length / 2);
        points.push(traj.samplePoints[midIdx]);
      } else if (traj.segments.length > 0) {
        const seg = traj.segments[0];
        points.push({
          x: (seg.p0.x + seg.p3.x) / 2,
          y: (seg.p0.y + seg.p3.y) / 2,
          z: (seg.p0.z + seg.p3.z) / 2
        });
      }
    });
    return points;
  }, [trajectories]);

  const startSimulation = async () => {
    if (!gridId || isRunning) return;

    const wells = wellPoints();
    if (wells.length === 0) {
      alert('请先创建至少一条钻井轨迹');
      return;
    }

    setIsRunning(true);
    setProgress(0);
    setCurrentSim(0);
    setTotalSims(monteCarloParams.numSimulations);

    try {
      const result = await simulationAPI.startMonteCarlo(
        gridId,
        monteCarloParams,
        baseKrigingParams,
        simParams,
        wells
      );
      setMcId(result.mcId);

      const pollProgress = () => {
        if (!mcId) return;
        
        simulationAPI.getMonteCarloProgress(result.mcId).then(progress => {
          setProgress(progress.progress);
          setCurrentSim(progress.currentSim);
          setTotalSims(progress.totalSims);
          
          if (progress.status === 'completed' && progress.result) {
            setMonteCarloResult(progress.result);
            setIsRunning(false);
          } else if (progress.status === 'error') {
            setIsRunning(false);
            alert(progress.error || '模拟失败');
          } else if (progress.status === 'running') {
            setTimeout(pollProgress, 2000);
          }
        });
      };

      setTimeout(pollProgress, 1000);
    } catch (error) {
      console.error('Failed to start Monte Carlo:', error);
      setIsRunning(false);
    }
  };

  const resetSimulation = () => {
    setMonteCarloResult(null);
    setProgress(0);
    setCurrentSim(0);
    setMcId(null);
    setIsRunning(false);
  };

  const formatNumber = (value: number, decimals = 2) => {
    return value.toFixed(decimals);
  };

  const mcResult = useStore(state => state.monteCarloResult);

  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <BarChart3 size={18} className="text-purple-400" />
          <span className="text-sm font-medium text-white">不确定性量化</span>
        </div>
        {isOpen ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>

      {isOpen && (
        <div className="mt-2 space-y-4">
          {expandedParams && (
            <div className="space-y-3 text-sm">
              <div>
                <label className="block text-xs text-gray-400 mb-1">模拟次数</label>
                <input
                  type="number"
                  min="10"
                  max="1000"
                  value={monteCarloParams.numSimulations}
                  onChange={(e) => setMonteCarloParams(p => ({ ...p, numSimulations: Math.min(1000, Math.max(10, Number(e.target.value))) }))}
                  className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                />
              </div>

              <div className="bg-gray-800 rounded p-3">
                <h4 className="text-xs font-medium text-gray-300 mb-2">变程参数分布</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">均值</label>
                    <input
                      type="number"
                      value={monteCarloParams.rangeDistribution.mean}
                      onChange={(e) => setMonteCarloParams(p => ({ 
                        ...p, 
                        rangeDistribution: { ...p.rangeDistribution, mean: Number(e.target.value) } 
                      }))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">标准差</label>
                    <input
                      type="number"
                      value={monteCarloParams.rangeDistribution.std}
                      onChange={(e) => setMonteCarloParams(p => ({ 
                        ...p, 
                        rangeDistribution: { ...p.rangeDistribution, std: Number(e.target.value) } 
                      }))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded p-3">
                <h4 className="text-xs font-medium text-gray-300 mb-2">渗透率分布 (mD)</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">均值</label>
                    <input
                      type="number"
                      value={monteCarloParams.permeabilityDistribution.mean}
                      onChange={(e) => setMonteCarloParams(p => ({ 
                        ...p, 
                        permeabilityDistribution: { ...p.permeabilityDistribution, mean: Number(e.target.value) } 
                      }))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">标准差</label>
                    <input
                      type="number"
                      value={monteCarloParams.permeabilityDistribution.std}
                      onChange={(e) => setMonteCarloParams(p => ({ 
                        ...p, 
                        permeabilityDistribution: { ...p.permeabilityDistribution, std: Number(e.target.value) } 
                      }))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-xs"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => setExpandedParams(!expandedParams)}
            className="w-full text-xs text-gray-400 hover:text-gray-300 text-center py-1"
          >
            {expandedParams ? '收起参数' : '展开参数'}
          </button>

          {isRunning && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">模拟进度</span>
                <span className="text-white">{currentSim}/{totalSims} ({progress.toFixed(0)}%)</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-purple-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-gray-500 text-center">每次模拟包含克里金插值+流动模拟，预计等待时间较长</p>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={startSimulation}
              disabled={!gridId || isRunning || trajectories.length === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Play size={16} />
              <span className="text-sm">{isRunning ? '运行中...' : '开始蒙特卡洛'}</span>
            </button>
            <button
              onClick={resetSimulation}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              title="重置"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          {mcResult && (
            <div className="space-y-3">
              <div className="bg-gray-800 rounded-lg p-3">
                <h4 className="text-sm font-medium text-white flex items-center gap-2 mb-3">
                  <TrendingUp size={16} className="text-green-400" />
                  可采储量概率分布 (m³)
                </h4>
                
                <div className="space-y-2">
                  <div className="flex items-center justify-between bg-red-900/30 border border-red-700 rounded-lg p-3">
                    <div>
                      <span className="text-xs text-gray-400">P90 (保守)</span>
                      <p className="text-lg font-bold text-red-400">{formatNumber(mcResult.statistics.recoverableReserves.P90)}</p>
                    </div>
                    <span className="text-xs text-gray-500">90%概率≥此值</span>
                  </div>
                  
                  <div className="flex items-center justify-between bg-yellow-900/30 border border-yellow-700 rounded-lg p-3">
                    <div>
                      <span className="text-xs text-gray-400">P50 (中位)</span>
                      <p className="text-lg font-bold text-yellow-400">{formatNumber(mcResult.statistics.recoverableReserves.P50)}</p>
                    </div>
                    <span className="text-xs text-gray-500">50%概率≥此值</span>
                  </div>
                  
                  <div className="flex items-center justify-between bg-green-900/30 border border-green-700 rounded-lg p-3">
                    <div>
                      <span className="text-xs text-gray-400">P10 (乐观)</span>
                      <p className="text-lg font-bold text-green-400">{formatNumber(mcResult.statistics.recoverableReserves.P10)}</p>
                    </div>
                    <span className="text-xs text-gray-500">10%概率≥此值</span>
                  </div>
                </div>

                <div className="mt-3 pt-3 border-t border-gray-700">
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-400">均值</span>
                    <span className="text-white">{formatNumber(mcResult.statistics.recoverableReserves.mean)} m³</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-gray-400">标准差</span>
                    <span className="text-white">{formatNumber(mcResult.statistics.recoverableReserves.std)} m³</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-gray-400">变异系数</span>
                    <span className="text-white">
                      {formatNumber(mcResult.statistics.recoverableReserves.std / mcResult.statistics.recoverableReserves.mean * 100, 1)}%
                    </span>
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded-lg p-3">
                <h4 className="text-sm font-medium text-white flex items-center gap-2 mb-2">
                  <Info size={16} className="text-blue-400" />
                  不确定性参数
                </h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-gray-700 rounded p-2">
                    <div className="text-gray-400">最终含油饱和度 P50</div>
                    <div className="text-white font-medium">{formatNumber(mcResult.statistics.finalOilSaturation.P50 * 100, 1)}%</div>
                  </div>
                  <div className="bg-gray-700 rounded p-2">
                    <div className="text-gray-400">见水时间 P50</div>
                    <div className="text-white font-medium">{formatNumber(mcResult.statistics.waterBreakthroughTime.P50, 0)} 天</div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
