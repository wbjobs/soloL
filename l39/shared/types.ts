export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface FaultPoint {
  x: number;
  y: number;
  z: number;
  throw: number;
  confidence: number;
}

export interface Fault {
  id: string;
  name: string;
  points: FaultPoint[];
  strike: number;
  dip: number;
  color: string;
}

export interface IndicatorKrigingResult {
  probability: number;
  variance: number;
  indicator: number;
}

export interface FaultConstraint {
  faultId: string;
  influenceZone: number;
  correctionFactor: number;
}

export interface BezierControlPoints {
  p0: Point3D;
  p1: Point3D;
  p2: Point3D;
  p3: Point3D;
}

export interface WellTrajectory {
  id: string;
  name: string;
  segments: BezierControlPoints[];
  samplePoints: Point3D[];
  color: string;
}

export interface SEGYHeader {
  sampleInterval: number;
  sampleCount: number;
  traceCount: number;
  formatCode: number;
}

export interface SEGYTrace {
  header: Record<string, number>;
  data: number[];
}

export interface Grid3D {
  dimensions: { nx: number; ny: number; nz: number };
  origin: Point3D;
  spacing: Point3D;
  values: number[];
  formationIds: number[];
}

export interface KrigingParams {
  model: 'spherical' | 'exponential' | 'gaussian';
  range: number;
  sill: number;
  nugget: number;
  searchRadius: number;
  maxNeighbors: number;
  useIndicatorKriging?: boolean;
  indicatorThreshold?: number;
  faultConstraints?: FaultConstraint[];
  localRangeAdjustment?: boolean;
}

export interface PotreeOctreeNode {
  id: string;
  level: number;
  boundingBox: {
    min: Point3D;
    max: Point3D;
    center: Point3D;
  };
  pointCount: number;
  children: string[];
  spacing: number;
  hasChildren: boolean;
  hierarchyByteOffset: number;
  hierarchyByteSize: number;
}

export interface PotreePoint {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
  value: number;
  formationId: number;
}

export interface PotreeMetadata {
  name: string;
  version: string;
  octreeType: string;
  pointAttributes: string[];
  projection: string;
  points: number;
  spacing: number;
  boundingBox: { min: Point3D; max: Point3D; center: Point3D };
  encoding: string;
  hierarchy: {
    firstChunkSize: number;
    stepSize: number;
    depth: number;
    root: PotreeOctreeNode;
  };
}

export interface GeosteeringInfo {
  reservoirTop: number;
  reservoirBottom: number;
  distanceToTop: number;
  distanceToBottom: number;
  currentFormation: string;
  formationThickness: number;
  dipAngle: number;
  recommendation: string;
  targetZone: boolean;
}

export interface Formation {
  id: number;
  name: string;
  color: string;
  minValue: number;
  maxValue: number;
}

export interface SliceParams {
  normal: Point3D;
  origin: Point3D;
  showGrid: boolean;
  showContours: boolean;
}

export interface IntersectionResult {
  formationId: number;
  formationName: string;
  entryPoint: Point3D;
  exitPoint: Point3D;
  thickness: number;
  dipAngle: number;
  strikeAngle: number;
  entryDepth: number;
  exitDepth: number;
}

export interface AnalysisReport {
  trajectoryId: string;
  totalLength: number;
  maxDepth: number;
  averageDipAngle: number;
  intersections: IntersectionResult[];
  createdAt: string;
}

export interface FileInfo {
  id: string;
  name: string;
  size: number;
  createdAt: string;
}

export interface FileListResponse {
  segyFiles: FileInfo[];
  grids: FileInfo[];
  trajectories: FileInfo[];
}

export interface KrigingProgress {
  progress: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  gridId?: string;
  error?: string;
}

export interface SliceResponse {
  imageData: number[];
  width: number;
  height: number;
}

export interface RockProperties {
  permeability: number;
  porosity: number;
  compressibility: number;
  relativePermeabilityOil: number;
  relativePermeabilityWater: number;
}

export interface FluidProperties {
  oilViscosity: number;
  waterViscosity: number;
  oilDensity: number;
  waterDensity: number;
  formationVolumeFactorOil: number;
  formationVolumeFactorWater: number;
}

export interface SimulationParams {
  totalTime: number;
  timeStep: number;
  initialPressure: number;
  wellPressure: number;
  reservoirPressure: number;
  rockProperties: RockProperties;
  fluidProperties: FluidProperties;
}

export interface SimulationCell {
  pressure: number;
  oilSaturation: number;
  waterSaturation: number;
  permeability: number;
  porosity: number;
  transmissibilityX: number;
  transmissibilityY: number;
  transmissibilityZ: number;
  accumulation: number;
}

export interface SimulationResult {
  gridId: string;
  params: SimulationParams;
  cells: SimulationCell[];
  timeSteps: number[];
  waterOilContact: Point3D[][];
  finalPressureField: number[];
  finalOilSaturation: number[];
  productionData: {
    time: number;
    oilRate: number;
    waterRate: number;
    cumulativeOil: number;
    cumulativeWater: number;
  }[];
}

export interface MonteCarloParams {
  numSimulations: number;
  rangeDistribution: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
  sillDistribution: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
  permeabilityDistribution: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
  porosityDistribution: {
    mean: number;
    std: number;
    min: number;
    max: number;
  };
}

export interface MonteCarloResult {
  id: string;
  gridId: string;
  params: MonteCarloParams;
  realizations: {
    range: number;
    sill: number;
    permeability: number;
    porosity: number;
    recoverableReserves: number;
    finalOilSaturation: number;
    waterBreakthroughTime: number;
  }[];
  statistics: {
    recoverableReserves: {
      P10: number;
      P50: number;
      P90: number;
      mean: number;
      std: number;
    };
    finalOilSaturation: {
      P10: number;
      P50: number;
      P90: number;
      mean: number;
      std: number;
    };
    waterBreakthroughTime: {
      P10: number;
      P50: number;
      P90: number;
      mean: number;
      std: number;
    };
  };
  percentiles: {
    reserves: number[];
    saturation: number[];
    breakthrough: number[];
  };
}

export interface Annotation {
  id: string;
  type: 'fault' | 'well' | 'comment' | 'polygon' | 'line';
  author: string;
  authorId: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  name: string;
  description: string;
  points: Point3D[];
  properties: Record<string, unknown>;
  isLocked: boolean;
  lockedBy?: string;
}

export interface User {
  id: string;
  name: string;
  avatar: string;
  color: string;
  isOnline: boolean;
  lastActive: number;
}

export interface CollaborationMessage {
  type: 'annotation' | 'cursor' | 'view' | 'user_join' | 'user_leave' | 'chat';
  payload: unknown;
  userId: string;
  timestamp: number;
}

export interface WebRTCConnection {
  peerId: string;
  userId: string;
  status: 'connecting' | 'connected' | 'disconnected';
  dataChannel?: RTCDataChannel;
}

export interface ViewState {
  cameraPosition: Point3D;
  cameraTarget: Point3D;
  cameraFov: number;
  zoom: number;
}
