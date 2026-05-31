import { useStore } from '@/store/useStore';
import type { HeatSourceType } from '@/types';

const copperThicknessOptions = [
  { label: '0.5 oz', value: 0.5 },
  { label: '1 oz', value: 1 },
  { label: '2 oz', value: 2 },
];

const typeLabels: Record<HeatSourceType, string> = {
  resistor: 'Resistor',
  ic_chip: 'IC Chip',
  custom: 'Custom',
};

export default function RightPanel() {
  const simParams = useStore((s) => s.simParams);
  const setSimParams = useStore((s) => s.setSimParams);
  const heatSources = useStore((s) => s.heatSources);
  const selectedHeatSourceId = useStore((s) => s.selectedHeatSourceId);
  const updateHeatSource = useStore((s) => s.updateHeatSource);

  const selectedSource = heatSources.find((hs) => hs.id === selectedHeatSourceId);

  return (
    <div className="w-64 bg-[var(--bg-panel)] border-l border-[rgba(0,245,212,0.15)] flex flex-col shrink-0 overflow-y-auto">
      <div className="px-3 py-2 border-b border-[rgba(0,245,212,0.1)]">
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
          Simulation Parameters
        </span>
      </div>

      <div className="p-3 space-y-4">
        <ParamSlider
          label="Ambient Temperature"
          value={simParams.ambient_temp}
          min={0}
          max={100}
          step={1}
          unit="°C"
          onChange={(v) => setSimParams({ ambient_temp: v })}
        />

        <ParamSlider
          label="Board Thickness"
          value={simParams.board_thickness}
          min={0.4}
          max={3.2}
          step={0.1}
          unit="mm"
          onChange={(v) => setSimParams({ board_thickness: v })}
        />

        <div>
          <label className="text-xs text-[var(--text-secondary)] block mb-1">
            Copper Thickness
          </label>
          <div className="flex gap-1">
            {copperThicknessOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => setSimParams({ copper_thickness: opt.value })}
                className={`flex-1 px-2 py-1 text-xs rounded border transition-colors ${
                  simParams.copper_thickness === opt.value
                    ? 'border-[var(--accent)] bg-[rgba(0,245,212,0.1)] text-[var(--accent)]'
                    : 'border-white/10 text-[var(--text-secondary)] hover:border-[rgba(0,245,212,0.3)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <ParamSlider
          label="Convection Coefficient"
          value={simParams.convection_coeff}
          min={1}
          max={50}
          step={0.5}
          unit="W/(m²·K)"
          onChange={(v) => setSimParams({ convection_coeff: v })}
        />

        <ParamSlider
          label="Max Iterations"
          value={simParams.max_iterations}
          min={100}
          max={5000}
          step={100}
          unit=""
          onChange={(v) => setSimParams({ max_iterations: Math.round(v) })}
        />

        <ParamSlider
          label="Convergence Tolerance"
          value={simParams.convergence}
          min={0.0001}
          max={0.1}
          step={0.0001}
          unit=""
          onChange={(v) => setSimParams({ convergence: v })}
        />

        <ParamSlider
          label="Grid Resolution"
          value={simParams.grid_resolution}
          min={0.2}
          max={1.0}
          step={0.05}
          unit="mm"
          onChange={(v) => setSimParams({ grid_resolution: v })}
        />
      </div>

      {selectedSource && (
        <>
          <div className="px-3 py-2 border-t border-b border-[rgba(0,245,212,0.1)]">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
              Selected Source
            </span>
          </div>
          <div className="p-3 space-y-3">
            <div>
              <label className="text-xs text-[var(--text-secondary)] block mb-1">Type</label>
              <div className="text-sm text-[var(--text-primary)]">
                {typeLabels[selectedSource.type]}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ParamInput
                label="X"
                value={selectedSource.x}
                onChange={(v) => updateHeatSource(selectedSource.id, { x: v })}
              />
              <ParamInput
                label="Y"
                value={selectedSource.y}
                onChange={(v) => updateHeatSource(selectedSource.id, { y: v })}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <ParamInput
                label="Width"
                value={selectedSource.width}
                onChange={(v) => updateHeatSource(selectedSource.id, { width: v })}
              />
              <ParamInput
                label="Height"
                value={selectedSource.height}
                onChange={(v) => updateHeatSource(selectedSource.id, { height: v })}
              />
            </div>

            <ParamSlider
              label="Power"
              value={selectedSource.power}
              min={0.01}
              max={10}
              step={0.01}
              unit="W"
              onChange={(v) => updateHeatSource(selectedSource.id, { power: v })}
            />
          </div>
        </>
      )}
    </div>
  );
}

function ParamSlider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-xs text-[var(--text-secondary)]">{label}</label>
        <span className="text-xs text-[var(--accent)] font-mono">
          {step >= 1 ? value : value.toFixed(step < 0.01 ? 4 : 2)}
          {unit && ` ${unit}`}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="param-slider w-full"
      />
    </div>
  );
}

function ParamInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-[10px] text-[var(--text-secondary)] block mb-0.5">
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        className="w-full px-2 py-1 text-xs bg-[var(--bg-primary)] border border-white/10 rounded text-[var(--text-primary)] font-mono focus:border-[var(--accent)] focus:outline-none"
      />
    </div>
  );
}
