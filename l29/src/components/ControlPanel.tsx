import { useState } from 'react';
import { Play, Pause, RotateCcw, Settings, Droplets, Gauge, Waves, Weight, Clock, ChevronDown, ChevronUp, Box, Circle, Trash2 } from 'lucide-react';
import { SPHParams } from '@/types/sph';
import { ObstacleData, ObstacleType } from '@/engine/ObstacleManager';

interface ControlPanelProps {
  params: SPHParams;
  isRunning: boolean;
  fps: number;
  frameTime: number;
  computeTime: number;
  onToggleRunning: () => void;
  onReset: () => void;
  onParamsChange: (params: Partial<SPHParams>) => void;
  obstacles: ObstacleData[];
  selectedObstacleType: ObstacleType | null;
  selectedObstacleId: string | null;
  onAddObstacle: (type: ObstacleType) => void;
  onSelectObstacle: (id: string | null) => void;
  onDeleteObstacle: (id: string) => void;
  onClearObstacles: () => void;
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (value: number) => void;
  icon: React.ReactNode;
}

function Slider({ label, value, min, max, step, unit = '', onChange, icon }: SliderProps) {
  const percentage = ((value - min) / (max - min)) * 100;

  return (
    <div className="mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-gray-300">
          <span className="text-cyan-400">{icon}</span>
          <span className="text-sm font-medium">{label}</span>
        </div>
        <span className="text-sm font-mono text-amber-400">
          {value.toFixed(step < 1 ? 4 : 0)}{unit}
        </span>
      </div>
      <div className="relative h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="absolute left-0 top-0 h-full bg-gradient-to-r from-cyan-500 to-cyan-400 rounded-full transition-all duration-100"
          style={{ width: `${percentage}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
        />
      </div>
      <div className="flex justify-between mt-1 text-xs text-gray-500">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

export default function ControlPanel({
  params,
  isRunning,
  fps,
  frameTime,
  computeTime,
  onToggleRunning,
  onReset,
  onParamsChange,
  obstacles,
  selectedObstacleType,
  selectedObstacleId,
  onAddObstacle,
  onSelectObstacle,
  onDeleteObstacle,
  onClearObstacles,
}: ControlPanelProps) {
  const [expandedSections, setExpandedSections] = useState({
    physics: true,
    particles: true,
    obstacles: true,
    display: true,
  });

  const toggleSection = (section: 'physics' | 'particles' | 'obstacles' | 'display') => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  return (
    <div className="w-80 h-full bg-[#0d1320] bg-opacity-95 backdrop-blur-xl border-l border-gray-700/50 flex flex-col">
      <div className="p-4 border-b border-gray-700/50">
        <div className="flex items-center gap-2 mb-4">
          <Droplets className="w-6 h-6 text-cyan-400" />
          <h1 className="text-xl font-bold text-white">SPH 流体模拟</h1>
        </div>
        <p className="text-xs text-gray-400">
          {params.particleCount.toLocaleString()} 粒子 · WebGPU · Rapier3D
        </p>
      </div>

      <div className="p-4 border-b border-gray-700/50">
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onToggleRunning}
            className={`flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium transition-all duration-200 ${
              isRunning
                ? 'bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30'
                : 'bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30'
            }`}
          >
            {isRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isRunning ? '暂停' : '运行'}
          </button>
          <button
            onClick={onReset}
            className="flex items-center justify-center gap-2 py-3 px-4 rounded-lg font-medium bg-gray-700/30 text-gray-300 hover:bg-gray-700/50 border border-gray-600/30 transition-all duration-200"
          >
            <RotateCcw className="w-4 h-4" />
            重置
          </button>
        </div>
      </div>

      <div className="p-4 border-b border-gray-700/50">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/30">
            <div className="text-2xl font-bold text-cyan-400 font-mono">{fps}</div>
            <div className="text-xs text-gray-500">FPS</div>
          </div>
          <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/30">
            <div className="text-2xl font-bold text-amber-400 font-mono">{frameTime}</div>
            <div className="text-xs text-gray-500">ms/帧</div>
          </div>
          <div className="p-3 rounded-lg bg-gray-800/50 border border-gray-700/30">
            <div className="text-2xl font-bold text-green-400 font-mono">{computeTime}</div>
            <div className="text-xs text-gray-500">计算 ms</div>
          </div>
        </div>
        <div className="mt-3 text-center">
          <span className="text-xs text-gray-500">粒子数: </span>
          <span className="text-sm font-mono text-white">{params.particleCount.toLocaleString()}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <button
            onClick={() => toggleSection('obstacles')}
            className="w-full flex items-center justify-between py-2 text-white font-medium hover:text-cyan-400 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Box className="w-4 h-4" />
              <span>障碍物 ({obstacles.length})</span>
            </div>
            {expandedSections.obstacles ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
          {expandedSections.obstacles && (
            <div className="mt-2">
              <div className="mb-4">
                <div className="flex items-center gap-2 text-gray-300 mb-2">
                  <Box className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-medium">添加物体</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onAddObstacle('box')}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                      selectedObstacleType === 'box'
                        ? 'bg-orange-500/30 text-orange-400 border border-orange-500/30'
                        : 'bg-gray-700/30 text-gray-400 hover:bg-gray-700/50 border border-gray-600/30'
                    }`}
                  >
                    <Box className="w-4 h-4" />
                    立方体
                  </button>
                  <button
                    onClick={() => onAddObstacle('sphere')}
                    className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-all duration-200 ${
                      selectedObstacleType === 'sphere'
                        ? 'bg-green-500/30 text-green-400 border border-green-500/30'
                        : 'bg-gray-700/30 text-gray-400 hover:bg-gray-700/50 border border-gray-600/30'
                    }`}
                  >
                    <Circle className="w-4 h-4" />
                    球体
                  </button>
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  选择类型后，按住 <span className="text-amber-400">Shift + 点击</span> 视口放置
                </p>
              </div>

              {obstacles.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-300">物体列表</span>
                    <button
                      onClick={onClearObstacles}
                      className="text-xs text-red-400 hover:text-red-300 transition-colors"
                    >
                      清空全部
                    </button>
                  </div>
                  <div className="space-y-2 max-h-40 overflow-y-auto">
                    {obstacles.map((obs) => (
                      <div
                        key={obs.id}
                        onClick={() => onSelectObstacle(obs.id)}
                        className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all duration-200 ${
                          selectedObstacleId === obs.id
                            ? 'bg-yellow-500/20 border border-yellow-500/40'
                            : 'bg-gray-700/20 hover:bg-gray-700/40 border border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {obs.type === 'box' ? (
                            <Box className="w-4 h-4 text-orange-400" />
                          ) : (
                            <Circle className="w-4 h-4 text-green-400" />
                          )}
                          <span className="text-xs text-gray-300">
                            {obs.type === 'box' ? '立方体' : '球体'}
                          </span>
                          <span className="text-xs text-gray-500">
                            ({obs.position.x.toFixed(1)}, {obs.position.y.toFixed(1)})
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteObstacle(obs.id);
                          }}
                          className="p-1 text-gray-500 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-gray-500 space-y-1 bg-gray-800/30 p-3 rounded-lg">
                <p className="text-cyan-400 font-medium mb-1">操作说明</p>
                <p>• 选择物体类型后按住 Shift + 点击放置</p>
                <p>• 点击已放置物体选中，按 Delete 删除</p>
                <p>• 物体会受到流体作用力并推动流体</p>
                <p>• 勾选"静态"可固定物体位置</p>
              </div>
            </div>
          )}
        </div>

        <div className="px-4">
          <div className="border-t border-gray-700/30" />
        </div>

        <div className="p-4">
          <button
            onClick={() => toggleSection('physics')}
            className="w-full flex items-center justify-between py-2 text-white font-medium hover:text-cyan-400 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Gauge className="w-4 h-4" />
              <span>物理参数</span>
            </div>
            {expandedSections.physics ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
          {expandedSections.physics && (
            <div className="mt-2">
              <Slider
                label="静止密度"
                value={params.restDensity}
                min={100}
                max={5000}
                step={50}
                unit="kg/m³"
                onChange={(v) => onParamsChange({ restDensity: v })}
                icon={<Weight className="w-4 h-4" />}
              />
              <Slider
                label="刚度系数"
                value={params.stiffness}
                min={10}
                max={5000}
                step={10}
                onChange={(v) => onParamsChange({ stiffness: v })}
                icon={<Gauge className="w-4 h-4" />}
              />
              <Slider
                label="粘度系数"
                value={params.viscosity}
                min={0}
                max={2000}
                step={10}
                onChange={(v) => onParamsChange({ viscosity: v })}
                icon={<Waves className="w-4 h-4" />}
              />
              <Slider
                label="重力"
                value={params.gravity}
                min={-20}
                max={0}
                step={0.1}
                unit="m/s²"
                onChange={(v) => onParamsChange({ gravity: v })}
                icon={<Weight className="w-4 h-4" />}
              />
              <Slider
                label="时间步长"
                value={params.timeStep}
                min={0.0001}
                max={0.01}
                step={0.0001}
                unit="s"
                onChange={(v) => onParamsChange({ timeStep: v })}
                icon={<Clock className="w-4 h-4" />}
              />
              <Slider
                label="边界阻尼"
                value={params.damping}
                min={0}
                max={1}
                step={0.01}
                onChange={(v) => onParamsChange({ damping: v })}
                icon={<Settings className="w-4 h-4" />}
              />
            </div>
          )}
        </div>

        <div className="px-4">
          <div className="border-t border-gray-700/30" />
        </div>

        <div className="p-4">
          <button
            onClick={() => toggleSection('particles')}
            className="w-full flex items-center justify-between py-2 text-white font-medium hover:text-cyan-400 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Droplets className="w-4 h-4" />
              <span>粒子设置</span>
            </div>
            {expandedSections.particles ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
          {expandedSections.particles && (
            <div className="mt-2">
              <div className="mb-4">
                <div className="flex items-center gap-2 text-gray-300 mb-2">
                  <Droplets className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-medium">粒子数量</span>
                </div>
                <div className="grid grid-cols-4 gap-2">
                  {[
                    { value: 50000, label: '5万' },
                    { value: 100000, label: '10万' },
                    { value: 250000, label: '25万' },
                    { value: 500000, label: '50万' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onParamsChange({ particleCount: opt.value })}
                      className={`py-2 px-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                        params.particleCount === opt.value
                          ? 'bg-cyan-500/30 text-cyan-400 border border-cyan-500/30'
                          : 'bg-gray-700/30 text-gray-400 hover:bg-gray-700/50 border border-gray-600/30'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-amber-500/80 mt-2">
                  ⚠️ 更改粒子数量需要刷新页面
                </p>
              </div>
              <Slider
                label="光滑半径"
                value={params.smoothingRadius}
                min={0.05}
                max={0.5}
                step={0.01}
                unit="m"
                onChange={(v) => onParamsChange({ smoothingRadius: v })}
                icon={<Droplets className="w-4 h-4" />}
              />
              <Slider
                label="粒子半径"
                value={params.particleRadius}
                min={0.005}
                max={0.1}
                step={0.001}
                unit="m"
                onChange={(v) => onParamsChange({ particleRadius: v })}
                icon={<Droplets className="w-4 h-4" />}
              />
              <Slider
                label="边界大小"
                value={params.boundarySize}
                min={0.5}
                max={5}
                step={0.1}
                unit="m"
                onChange={(v) => onParamsChange({ boundarySize: v })}
                icon={<Settings className="w-4 h-4" />}
              />
            </div>
          )}
        </div>

        <div className="px-4">
          <div className="border-t border-gray-700/30" />
        </div>

        <div className="p-4">
          <button
            onClick={() => toggleSection('display')}
            className="w-full flex items-center justify-between py-2 text-white font-medium hover:text-cyan-400 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span>显示设置</span>
            </div>
            {expandedSections.display ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
          {expandedSections.display && (
            <div className="mt-2">
              <div className="mb-4">
                <div className="flex items-center gap-2 text-gray-300 mb-2">
                  <Droplets className="w-4 h-4 text-cyan-400" />
                  <span className="text-sm font-medium">颜色映射模式</span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'velocity', label: '速度' },
                    { value: 'density', label: '密度' },
                    { value: 'pressure', label: '压力' },
                  ].map((mode) => (
                    <button
                      key={mode.value}
                      onClick={() =>
                        onParamsChange({ colorMode: mode.value as SPHParams['colorMode'] })
                      }
                      className={`py-2 px-3 rounded-lg text-xs font-medium transition-all duration-200 ${
                        params.colorMode === mode.value
                          ? 'bg-cyan-500/30 text-cyan-400 border border-cyan-500/30'
                          : 'bg-gray-700/30 text-gray-400 hover:bg-gray-700/50 border border-gray-600/30'
                      }`}
                    >
                      {mode.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-300">
                  <span className="text-cyan-400">✨</span>
                  <span className="text-sm font-medium">辉光效果</span>
                </div>
                <button
                  onClick={() => onParamsChange({ bloomEnabled: !params.bloomEnabled })}
                  className={`w-12 h-6 rounded-full transition-all duration-200 ${
                    params.bloomEnabled ? 'bg-cyan-500' : 'bg-gray-600'
                  }`}
                >
                  <div
                    className={`w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                      params.bloomEnabled ? 'translate-x-6' : 'translate-x-0.5'
                    }`}
                  />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-gray-700/50">
        <div className="text-xs text-gray-500 text-center">
          <p>鼠标拖拽旋转视图 · 滚轮缩放 · 右键平移</p>
          <p className="mt-1">Shift+点击放置物体 · Delete删除</p>
        </div>
      </div>
    </div>
  );
}
