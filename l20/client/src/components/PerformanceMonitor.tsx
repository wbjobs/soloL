import { PerformanceMetrics } from '../types';

interface PerformanceMonitorProps {
  metrics: PerformanceMetrics;
  className?: string;
}

export function PerformanceMonitor({ metrics, className = '' }: PerformanceMonitorProps) {
  const getFpsColor = (fps: number) => {
    if (fps >= 30) return '#4ade80';
    if (fps >= 20) return '#fbbf24';
    return '#f87171';
  };

  const getTimeColor = (time: number) => {
    if (time <= 16) return '#4ade80';
    if (time <= 33) return '#fbbf24';
    return '#f87171';
  };

  return (
    <div className={`performance-panel ${className}`}>
      <div className="perf-item">
        <span className="perf-label">FPS:</span>
        <span className="perf-value" style={{ color: getFpsColor(metrics.fps) }}>
          {metrics.fps}
        </span>
      </div>
      <div className="perf-item">
        <span className="perf-label">分割:</span>
        <span className="perf-value" style={{ color: getTimeColor(metrics.segmentationTime) }}>
          {metrics.segmentationTime.toFixed(2)}ms
        </span>
      </div>
      <div className="perf-item">
        <span className="perf-label">面部:</span>
        <span className="perf-value" style={{ color: getTimeColor(metrics.faceMeshTime) }}>
          {metrics.faceMeshTime.toFixed(2)}ms
        </span>
      </div>
      <div className="perf-item">
        <span className="perf-label">渲染:</span>
        <span className="perf-value" style={{ color: getTimeColor(metrics.renderTime) }}>
          {metrics.renderTime.toFixed(2)}ms
        </span>
      </div>
      <div className="perf-item">
        <span className="perf-label">总计:</span>
        <span className="perf-value" style={{ color: getTimeColor(metrics.segmentationTime + metrics.faceMeshTime + metrics.renderTime) }}>
          {(metrics.segmentationTime + metrics.faceMeshTime + metrics.renderTime).toFixed(2)}ms
        </span>
      </div>
    </div>
  );
}
