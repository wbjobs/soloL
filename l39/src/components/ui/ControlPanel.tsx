import { useState, useCallback } from 'react';
import { 
  Upload, 
  Play, 
  Database, 
  Eye, 
  EyeOff, 
  Layers, 
  Settings,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  RotateCcw,
  Zap,
  Navigation,
  Sliders,
  Droplets,
  BarChart3,
  Users
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { segyAPI, gridAPI } from '../../utils/api';
import { KrigingParams } from '../../../shared/types';
import { FlowSimulationPanel } from './FlowSimulationPanel';
import { MonteCarloPanel } from './MonteCarloPanel';
import { CollaborationPanel } from './CollaborationPanel';

interface PanelSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function PanelSection({ title, icon, children, defaultOpen = true }: PanelSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-gray-200">{title}</span>
        </div>
        {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

export function ControlPanel() {
  const {
    grid,
    gridId,
    trajectories,
    selectedTrajectoryId,
    sliceParams,
    showSlice,
    showModel,
    showTrajectories,
    showWireframe,
    opacity,
    controlPoints,
    controlValues,
    segyFileId,
    isGeneratingMock,
    isLoadingGrid,
    krigingProgress,
    usePotree,
    showGeosteering,
    lodThreshold,
    maxVisiblePoints,
    pointSize,
    setGrid,
    setGridId,
    setFormations,
    setControlPoints,
    setSegyFileId,
    setShowSlice,
    setShowModel,
    setShowTrajectories,
    setShowWireframe,
    setOpacity,
    setSliceParams,
    addTrajectory,
    removeTrajectory,
    selectTrajectory,
    setIsGeneratingMock,
    setIsLoadingGrid,
    setKrigingProgress,
    setUsePotree,
    setShowGeosteering,
    setLodThreshold,
    setMaxVisiblePoints,
    setPointSize
  } = useStore();

  const [krigingParams, setKrigingParams] = useState<KrigingParams>({
    model: 'spherical',
    range: 200,
    sill: 1.0,
    nugget: 0.01,
    searchRadius: 150,
    maxNeighbors: 12,
    useIndicatorKriging: true,
    indicatorThreshold: 0.5,
    localRangeAdjustment: true
  });

  const handleGenerateMockData = useCallback(async () => {
    setIsGeneratingMock(true);
    try {
      const result = await segyAPI.generateMock();
      setControlPoints(result.controlPoints, result.values);
      setSegyFileId(result.fileId);
    } catch (error) {
      console.error('Failed to generate mock data:', error);
    } finally {
      setIsGeneratingMock(false);
    }
  }, [setControlPoints, setSegyFileId, setIsGeneratingMock]);

  const handleGenerateMockGrid = useCallback(async () => {
    setIsLoadingGrid(true);
    try {
      const result = await gridAPI.generateMock();
      
      let progress = 0;
      const checkProgress = async () => {
        while (progress < 100) {
          const status = await gridAPI.getProgress(result.gridId);
          progress = status.progress;
          setKrigingProgress(status);
          
          if (status.status === 'completed' || status.status === 'error') {
            break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      };
      
      await checkProgress();
      
      if (result.gridId) {
        const gridData = await gridAPI.get(result.gridId);
        const formationsData = await gridAPI.getFormations();
        setGrid(gridData);
        setGridId(result.gridId);
        setFormations(formationsData);
      }
    } catch (error) {
      console.error('Failed to generate mock grid:', error);
    } finally {
      setIsLoadingGrid(false);
      setKrigingProgress(null);
    }
  }, [setGrid, setGridId, setFormations, setIsLoadingGrid, setKrigingProgress]);

  const handleStartKriging = useCallback(async () => {
    if (controlPoints.length === 0) {
      alert('请先加载SEGY数据或生成模拟数据');
      return;
    }

    setIsLoadingGrid(true);
    try {
      const result = await gridAPI.startKriging(
        controlPoints,
        controlValues,
        krigingParams,
        { nx: 200, ny: 200, nz: 100 }
      );

      let progress = 0;
      const checkProgress = async () => {
        while (progress < 100) {
          const status = await gridAPI.getProgress(result.gridId);
          progress = status.progress;
          setKrigingProgress(status);
          
          if (status.status === 'completed' || status.status === 'error') {
            break;
          }
          
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      };

      await checkProgress();

      const gridData = await gridAPI.get(result.gridId);
      const formationsData = await gridAPI.getFormations();
      setGrid(gridData);
      setGridId(result.gridId);
      setFormations(formationsData);
    } catch (error) {
      console.error('Failed to start kriging:', error);
    } finally {
      setIsLoadingGrid(false);
      setKrigingProgress(null);
    }
  }, [controlPoints, controlValues, krigingParams, setGrid, setGridId, setFormations, setIsLoadingGrid, setKrigingProgress]);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await segyAPI.upload(file);
      const data = await segyAPI.get(result.fileId);
      setControlPoints(data.controlPoints, data.values);
      setSegyFileId(result.fileId);
    } catch (error) {
      console.error('Failed to upload file:', error);
    }
  }, [setControlPoints, setSegyFileId]);

  return (
    <div className="w-72 bg-gray-900 text-white overflow-y-auto border-r border-gray-700">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
          控制面板
        </h2>
      </div>

      <PanelSection title="数据管理" icon={<Database size={18} className="text-blue-400" />}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-2">上传SEGY文件</label>
            <label className="flex items-center justify-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded cursor-pointer transition-colors">
              <Upload size={16} />
              <span className="text-sm">选择文件</span>
              <input
                type="file"
                accept=".segy,.sgy"
                onChange={handleFileUpload}
                className="hidden"
              />
            </label>
          </div>

          <button
            onClick={handleGenerateMockData}
            disabled={isGeneratingMock}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 rounded transition-colors"
          >
            <Zap size={16} />
            <span className="text-sm">
              {isGeneratingMock ? '生成中...' : '生成模拟数据'}
            </span>
          </button>

          {segyFileId && (
            <div className="p-3 bg-gray-800 rounded">
              <p className="text-xs text-gray-400">数据已加载</p>
              <p className="text-sm text-green-400">控制点: {controlPoints.length}</p>
            </div>
          )}

          <div className="pt-2 border-t border-gray-700">
            <button
              onClick={handleGenerateMockGrid}
              disabled={isLoadingGrid}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 rounded transition-colors"
            >
              <Play size={16} />
              <span className="text-sm">
                {isLoadingGrid ? '加载中...' : '快速加载示例模型'}
              </span>
            </button>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="克里金插值" icon={<Settings size={18} className="text-orange-400" />}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">变差函数模型</label>
            <select
              value={krigingParams.model}
              onChange={(e) => setKrigingParams(p => ({ ...p, model: e.target.value as any }))}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm"
            >
              <option value="spherical">球状模型</option>
              <option value="exponential">指数模型</option>
              <option value="gaussian">高斯模型</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">变程: {krigingParams.range}</label>
            <input
              type="range"
              min="50"
              max="500"
              value={krigingParams.range}
              onChange={(e) => setKrigingParams(p => ({ ...p, range: Number(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">搜索半径: {krigingParams.searchRadius}</label>
            <input
              type="range"
              min="50"
              max="300"
              value={krigingParams.searchRadius}
              onChange={(e) => setKrigingParams(p => ({ ...p, searchRadius: Number(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">最大邻点数: {krigingParams.maxNeighbors}</label>
            <input
              type="range"
              min="4"
              max="24"
              value={krigingParams.maxNeighbors}
              onChange={(e) => setKrigingParams(p => ({ ...p, maxNeighbors: Number(e.target.value) }))}
              className="w-full"
            />
          </div>

          <div className="pt-2 border-t border-gray-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">指示克里金修正</span>
              <button
                onClick={() => setKrigingParams(p => ({ ...p, useIndicatorKriging: !p.useIndicatorKriging }))}
                className={`w-10 h-5 rounded-full transition-colors ${krigingParams.useIndicatorKriging ? 'bg-green-600' : 'bg-gray-600'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${krigingParams.useIndicatorKriging ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>
            
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">局部变程调整</span>
              <button
                onClick={() => setKrigingParams(p => ({ ...p, localRangeAdjustment: !p.localRangeAdjustment }))}
                className={`w-10 h-5 rounded-full transition-colors ${krigingParams.localRangeAdjustment ? 'bg-green-600' : 'bg-gray-600'}`}
              >
                <div className={`w-4 h-4 bg-white rounded-full transition-transform ${krigingParams.localRangeAdjustment ? 'translate-x-5' : 'translate-x-0.5'}`} />
              </button>
            </div>

            {krigingParams.useIndicatorKriging && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">指示阈值: {krigingParams.indicatorThreshold}</label>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={krigingParams.indicatorThreshold}
                  onChange={(e) => setKrigingParams(p => ({ ...p, indicatorThreshold: Number(e.target.value) }))}
                  className="w-full"
                />
              </div>
            )}
          </div>

          {krigingProgress && (
            <div className="p-3 bg-gray-800 rounded">
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-400">计算进度</span>
                <span className="text-orange-400">{krigingProgress.progress.toFixed(1)}%</span>
              </div>
              <div className="h-2 bg-gray-700 rounded overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-orange-500 to-yellow-500 transition-all"
                  style={{ width: `${krigingProgress.progress}%` }}
                />
              </div>
            </div>
          )}

          <button
            onClick={handleStartKriging}
            disabled={isLoadingGrid || controlPoints.length === 0}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 rounded transition-colors"
          >
            <Play size={16} />
            <span className="text-sm">
              {isLoadingGrid ? '计算中...' : '开始插值计算'}
            </span>
          </button>
        </div>
      </PanelSection>

      <PanelSection title="高级渲染" icon={<Sliders size={18} className="text-purple-400" />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">使用Potree LOD</span>
            <button
              onClick={() => setUsePotree(!usePotree)}
              className={`w-10 h-5 rounded-full transition-colors ${usePotree ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform ${usePotree ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>

          {usePotree && (
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">LOD阈值: {lodThreshold}px</label>
                <input
                  type="range"
                  min="10"
                  max="200"
                  value={lodThreshold}
                  onChange={(e) => setLodThreshold(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">最大可见点: {Math.round(maxVisiblePoints / 1000)}k</label>
                <input
                  type="range"
                  min="50000"
                  max="1000000"
                  step="50000"
                  value={maxVisiblePoints}
                  onChange={(e) => setMaxVisiblePoints(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">点大小: {pointSize}</label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={pointSize}
                  onChange={(e) => setPointSize(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </>
          )}
        </div>
      </PanelSection>

      <PanelSection title="地质导向" icon={<Navigation size={18} className="text-green-400" />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">显示地质导向</span>
            <button
              onClick={() => setShowGeosteering(!showGeosteering)}
              className={`w-10 h-5 rounded-full transition-colors ${showGeosteering ? 'bg-green-600' : 'bg-gray-600'}`}
            >
              <div className={`w-4 h-4 bg-white rounded-full transition-transform ${showGeosteering ? 'translate-x-5' : 'translate-x-0.5'}`} />
            </button>
          </div>
          {showGeosteering && (
            <div className="text-xs text-gray-400 p-2 bg-gray-800 rounded">
              选择钻井轨迹后，沿轨迹显示实时地质导向信息
            </div>
          )}
        </div>
      </PanelSection>

      {gridId && (
        <>
          <FlowSimulationPanel 
            isOpen={true} 
            onToggle={() => {}} 
          />
          <MonteCarloPanel 
            isOpen={true} 
            onToggle={() => {}} 
          />
          <CollaborationPanel 
            isOpen={true} 
            onToggle={() => {}} 
          />
        </>
      )}

      <PanelSection title="显示控制" icon={<Eye size={18} className="text-cyan-400" />}>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">显示地质模型</span>
            <button
              onClick={() => setShowModel(!showModel)}
              className={`p-2 rounded transition-colors ${showModel ? 'bg-cyan-600' : 'bg-gray-700'}`}
            >
              {showModel ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">显示切片</span>
            <button
              onClick={() => setShowSlice(!showSlice)}
              className={`p-2 rounded transition-colors ${showSlice ? 'bg-cyan-600' : 'bg-gray-700'}`}
            >
              {showSlice ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">显示钻井轨迹</span>
            <button
              onClick={() => setShowTrajectories(!showTrajectories)}
              className={`p-2 rounded transition-colors ${showTrajectories ? 'bg-cyan-600' : 'bg-gray-700'}`}
            >
              {showTrajectories ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-300">显示线框</span>
            <button
              onClick={() => setShowWireframe(!showWireframe)}
              className={`p-2 rounded transition-colors ${showWireframe ? 'bg-cyan-600' : 'bg-gray-700'}`}
            >
              {showWireframe ? <Eye size={16} /> : <EyeOff size={16} />}
            </button>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">模型透明度: {(opacity * 100).toFixed(0)}%</label>
            <input
              type="range"
              min="0.1"
              max="1"
              step="0.05"
              value={opacity}
              onChange={(e) => setOpacity(Number(e.target.value))}
              className="w-full"
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="切片控制" icon={<Layers size={18} className="text-pink-400" />}>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-400 mb-1">切片法向 X</label>
            <input
              type="number"
              step="0.1"
              value={sliceParams.normal.x}
              onChange={(e) => setSliceParams({ normal: { ...sliceParams.normal, x: Number(e.target.value) } })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">切片法向 Y</label>
            <input
              type="number"
              step="0.1"
              value={sliceParams.normal.y}
              onChange={(e) => setSliceParams({ normal: { ...sliceParams.normal, y: Number(e.target.value) } })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">切片法向 Z</label>
            <input
              type="number"
              step="0.1"
              value={sliceParams.normal.z}
              onChange={(e) => setSliceParams({ normal: { ...sliceParams.normal, z: Number(e.target.value) } })}
              className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm"
            />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">切片深度 Z: {sliceParams.origin.z}</label>
            <input
              type="range"
              min="0"
              max="100"
              value={sliceParams.origin.z}
              onChange={(e) => setSliceParams({ origin: { ...sliceParams.origin, z: Number(e.target.value) } })}
              className="w-full"
            />
          </div>
        </div>
      </PanelSection>

      <PanelSection title="钻井轨迹" icon={<RotateCcw size={18} className="text-orange-400" />}>
        <div className="space-y-3">
          <button
            onClick={() => addTrajectory()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 rounded transition-colors"
          >
            <Plus size={16} />
            <span className="text-sm">添加轨迹</span>
          </button>

          {trajectories.map((trajectory) => (
            <div
              key={trajectory.id}
              className={`p-3 rounded cursor-pointer transition-colors ${
                selectedTrajectoryId === trajectory.id
                  ? 'bg-orange-900 border border-orange-500'
                  : 'bg-gray-800 hover:bg-gray-700'
              }`}
              onClick={() => selectTrajectory(trajectory.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: trajectory.color }}
                  />
                  <span className="text-sm">{trajectory.name}</span>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeTrajectory(trajectory.id);
                  }}
                  className="p-1 hover:bg-red-600 rounded transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {trajectory.segments.length} 段贝塞尔曲线
              </p>
            </div>
          ))}
        </div>
      </PanelSection>

      {grid && (
        <div className="p-4 border-t border-gray-700">
          <div className="text-xs text-gray-400 space-y-1">
            <p>网格尺寸: {grid.dimensions.nx} × {grid.dimensions.ny} × {grid.dimensions.nz}</p>
            <p>体素数量: {(grid.dimensions.nx * grid.dimensions.ny * grid.dimensions.nz).toLocaleString()}</p>
            <p>网格间距: {grid.spacing.x.toFixed(1)} × {grid.spacing.y.toFixed(1)} × {grid.spacing.z.toFixed(1)}</p>
          </div>
        </div>
      )}
    </div>
  );
}
