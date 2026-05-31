import { useState, useCallback } from 'react';
import SPHScene from '@/components/SPHScene';
import ControlPanel from '@/components/ControlPanel';
import { useSimulationStore } from '@/store/simulationStore';
import { ObstacleData, ObstacleType } from '@/engine/ObstacleManager';

export default function Home() {
  const { params, isRunning, fps, frameTime, computeTime } = useSimulationStore();
  const toggleRunning = useSimulationStore((state) => state.toggleRunning);
  const setParams = useSimulationStore((state) => state.setParams);
  const updateFps = useSimulationStore((state) => state.updateFps);

  const [resetTrigger, setResetTrigger] = useState(0);
  const [selectedObstacleType, setSelectedObstacleType] = useState<ObstacleType | null>(null);
  const [selectedObstacleId, setSelectedObstacleId] = useState<string | null>(null);
  const [obstacles, setObstacles] = useState<ObstacleData[]>([]);

  const handleReset = useCallback(() => {
    setResetTrigger((prev) => prev + 1);
  }, []);

  const handlePerformanceUpdate = useCallback(
    (currentFps: number, currentFrameTime: number, currentComputeTime: number) => {
      updateFps(currentFps, currentFrameTime, currentComputeTime);
    },
    [updateFps]
  );

  const handleObstacleCreated = useCallback((obstacle: ObstacleData) => {
    setObstacles((prev) => [...prev, obstacle]);
    setSelectedObstacleType(null);
    setSelectedObstacleId(obstacle.id);
  }, []);

  const handleObstacleSelected = useCallback((obstacleId: string | null) => {
    setSelectedObstacleId(obstacleId);
  }, []);

  const handleDeleteObstacle = useCallback((obstacleId: string) => {
    setObstacles((prev) => prev.filter((o) => o.id !== obstacleId));
    if (selectedObstacleId === obstacleId) {
      setSelectedObstacleId(null);
    }
  }, [selectedObstacleId]);

  const handleAddObstacle = useCallback((type: ObstacleType) => {
    setSelectedObstacleType((prev) => (prev === type ? null : type));
    setSelectedObstacleId(null);
  }, []);

  const handleClearObstacles = useCallback(() => {
    setObstacles([]);
    setSelectedObstacleId(null);
    setSelectedObstacleType(null);
  }, []);

  return (
    <div className="w-screen h-screen flex overflow-hidden bg-[#0a0e1a]">
      <div className="flex-1 relative">
        <SPHScene
          params={params}
          isRunning={isRunning}
          onPerformanceUpdate={handlePerformanceUpdate}
          resetTrigger={resetTrigger}
          selectedObstacleType={selectedObstacleType}
          onObstacleCreated={handleObstacleCreated}
          onObstacleSelected={handleObstacleSelected}
          selectedObstacleId={selectedObstacleId}
          onDeleteObstacle={handleDeleteObstacle}
        />
        
        <div className="absolute top-4 left-4 z-10">
          <div className="bg-black/40 backdrop-blur-md rounded-lg px-4 py-2 border border-gray-700/50">
            <h2 className="text-lg font-bold text-white">
              <span className="text-cyan-400">SPH</span> 流体模拟
            </h2>
            <p className="text-xs text-gray-400">
              Smoothed Particle Hydrodynamics · WebGPU Compute Shader
            </p>
          </div>
        </div>

        <div className="absolute bottom-4 left-4 z-10">
          <div className="bg-black/40 backdrop-blur-md rounded-lg px-4 py-2 border border-gray-700/50">
            <div className="text-xs text-gray-400 space-y-1">
              <p>• <span className="text-cyan-400">密度计算</span> - Poly6 核函数</p>
              <p>• <span className="text-cyan-400">压力力</span> - Spiky 核梯度</p>
              <p>• <span className="text-cyan-400">粘性力</span> - Laplacian 核</p>
              <p>• <span className="text-cyan-400">时间积分</span> - 半隐式欧拉</p>
              <p>• <span className="text-cyan-400">邻居搜索</span> - 空间哈希网格</p>
              <p>• <span className="text-cyan-400">物理引擎</span> - Rapier3D</p>
            </div>
          </div>
        </div>
      </div>
      
      <ControlPanel
        params={params}
        isRunning={isRunning}
        fps={fps}
        frameTime={frameTime}
        computeTime={computeTime}
        onToggleRunning={toggleRunning}
        onReset={handleReset}
        onParamsChange={setParams}
        obstacles={obstacles}
        selectedObstacleType={selectedObstacleType}
        selectedObstacleId={selectedObstacleId}
        onAddObstacle={handleAddObstacle}
        onSelectObstacle={handleObstacleSelected}
        onDeleteObstacle={handleDeleteObstacle}
        onClearObstacles={handleClearObstacles}
      />
    </div>
  );
}
