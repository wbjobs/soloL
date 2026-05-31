import { Zap, Cpu, BoxSelect, Trash2, Plus } from 'lucide-react';
import { useStore } from '@/store/useStore';
import type { HeatSourceType } from '@/types';

const typeIcons: Record<HeatSourceType, React.ReactNode> = {
  resistor: <Zap size={14} />,
  ic_chip: <Cpu size={14} />,
  custom: <BoxSelect size={14} />,
};

const typeColors: Record<HeatSourceType, string> = {
  resistor: '#FF6B6B',
  ic_chip: '#4ECDC4',
  custom: '#FFE66D',
};

const typeLabels: Record<HeatSourceType, string> = {
  resistor: 'Resistor',
  ic_chip: 'IC Chip',
  custom: 'Custom',
};

export default function LeftPanel() {
  const heatSources = useStore((s) => s.heatSources);
  const selectedHeatSourceId = useStore((s) => s.selectedHeatSourceId);
  const removeHeatSource = useStore((s) => s.removeHeatSource);
  const setSelectedHeatSourceId = useStore((s) => s.setSelectedHeatSourceId);
  const setSelectedTool = useStore((s) => s.setSelectedTool);

  return (
    <div className="w-56 bg-[var(--bg-panel)] border-r border-[rgba(0,245,212,0.15)] flex flex-col shrink-0">
      <div className="px-3 py-2 border-b border-[rgba(0,245,212,0.1)] flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Heat Sources
        </span>
        <button
          onClick={() => setSelectedTool('resistor')}
          className="p-1 rounded hover:bg-[rgba(0,245,212,0.1)] text-[var(--accent)] transition-colors"
          title="Add heat source"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {heatSources.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-[var(--text-secondary)] opacity-50">
            No heat sources placed.
            <br />
            Select a tool and click on the board.
          </div>
        ) : (
          <div className="py-1">
            {heatSources.map((hs, idx) => {
              const isSelected = hs.id === selectedHeatSourceId;
              const color = typeColors[hs.type];
              return (
                <div
                  key={hs.id}
                  onClick={() => setSelectedHeatSourceId(hs.id)}
                  className={`flex items-center gap-2 px-3 py-2 cursor-pointer transition-colors group ${
                    isSelected
                      ? 'bg-[rgba(0,245,212,0.1)] border-l-2'
                      : 'hover:bg-white/5 border-l-2 border-l-transparent'
                  }`}
                  style={isSelected ? { borderLeftColor: color } : undefined}
                >
                  <span style={{ color }}>{typeIcons[hs.type]}</span>
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[var(--text-primary)] truncate">
                      {typeLabels[hs.type]} #{idx + 1}
                    </div>
                    <div className="text-[10px] text-[var(--text-secondary)] font-mono">
                      {hs.power}W @ ({hs.x.toFixed(0)}, {hs.y.toFixed(0)})
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      removeHeatSource(hs.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[rgba(255,71,87,0.2)] text-[var(--danger)] transition-all"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {heatSources.length > 0 && (
        <div className="px-3 py-2 border-t border-[rgba(0,245,212,0.1)] text-[10px] text-[var(--text-secondary)] font-mono">
          Total: {heatSources.reduce((sum, hs) => sum + hs.power, 0).toFixed(2)}W
        </div>
      )}
    </div>
  );
}
