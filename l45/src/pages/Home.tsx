import { SimulationScene } from '@/components/SimulationScene';
import { ControlPanel } from '@/components/ControlPanel';
import { PerformanceMonitor } from '@/components/PerformanceMonitor';
import { PlaybackPanel } from '@/components/PlaybackPanel';
import { Droplets, Info } from 'lucide-react';

export default function Home() {
  return (
    <div className="relative w-full h-screen overflow-hidden bg-slate-950">
      <SimulationScene />
      <ControlPanel />
      <PerformanceMonitor />
      <PlaybackPanel />
      
      <div className="absolute top-4 left-4 z-10">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cyan-500/20 rounded-lg">
            <Droplets className="w-6 h-6 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight">
              流体腐蚀模拟器
            </h1>
            <p className="text-xs text-slate-400">
              ECS架构 · SPH流体 · 实时腐蚀 · LOD
            </p>
          </div>
        </div>
      </div>
      
      <div className="absolute top-28 left-4 z-10">
        <div className="bg-slate-900/80 backdrop-blur-sm rounded-lg p-3 border border-slate-700/50 max-w-[280px]">
          <div className="flex items-center gap-2 mb-2">
            <Info className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-medium text-slate-200">操作说明</span>
          </div>
          <ul className="text-xs text-slate-400 space-y-1">
            <li>• 左键拖动：旋转视角</li>
            <li>• 右键拖动：平移视角</li>
            <li>• 滚轮：缩放</li>
            <li>• 右上角面板：调节参数</li>
            <li>• 底部面板：录制/回放</li>
          </ul>
        </div>
      </div>
      
      <div className="absolute bottom-4 right-4 z-10">
        <div className="bg-slate-900/60 backdrop-blur-sm rounded-lg px-3 py-2 border border-slate-700/30">
          <div className="text-[10px] text-slate-500">
            Three.js + React + ECS + LOD
          </div>
        </div>
      </div>
    </div>
  );
}
