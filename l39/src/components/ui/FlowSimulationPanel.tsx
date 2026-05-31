import { useState, useEffect, useCallback } from 'react';
import { Play, RotateCcw, Droplets, TrendingUp, BarChart3, ChevronDown, ChevronUp } from 'lucide-react';
import { useStore } from '../../store/useStore';
import { simulationAPI } from '../../utils/api';
import { SimulationParams, Point3D } from '../../../shared/types';

interface FlowSimulationPanelProps {
  isOpen: boolean;
  onToggle: () => void;
}

export function FlowSimulationPanel({ isOpen, onToggle }: FlowSimulationPanelProps) {
  const { gridId, trajectories, setSimulationResult, setShowSimulation, showSimulation } = useStore();
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [simulationId, setSimulationId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  const [simParams, setSimParams] = useState<SimulationParams>({
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

    try {
      const result = await simulationAPI.startFlowSimulation(gridId, simParams, wells);
      setSimulationId(result.simulationId);

      const pollProgress = () => {
        if (!simulationId) return;
        
        simulationAPI.getSimulationProgress(result.simulationId).then(progress => {
          setProgress(progress.progress);
          
          if (progress.status === 'completed' && progress.result) {
            setSimulationResult(progress.result);
            setShowSimulation(true);
            setIsRunning(false);
          } else if (progress.status === 'error') {
            setIsRunning(false);
            alert(progress.error || '模拟失败');
          } else if (progress.status === 'running') {
            setTimeout(pollProgress, 1000);
          }
        });
      };

      setTimeout(pollProgress, 500);
    } catch (error) {
      console.error('Failed to start simulation:', error);
      setIsRunning(false);
    }
  };

  const resetSimulation = () => {
    setSimulationResult(null);
    setShowSimulation(false);
    setProgress(0);
    setSimulationId(null);
    setIsRunning(false);
  };

  return (
    <div className="mb-2">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
      >
        <div className="flex items-center gap-2">
          <Droplets size={18} className="text-blue-400" />
          <span className="text-sm font-medium text-white">流动模拟</span>
        </div>
        {isOpen ? <ChevronUp size={18} className="text-gray-400" /> : <ChevronDown size={18} className="text-gray-400" />}
      </button>

      {isOpen && (
        <div className="mt-2 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">显示模拟结果</span>
            <button
              onClick={() => setShowSimulation(!showSimulation)}
              className={`w-10 h-5 rounded-full transition-colors ${showSimulation ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform ${showSimulation ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {expanded && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">总时间 (天)</label>
                  <input
                    type="number"
                    value={simParams.totalTime}
                    onChange={(e) => setSimParams(p => ({ ...p, totalTime: Number(e.target.value) }))}
                    className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">时间步长 (天)</label>
                  <input
                    type="number"
                    value={simParams.timeStep}
                    onChange={(e) => setSimParams(p => ({ ...p, timeStep: Number(e.target.value) }))}
                    className="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  />
                </div>
              </div>

              <div className="bg-gray-800 rounded p-3">
                <h4 className="text-xs font-medium text-gray-300 mb-2">岩石属性</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">渗透率 (mD)</label>
                    <input
                      type="number"
                      value={simParams.rockProperties.permeability}
                      onChange={(e) => setSimParams(p => ({ ...p, rockProperties: { ...p.rockProperties, permeability: Number(e.target.value) } }))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">孔隙度</label>
                    <input
                      type="number"
                      step="0.01"
                      value={simParams.rockProperties.porosity}
                      onChange={(e) => setSimParams(p => ({ ...p, rockProperties: { ...p.rockProperties, porosity: Number(e.target.value) } }))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                </div>
              </div>

              <div className="bg-gray-800 rounded p-3">
                <h4 className="text-xs font-medium text-gray-300 mb-2">流体属性</h4>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">原油粘度 (cP)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={simParams.fluidProperties.oilViscosity}
                      onChange={(e) => setSimParams(p => ({ ...p, fluidProperties: { ...p.fluidProperties, oilViscosity: Number(e.target.value) } }))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-400 mb-1">水粘度 (cP)</label>
                    <input
                      type="number"
                      step="0.1"
                      value={simParams.fluidProperties.waterViscosity}
                      onChange={(e) => setSimParams(p => ({ ...p, fluidProperties: { ...p.fluidProperties, waterViscosity: Number(e.target.value) } }))}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          <button
            onClick={() => setExpanded(!expanded)}
            className="w-full text-xs text-gray-400 hover:text-gray-300 text-center py-1"
          >
            {expanded ? '收起参数' : '展开参数'}
          </button>

          {isRunning && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">模拟进度</span>
                <span className="text-white">{progress.toFixed(0)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-blue-500 transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={startSimulation}
              disabled={!gridId || isRunning || trajectories.length === 0}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              <Play size={16} />
              <span className="text-sm">{isRunning ? '运行中...' : '开始模拟'}</span>
            </button>
            <button
              onClick={resetSimulation}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
              title="重置"
            >
              <RotateCcw size={16} />
            </button>
          </div>

          {useStore.getState().simulationResult && (
            <div className="bg-gray-800 rounded-lg p-3 space-y-2">
              <h4 className="text-sm font-medium text-white flex items-center gap-2">
                <BarChart3 size={16} className="text-blue-400" />
                模拟结果
              </h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="bg-gray-700 rounded p-2">
                  <div className="text-gray-400">累计产油</div>
                  <div className="text-white font-medium">
                    {(useStore.getState().simulationResult!.productionData[
                      useStore.getState().simulationResult!.productionData.length - 1
                    ]?.cumulativeOil.toFixed(2) || 0)} m³
                  </div>
                </div>
                <div className="bg-gray-700 rounded p-2">
                  <div className="text-gray-400">累计产水</div>
                  <div className="text-white font-medium">
                    {(useStore.getState().simulationResult!.productionData[
                      useStore.getState().simulationResult!.productionData.length - 1
                    ]?.cumulativeWater.toFixed(2) || 0)} m³
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
