import { cn } from '@/lib/utils';
import { usePointCloudStore } from '@/store/usePointCloudStore';

interface LoadingOverlayProps {
  className?: string;
}

export default function LoadingOverlay({ className }: LoadingOverlayProps) {
  const { isLoading, loadingProgress } = usePointCloudStore();

  if (!isLoading) return null;

  return (
    <div
      className={cn(
        'absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/90 backdrop-blur-sm',
        className
      )}
    >
      <div className="flex flex-col items-center gap-6 max-w-sm w-full px-8">
        <div className="relative">
          <div className="w-16 h-16 border-4 border-surface-border rounded-full" />
          <div className="absolute inset-0 w-16 h-16 border-4 border-transparent border-t-primary rounded-full animate-spin" />
        </div>

        <div className="text-center space-y-2">
          <h3 className="text-lg font-semibold text-white">加载点云数据</h3>
          <p className="text-sm text-gray-400">正在处理三维模型，请稍候...</p>
        </div>

        <div className="w-full space-y-2">
          <div className="h-2 bg-surface-dark rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary to-primary-hover transition-all duration-300 ease-out"
              style={{ width: `${loadingProgress}%` }}
            />
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-400">加载进度</span>
            <span className="text-primary font-mono">{loadingProgress.toFixed(0)}%</span>
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-gray-500">
          <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
          <span>正在解析点云坐标和颜色信息</span>
        </div>
      </div>
    </div>
  );
}
