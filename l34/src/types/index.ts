export interface LayerDefinition {
  name: string;
  thickness: number;
  conductivity: number;
  electrical_conductivity: number;
  is_copper: boolean;
}

export interface TraceSegment {
  start_x: number;
  start_y: number;
  end_x: number;
  end_y: number;
  width: number;
  layer: string;
}

export interface PadInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  shape: string;
  layer: string;
}

export interface ComponentInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  power: number;
  layer: string;
}

export interface BoardData {
  board_id: string;
  dimensions: {
    width: number;
    height: number;
  };
  traces: TraceSegment[];
  pads: PadInfo[];
  components: ComponentInfo[];
  layers: LayerDefinition[];
  grid_resolution: number;
  outline: [number, number][];
}

export type HeatSourceType = 'resistor' | 'ic_chip' | 'custom';

export interface HeatSource {
  id: string;
  type: HeatSourceType;
  x: number;
  y: number;
  width: number;
  height: number;
  power: number;
  layer: string;
}

export interface CurrentSource {
  name: string;
  type: 'current' | 'voltage';
  x: number;
  y: number;
  value: number;
  layer: string;
  is_sink: boolean;
}

export interface SimParams {
  ambient_temp: number;
  board_thickness: number;
  copper_thickness: number;
  convection_coeff: number;
  max_iterations: number;
  convergence: number;
  grid_resolution: number;
  enable_current_simulation: boolean;
  joule_heating_coupling: boolean;
}

export interface HeatFlowField {
  qx: number[][][];
  qy: number[][][];
  qz: number[][][];
}

export interface SimulationResult {
  board_id: string;
  temperature_matrices: number[][][];
  layer_names: string[];
  max_temp: number;
  min_temp: number;
  avg_temp: number;
  iterations: number;
  converged: boolean;
  grid_rows: number;
  grid_cols: number;
  n_layers: number;
  potential_matrix?: number[][];
  current_density?: number[][];
  max_current_density?: number;
  joule_heat_total?: number;
  heat_flow?: HeatFlowField;
}

export type FieldType = 'temperature' | 'current_density' | 'heat_flow_x' | 'heat_flow_y';
