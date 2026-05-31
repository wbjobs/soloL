import Toolbar from '@/components/Toolbar';
import LeftPanel from '@/components/LeftPanel';
import PCBCanvas from '@/components/PCBCanvas';
import RightPanel from '@/components/RightPanel';
import StatusBar from '@/components/StatusBar';
import HeatmapLegend from '@/components/HeatmapLegend';

export default function Home() {
  return (
    <div className="h-screen flex flex-col bg-[var(--bg-primary)] overflow-hidden">
      <Toolbar />
      <div className="flex flex-1 min-h-0">
        <LeftPanel />
        <div className="relative flex-1">
          <PCBCanvas />
          <HeatmapLegend />
        </div>
        <RightPanel />
      </div>
      <StatusBar />
    </div>
  );
}
