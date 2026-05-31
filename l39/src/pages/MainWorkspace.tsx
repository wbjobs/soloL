import { Scene3D } from '../components/three/Scene3D';
import { ControlPanel } from '../components/ui/ControlPanel';
import { PropertiesPanel } from '../components/ui/PropertiesPanel';
import { TopToolbar } from '../components/ui/TopToolbar';
import { GeosteeringPanel } from '../components/ui/GeosteeringPanel';
import { useStore } from '../store/useStore';

export function MainWorkspace() {
  const { gridId, showGeosteering, currentTrajectoryPoint } = useStore();

  return (
    <div className="h-screen w-screen flex flex-col bg-gray-950 overflow-hidden">
      <TopToolbar />
      
      <div className="flex-1 flex overflow-hidden">
        <ControlPanel />
        
        <main className="flex-1 relative">
          <Scene3D className="w-full h-full" />
          
          <GeosteeringPanel
            gridId={gridId || ''}
            currentPoint={currentTrajectoryPoint}
            isVisible={showGeosteering}
          />
          
          <div className="absolute bottom-4 left-4 bg-gray-900/90 backdrop-blur-sm rounded-lg px-4 py-2 border border-gray-700">
            <div className="text-xs text-gray-400 space-y-1">
              <p>鼠标左键: 旋转视角</p>
              <p>鼠标右键: 平移视角</p>
              <p>鼠标滚轮: 缩放</p>
            </div>
          </div>
        </main>
        
        <PropertiesPanel />
      </div>
    </div>
  );
}
