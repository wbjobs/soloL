import React, { useMemo } from 'react';
import { ChunkPriority } from '../utils/priorityQueue';

export interface HeatmapChunkData {
  index: number;
  duration: number;
  size: number;
  verified?: boolean;
  priority?: ChunkPriority;
}

interface TransferHeatmapProps {
  totalChunks: number;
  completedChunks: Map<number, HeatmapChunkData>;
  showPriority?: boolean;
  showLegend?: boolean;
  onChunkClick?: (index: number) => void;
  selectedChunks?: Set<number>;
  maxDuration?: number;
}

export const TransferHeatmap: React.FC<TransferHeatmapProps> = ({
  totalChunks,
  completedChunks,
  showPriority = true,
  showLegend = true,
  onChunkClick,
  selectedChunks,
  maxDuration = 3000,
}) => {
  const stats = useMemo(() => {
    const durations = Array.from(completedChunks.values()).map((c) => c.duration);
    if (durations.length === 0) {
      return {
        avgDuration: 0,
        minDuration: 0,
        maxDuration: 0,
        avgSpeed: 0,
      };
    }
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDuration = Math.min(...durations);
    const maxDurationActual = Math.max(...durations);
    const totalSize = Array.from(completedChunks.values()).reduce((acc, c) => acc + c.size, 0);
    const totalTime = durations.reduce((a, b) => a + b, 0);
    const avgSpeed = totalTime > 0 ? (totalSize / (totalTime / 1000)) : 0;

    return {
      avgDuration,
      minDuration,
      maxDuration: maxDurationActual,
      avgSpeed,
    };
  }, [completedChunks]);

  const getHeatColor = (duration: number): string => {
    const ratio = Math.min(1, duration / maxDuration);
    const h = (1 - ratio) * 80;
    const s = 70;
    const l = 45;
    return `hsl(${h}, ${s}%, ${l}%)`;
  };

  const getPriorityColor = (priority: ChunkPriority): string => {
    switch (priority) {
      case 'urgent': return '#ef4444';
      case 'high': return '#f59e0b';
      case 'normal': return '#3b82f6';
      case 'low': return '#64748b';
      default: return '#3b82f6';
    }
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms.toFixed(0)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatSpeed = (bytesPerSecond: number): string => {
    if (bytesPerSecond === 0) return '0 B/s';
    const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.min(3, Math.floor(Math.log(bytesPerSecond) / Math.log(1024)));
    return `${(bytesPerSecond / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
  };

  return (
    <div className="transfer-heatmap">
      {showLegend && (
        <div className="heatmap-stats">
          <div className="stat-item">
            <span className="stat-label">Chunks</span>
            <span className="stat-value">
              {completedChunks.size}/{totalChunks}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Avg Time</span>
            <span className="stat-value">{formatDuration(stats.avgDuration)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Avg Speed</span>
            <span className="stat-value">{formatSpeed(stats.avgSpeed)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Range</span>
            <span className="stat-value">
              {formatDuration(stats.minDuration)} - {formatDuration(stats.maxDuration)}
            </span>
          </div>
        </div>
      )}

      <div className="heatmap-grid">
        {Array.from({ length: totalChunks }, (_, i) => {
          const chunkData = completedChunks.get(i);
          const isCompleted = chunkData !== undefined;
          const isSelected = selectedChunks?.has(i);
          const isVerified = chunkData?.verified ?? true;

          return (
            <div
              key={i}
              className={`heatmap-cell ${isCompleted ? 'completed' : 'pending'} ${
                isSelected ? 'selected' : ''
              } ${!isVerified ? 'failed' : ''}`}
              style={{
                backgroundColor: isCompleted ? getHeatColor(chunkData.duration) : undefined,
                borderLeft:
                  showPriority && chunkData?.priority
                    ? `3px solid ${getPriorityColor(chunkData.priority)}`
                    : undefined,
              }}
              onClick={() => onChunkClick?.(i)}
              title={`Chunk ${i}${
                chunkData
                  ? ` - ${formatDuration(chunkData.duration)}${
                      chunkData.priority ? ` - ${chunkData.priority}` : ''
                    }`
                  : ' - pending'
              }`}
            >
              {!isCompleted && <span className="chunk-index">{i}</span>}
            </div>
          );
        })}
      </div>

      {showLegend && (
        <div className="heatmap-legend-bar">
          <div className="legend-group">
            <span className="legend-title">Duration:</span>
            <span className="legend-label">Fast</span>
            <div className="legend-gradient" />
            <span className="legend-label">Slow</span>
          </div>
          {showPriority && (
            <div className="legend-group">
              <span className="legend-title">Priority:</span>
              <span className="legend-priority" style={{ color: getPriorityColor('urgent') }}>
                ■ Urgent
              </span>
              <span className="legend-priority" style={{ color: getPriorityColor('high') }}>
                ■ High
              </span>
              <span className="legend-priority" style={{ color: getPriorityColor('normal') }}>
                ■ Normal
              </span>
              <span className="legend-priority" style={{ color: getPriorityColor('low') }}>
                ■ Low
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
