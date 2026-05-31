import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from '@/components/common/Button';
import BrushToolbar from '@/components/toolbar/BrushToolbar';
import LabelSelector from '@/components/toolbar/LabelSelector';
import LabelLegend from '@/components/sidebar/LabelLegend';
import AnnotationStats from '@/components/sidebar/AnnotationStats';
import HistoryPanel from '@/components/sidebar/HistoryPanel';
import PointCloudViewer from '@/components/viewer/PointCloudViewer';
import { usePointCloudStore } from '@/store/usePointCloudStore';

export default function AnnotationPage() {
  const { pointCloudId } = useParams<{ pointCloudId: string }>();
  const navigate = useNavigate();
  const { currentPointCloud } = usePointCloudStore();

  const projectName = currentPointCloud?.name || `点云 ${pointCloudId}`;

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden">
      <div className="h-12 bg-surface border-b border-surface-border flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <Button
            variant="icon"
            size="sm"
            onClick={() => navigate('/projects')}
            title="返回项目列表"
          >
            <ArrowLeft size={16} />
          </Button>
          <div className="h-5 w-px bg-surface-border" />
          <div>
            <h2 className="text-sm font-semibold text-white truncate">{projectName}</h2>
            {currentPointCloud && (
              <p className="text-xs text-gray-400 font-mono">
                {currentPointCloud.totalPoints.toLocaleString()} 点
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-xs text-gray-400 bg-background-dark px-3 py-1.5 rounded-md">
            <Info size={14} className="text-primary" />
            <span>鼠标左键: 标注 | 右键拖动: 旋转 | 滚轮: 缩放</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden">
        <div className="w-64 bg-surface/50 border-r border-surface-border flex flex-col gap-3 p-3 overflow-y-auto shrink-0">
          <BrushToolbar />
          <LabelSelector />
        </div>

        <div className="flex-1 relative overflow-hidden">
          {pointCloudId && <PointCloudViewer pointCloudId={pointCloudId} />}
        </div>

        <div className="w-72 bg-surface/50 border-l border-surface-border flex flex-col gap-3 p-3 overflow-hidden shrink-0">
          <LabelLegend />
          <AnnotationStats className="flex-shrink-0" />
          <HistoryPanel className="flex-1 min-h-0" />
        </div>
      </div>
    </div>
  );
}
