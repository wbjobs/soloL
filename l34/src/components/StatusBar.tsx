import { Activity, Thermometer } from 'lucide-react';
import { useStore } from '@/store/useStore';

export default function StatusBar() {
  const simResult = useStore((s) => s.simResult);
  const isLoading = useStore((s) => s.isLoading);
  const canvasState = useStore((s) => s.canvasState);
  const boardData = useStore((s) => s.boardData);

  const status = isLoading
    ? 'running'
    : simResult
    ? 'complete'
    : 'idle';

  const statusColors = {
    idle: 'text-[var(--text-secondary)]',
    running: 'text-yellow-400',
    complete: 'text-[var(--accent)]',
  };

  const statusLabels = {
    idle: 'Idle',
    running: 'Simulating...',
    complete: 'Complete',
  };

  return (
    <div className="h-7 bg-[var(--bg-secondary)] border-t border-[rgba(0,245,212,0.15)] flex items-center px-3 gap-4 text-[10px] font-mono shrink-0">
      <div className="flex items-center gap-1.5">
        <Activity size={10} className={statusColors[status]} />
        <span className={statusColors[status]}>{statusLabels[status]}</span>
      </div>

      {simResult && (
        <>
          <div className="h-3 w-px bg-[rgba(0,245,212,0.15)]" />
          <div className="flex items-center gap-1.5">
            <Thermometer size={10} className="text-red-400" />
            <span className="text-[var(--text-secondary)]">
              Max: <span className="text-red-400">{simResult.max_temp.toFixed(1)}°C</span>
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <Thermometer size={10} className="text-blue-400" />
            <span className="text-[var(--text-secondary)]">
              Min: <span className="text-blue-400">{simResult.min_temp.toFixed(1)}°C</span>
            </span>
          </div>
          <div className="text-[var(--text-secondary)]">
            Avg: <span className="text-[var(--text-primary)]">{simResult.avg_temp.toFixed(1)}°C</span>
          </div>
          <div className="text-[var(--text-secondary)]">
            Iterations: <span className="text-[var(--text-primary)]">{simResult.iterations}</span>
          </div>
          <div className="text-[var(--text-secondary)]">
            Converged: <span className={simResult.converged ? 'text-[var(--accent)]' : 'text-[var(--danger)]'}>
              {simResult.converged ? 'Yes' : 'No'}
            </span>
          </div>
          <div className="text-[var(--text-secondary)]">
            Grid: <span className="text-[var(--text-primary)]">{simResult.grid_cols}×{simResult.grid_rows}</span>
          </div>
        </>
      )}

      <div className="flex-1" />

      {boardData && (
        <div className="text-[var(--text-secondary)]">
          Board: <span className="text-[var(--text-primary)]">{boardData.dimensions.width}×{boardData.dimensions.height}mm</span>
        </div>
      )}
      <div className="text-[var(--text-secondary)]">
        Zoom: <span className="text-[var(--text-primary)]">{(canvasState.zoom * 100).toFixed(0)}%</span>
      </div>
    </div>
  );
}
