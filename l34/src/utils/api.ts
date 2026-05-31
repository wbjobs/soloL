import type { BoardData, CurrentSource, HeatSource, SimParams, SimulationResult } from '@/types';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `API Error: ${response.status}`);
  }
  return response.json();
}

function addOutline(data: BoardData): BoardData {
  if (data.outline && data.outline.length > 0) return data;
  const w = data.dimensions.width;
  const h = data.dimensions.height;
  return {
    ...data,
    outline: [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ] as [number, number][],
  };
}

export async function parseGerber(file: File): Promise<BoardData> {
  const formData = new FormData();
  formData.append('files', file);
  const response = await fetch('/api/parse-gerber', {
    method: 'POST',
    body: formData,
  });
  const data = await handleResponse<BoardData>(response);
  return addOutline(data);
}

export async function simulate(
  boardId: string,
  heatSources: HeatSource[],
  currentSources: CurrentSource[],
  params: SimParams
): Promise<SimulationResult> {
  const backendHeatSources = heatSources.map((hs) => ({
    x: hs.x,
    y: hs.y,
    width: hs.width,
    height: hs.height,
    power: hs.power,
    layer: hs.layer || 'top',
  }));
  const response = await fetch('/api/simulate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_id: boardId,
      heat_sources: backendHeatSources,
      current_sources: currentSources,
      params: {
        ...params,
        copper_thickness: params.copper_thickness * 0.035,
        convergence_tol: params.convergence,
        grid_resolution: params.grid_resolution,
      },
    }),
  });
  return handleResponse<SimulationResult>(response);
}

export async function loadDemoBoard(): Promise<BoardData> {
  const response = await fetch('/api/demo-board');
  const data = await handleResponse<BoardData>(response);
  return addOutline(data);
}

export async function exportVTK(boardId: string): Promise<string> {
  const response = await fetch('/api/export-vtk', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      board_id: boardId,
      format: 'vtk',
    }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `API Error: ${response.status}`);
  }
  return response.text();
}
