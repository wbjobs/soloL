import { useRef } from 'react';
import {
  Upload,
  LayoutTemplate,
  MousePointer2,
  Zap,
  Cpu,
  BoxSelect,
  Play,
  RotateCcw,
  Download,
  Layers,
  Activity,
} from 'lucide-react';
import { useStore } from '@/store/useStore';
import { exportVTK, parseGerber, simulate, loadDemoBoard } from '@/utils/api';
import type { FieldType } from '@/types';

type ToolType = 'select' | 'resistor' | 'ic_chip' | 'custom';

interface ToolButton {
  type: ToolType;
  icon: React.ReactNode;
  label: string;
}

const tools: ToolButton[] = [
  { type: 'select', icon: <MousePointer2 size={16} />, label: 'Select' },
  { type: 'resistor', icon: <Zap size={16} />, label: 'Resistor' },
  { type: 'ic_chip', icon: <Cpu size={16} />, label: 'IC Chip' },
  { type: 'custom', icon: <BoxSelect size={16} />, label: 'Custom' },
];

const fieldTypes: { type: FieldType; label: string }[] = [
  { type: 'temperature', label: 'Temperature' },
  { type: 'current_density', label: 'Current Density' },
  { type: 'heat_flow_x', label: 'Heat Flow X' },
  { type: 'heat_flow_y', label: 'Heat Flow Y' },
];

export default function Toolbar() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedTool = useStore((s) => s.selectedTool);
  const setSelectedTool = useStore((s) => s.setSelectedTool);
  const boardData = useStore((s) => s.boardData);
  const setBoardData = useStore((s) => s.setBoardData);
  const heatSources = useStore((s) => s.heatSources);
  const currentSources = useStore((s) => s.currentSources);
  const simParams = useStore((s) => s.simParams);
  const simResult = useStore((s) => s.simResult);
  const setSimResult = useStore((s) => s.setSimResult);
  const isLoading = useStore((s) => s.isLoading);
  const setIsLoading = useStore((s) => s.setIsLoading);
  const resetSimulation = useStore((s) => s.resetSimulation);
  const selectedLayer = useStore((s) => s.selectedLayer);
  const setSelectedLayer = useStore((s) => s.setSelectedLayer);
  const fieldType = useStore((s) => s.fieldType);
  const setFieldType = useStore((s) => s.setFieldType);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsLoading(true);
    try {
      const data = await parseGerber(file);
      setBoardData(data);
    } catch (err) {
      console.error('Failed to parse Gerber:', err);
      alert('Failed to parse Gerber file. Please check the file format.');
    } finally {
      setIsLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleLoadDemo = async () => {
    setIsLoading(true);
    try {
      const data = await loadDemoBoard();
      setBoardData(data);
    } catch (err) {
      console.error('Failed to load demo board:', err);
      alert('Failed to load demo board. Is the backend server running?');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRunSimulation = async () => {
    if (!boardData) return;
    setIsLoading(true);
    try {
      const result = await simulate(boardData.board_id, heatSources, currentSources, simParams);
      setSimResult(result);
    } catch (err) {
      console.error('Simulation failed:', err);
      alert('Simulation failed. Please check parameters and try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleExportVTK = async () => {
    if (!boardData || !simResult) return;
    try {
      const vtkContent = await exportVTK(boardData.board_id);
      const blob = new Blob([vtkContent], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pcb_thermal_${boardData.board_id}.vtk`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('VTK export failed:', err);
      alert('VTK export failed. Please try running a simulation first.');
    }
  };

  const handleReset = () => {
    resetSimulation();
  };

  return (
    <div className="h-16 bg-[var(--bg-secondary)] border-b border-[rgba(0,245,212,0.2)] flex flex-col px-4 gap-1 py-1 shrink-0">
      <div className="flex items-center gap-2 h-7">
        <div className="flex items-center gap-2 mr-4">
          <Cpu size={18} className="text-[var(--accent)]" />
          <span className="font-heading font-bold text-lg text-[var(--text-primary)] tracking-wide">
            PCB Thermal Sim
          </span>
        </div>

        <div className="h-5 w-px bg-[rgba(0,245,212,0.2)]" />

        <input
          ref={fileInputRef}
          type="file"
          accept=".gbr,.ger,.gtl,.gbl,.gts,.gbs,.gbo,.gto,.zip"
          className="hidden"
          onChange={handleFileUpload}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="toolbar-btn h-6 text-xs"
          disabled={isLoading}
        >
          <Upload size={14} />
          <span>Upload</span>
        </button>

        <button
          onClick={handleLoadDemo}
          className="toolbar-btn h-6 text-xs"
          disabled={isLoading}
        >
          <LayoutTemplate size={14} />
          <span>Demo</span>
        </button>

        <div className="h-5 w-px bg-[rgba(0,245,212,0.2)]" />

        {tools.map((tool) => (
          <button
            key={tool.type}
            onClick={() => setSelectedTool(tool.type)}
            className={`toolbar-btn h-6 text-xs ${selectedTool === tool.type ? 'toolbar-btn-active' : ''}`}
          >
            {tool.icon}
            <span>{tool.label}</span>
          </button>
        ))}

        <div className="h-5 w-px bg-[rgba(0,245,212,0.2)]" />

        <button
          onClick={handleRunSimulation}
          className="toolbar-btn h-6 text-xs text-[var(--accent)] hover:text-[var(--accent-hover)]"
          disabled={isLoading || !boardData}
        >
          <Play size={14} />
          <span>{isLoading ? 'Running...' : 'Simulate'}</span>
        </button>

        <button
          onClick={handleExportVTK}
          className="toolbar-btn h-6 text-xs"
          disabled={isLoading || !simResult}
        >
          <Download size={14} />
          <span>VTK</span>
        </button>

        <button
          onClick={handleReset}
          className="toolbar-btn h-6 text-xs text-[var(--danger)]"
          disabled={isLoading}
        >
          <RotateCcw size={14} />
          <span>Reset</span>
        </button>
      </div>

      {simResult && (
        <div className="flex items-center gap-3 h-7">
          <div className="flex items-center gap-2">
            <Layers size={14} className="text-[var(--text-secondary)]" />
            <select
              value={selectedLayer}
              onChange={(e) => setSelectedLayer(Number(e.target.value))}
              className="bg-[var(--bg-tertiary)] border border-[rgba(0,245,212,0.2)] rounded px-2 py-0.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
            >
              {simResult.layer_names.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <Activity size={14} className="text-[var(--text-secondary)]" />
            {fieldTypes.map((ft) => (
              <button
                key={ft.type}
                onClick={() => setFieldType(ft.type)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  fieldType === ft.type
                    ? 'bg-[var(--accent)] text-[var(--bg-primary)] font-medium'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {ft.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
