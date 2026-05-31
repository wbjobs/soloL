import { 
  Box, 
  Eye, 
  Layers, 
  Compass, 
  Save, 
  Upload,
  Zap,
  Settings,
  HelpCircle,
  ChevronRight
} from 'lucide-react';
import { useStore } from '../../store/useStore';

interface ToolbarButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  disabled?: boolean;
}

function ToolbarButton({ icon, label, active, onClick, disabled }: ToolbarButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col items-center justify-center px-3 py-2 rounded-lg transition-all ${
        disabled
          ? 'opacity-50 cursor-not-allowed'
          : active
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
          : 'text-gray-400 hover:bg-gray-800 hover:text-white'
      }`}
      title={label}
    >
      {icon}
      <span className="text-xs mt-1">{label}</span>
    </button>
  );
}

interface ViewButtonProps {
  view: 'perspective' | 'top' | 'front' | 'side';
  label: string;
  currentView: string;
  onClick: () => void;
}

function ViewButton({ view, label, currentView, onClick }: ViewButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded text-xs font-medium transition-all ${
        currentView === view
          ? 'bg-orange-600 text-white'
          : 'bg-gray-800 text-gray-400 hover:bg-gray-700 hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}

export function TopToolbar() {
  const {
    grid,
    gridId,
    formations,
    currentView,
    setCurrentView,
    showModel,
    showSlice,
    showTrajectories,
    setShowModel,
    setShowSlice,
    setShowTrajectories,
    addTrajectory,
    trajectories
  } = useStore();

  return (
    <div className="h-16 bg-gray-900 border-b border-gray-700 flex items-center justify-between px-4">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-3 mr-6">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Box size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-lg font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              三维地质建模系统
            </h1>
            <p className="text-xs text-gray-500">GeoModel 3D v1.0</p>
          </div>
        </div>

        <div className="h-10 w-px bg-gray-700 mx-2" />

        <div className="flex items-center gap-1">
          <ToolbarButton
            icon={<Eye size={18} />}
            label="模型"
            active={showModel}
            onClick={() => setShowModel(!showModel)}
          />
          <ToolbarButton
            icon={<Layers size={18} />}
            label="切片"
            active={showSlice}
            onClick={() => setShowSlice(!showSlice)}
          />
          <ToolbarButton
            icon={<Compass size={18} />}
            label="轨迹"
            active={showTrajectories}
            onClick={() => setShowTrajectories(!showTrajectories)}
          />
        </div>

        <div className="h-10 w-px bg-gray-700 mx-2" />

        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 mr-2">视图:</span>
          <ViewButton
            view="perspective"
            label="透视"
            currentView={currentView}
            onClick={() => setCurrentView('perspective')}
          />
          <ViewButton
            view="top"
            label="俯视"
            currentView={currentView}
            onClick={() => setCurrentView('top')}
          />
          <ViewButton
            view="front"
            label="正视"
            currentView={currentView}
            onClick={() => setCurrentView('front')}
          />
          <ViewButton
            view="side"
            label="侧视"
            currentView={currentView}
            onClick={() => setCurrentView('side')}
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        {grid && (
          <div className="flex items-center gap-4 px-4 py-2 bg-gray-800 rounded-lg mr-4">
            <div className="text-center">
              <p className="text-xs text-gray-500">网格</p>
              <p className="text-sm font-medium text-cyan-400">
                {grid.dimensions.nx}×{grid.dimensions.ny}×{grid.dimensions.nz}
              </p>
            </div>
            <div className="h-8 w-px bg-gray-700" />
            <div className="text-center">
              <p className="text-xs text-gray-500">地层</p>
              <p className="text-sm font-medium text-purple-400">
                {formations.length} 层
              </p>
            </div>
            <div className="h-8 w-px bg-gray-700" />
            <div className="text-center">
              <p className="text-xs text-gray-500">轨迹</p>
              <p className="text-sm font-medium text-orange-400">
                {trajectories.length} 条
              </p>
            </div>
          </div>
        )}

        <ToolbarButton
          icon={<Zap size={18} />}
          label="快速添加轨迹"
          onClick={() => addTrajectory()}
        />

        <div className="h-10 w-px bg-gray-700 mx-2" />

        <ToolbarButton
          icon={<Save size={18} />}
          label="保存"
          disabled={!gridId}
        />

        <ToolbarButton
          icon={<HelpCircle size={18} />}
          label="帮助"
        />

        <ToolbarButton
          icon={<Settings size={18} />}
          label="设置"
        />
      </div>
    </div>
  );
}
