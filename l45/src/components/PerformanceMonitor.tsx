import { useSimulationStore } from '../store/simulationStore';
import { Activity, Droplets, Gauge } from 'lucide-react';

export function PerformanceMonitor() {
  const fps = useSimulationStore((state) => state.fps);
  const particleCount = useSimulationStore((state) => state.particleCount);
  const isPaused = useSimulationStore((state) => state.isPaused);

  const getFpsColor = (fps: number) => {
    if (fps >= 55) return 'text-green-400';
    if (fps >= 30) return 'text-yellow-400';
    return 'text-red-400';
  };

  return (
    <div className="absolute top-4 right-4 z-10">
      <div className="bg-slate-900/80 backdrop-blur-sm rounded-lg p-4 border border-slate-700/50 shadow-xl min-w-[200px]">
        <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-700/50">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span className="text-sm font-semibold text-slate-200">性能监控</span>
        </div>
        
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-400">FPS</span>
            </div>
            <span className={`text-lg font-bold ${getFpsColor(fps)}`}>
              {fps}
            </span>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Droplets className="w-4 h-4 text-slate-400" />
              <span className="text-xs text-slate-400">粒子数</span>
            </div>
            <span className="text-lg font-bold text-cyan-400">
              {particleCount} / 5000
            </span>
          </div>
          
          <div className="w-full bg-slate-700/50 rounded-full h-2">
            <div
              className="h-2 rounded-full transition-all duration-300"
              style={{
                width: `${(particleCount / 5000) * 100}%`,
                backgroundColor: particleCount > 4000 ? '#f87171' : particleCount > 2500 ? '#facc15' : '#22d3ee',
              }}
            />
          </div>
          
          <div className="flex items-center justify-between pt-2 border-t border-slate-700/50">
            <span className="text-xs text-slate-400">状态</span>
            <span className={`text-sm font-medium ${isPaused ? 'text-yellow-400' : 'text-green-400'}`}>
              {isPaused ? '⏸ 已暂停' : '▶ 运行中'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
