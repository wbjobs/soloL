import { 
  Grid3D, 
  WellTrajectory, 
  Formation, 
  SliceParams, 
  SliceResponse,
  KrigingProgress,
  AnalysisReport,
  KrigingParams,
  FileListResponse,
  Point3D,
  PotreeMetadata,
  GeosteeringInfo,
  SimulationParams,
  SimulationResult,
  MonteCarloParams,
  MonteCarloResult,
  Annotation,
  User
} from '../../shared/types';

const API_BASE = '/api';

async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  return response.json();
}

export const segyAPI = {
  upload: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    const response = await fetch(`${API_BASE}/segy/upload`, {
      method: 'POST',
      body: formData
    });
    return handleResponse<{
      fileId: string;
      header: any;
      preview: number[][];
      controlPoints: Point3D[];
      values: number[];
      isMock: boolean;
    }>(response);
  },

  generateMock: async () => {
    const response = await fetch(`${API_BASE}/segy/mock`);
    return handleResponse<{
      fileId: string;
      header: any;
      preview: number[][];
      controlPoints: Point3D[];
      values: number[];
      isMock: boolean;
    }>(response);
  },

  get: async (fileId: string) => {
    const response = await fetch(`${API_BASE}/segy/${fileId}`);
    return handleResponse<{
      fileId: string;
      header: any;
      preview: number[][];
      controlPoints: Point3D[];
      values: number[];
      isMock: boolean;
    }>(response);
  },

  getPreview: async (fileId: string) => {
    const response = await fetch(`${API_BASE}/segy/${fileId}/preview`);
    return handleResponse(response);
  },

  delete: async (fileId: string) => {
    const response = await fetch(`${API_BASE}/segy/${fileId}`, {
      method: 'DELETE'
    });
    return handleResponse<{ success: boolean }>(response);
  }
};

export const gridAPI = {
  startKriging: async (
    controlPoints: Point3D[],
    values: number[],
    params: KrigingParams,
    dimensions?: { nx: number; ny: number; nz: number }
  ) => {
    const response = await fetch(`${API_BASE}/grid/kriging`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ controlPoints, values, params, dimensions })
    });
    return handleResponse<{ gridId: string; progress: number }>(response);
  },

  getProgress: async (gridId: string) => {
    const response = await fetch(`${API_BASE}/grid/${gridId}/progress`);
    return handleResponse<KrigingProgress>(response);
  },

  generateMock: async () => {
    const response = await fetch(`${API_BASE}/grid/mock`);
    return handleResponse<{ gridId: string; progress: number; status: string }>(response);
  },

  get: async (gridId: string) => {
    const response = await fetch(`${API_BASE}/grid/${gridId}`);
    return handleResponse<Grid3D>(response);
  },

  getMeta: async (gridId: string) => {
    const response = await fetch(`${API_BASE}/grid/${gridId}/meta`);
    return handleResponse(response);
  },

  getFormations: async () => {
    const response = await fetch(`${API_BASE}/grid/formations`);
    return handleResponse<Formation[]>(response);
  },

  delete: async (gridId: string) => {
    const response = await fetch(`${API_BASE}/grid/${gridId}`, {
      method: 'DELETE'
    });
    return handleResponse<{ success: boolean }>(response);
  }
};

export const trajectoryAPI = {
  analyze: async (gridId: string, trajectory: WellTrajectory) => {
    const response = await fetch(`${API_BASE}/trajectory/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridId, trajectory })
    });
    return handleResponse<AnalysisReport & { reportId: string }>(response);
  },

  getDefault: async () => {
    const response = await fetch(`${API_BASE}/trajectory/default`);
    return handleResponse<WellTrajectory>(response);
  },

  save: async (trajectory: WellTrajectory) => {
    const response = await fetch(`${API_BASE}/trajectory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(trajectory)
    });
    return handleResponse<WellTrajectory & { id: string }>(response);
  },

  get: async (trajectoryId: string) => {
    const response = await fetch(`${API_BASE}/trajectory/${trajectoryId}`);
    return handleResponse<WellTrajectory>(response);
  },

  delete: async (trajectoryId: string) => {
    const response = await fetch(`${API_BASE}/trajectory/${trajectoryId}`, {
      method: 'DELETE'
    });
    return handleResponse<{ success: boolean }>(response);
  },

  getReport: async (reportId: string) => {
    const response = await fetch(`${API_BASE}/trajectory/report/${reportId}`);
    return handleResponse<AnalysisReport>(response);
  },

  sample: async (trajectory: WellTrajectory, samplesPerSegment?: number) => {
    const response = await fetch(`${API_BASE}/trajectory/sample`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trajectory, samplesPerSegment })
    });
    return handleResponse<{ points: Point3D[] }>(response);
  }
};

export const sliceAPI = {
  generate: async (gridId: string, params: SliceParams) => {
    const response = await fetch(`${API_BASE}/slice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridId, params })
    });
    return handleResponse<SliceResponse>(response);
  },

  generateMesh: async (gridId: string, params: SliceParams) => {
    const response = await fetch(`${API_BASE}/slice/mesh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridId, params })
    });
    return handleResponse<{ vertices: number[]; colors: number[]; indices: number[] }>(response);
  }
};

export const filesAPI = {
  getList: async () => {
    const response = await fetch(`${API_BASE}/files/list`);
    return handleResponse<FileListResponse>(response);
  }
};

export const potreeAPI = {
  getMetadata: async (gridId: string) => {
    const response = await fetch(`${API_BASE}/potree/${gridId}/metadata`);
    return handleResponse<PotreeMetadata>(response);
  },
  
  getNodeData: async (gridId: string, nodeId: string) => {
    const response = await fetch(`${API_BASE}/potree/${gridId}/nodes/${nodeId}`);
    const arrayBuffer = await response.arrayBuffer();
    return arrayBuffer;
  },
  
  generate: async (gridId: string) => {
    const response = await fetch(`${API_BASE}/potree/${gridId}/generate`, {
      method: 'POST'
    });
    return handleResponse<{ success: boolean; gridId: string }>(response);
  }
};

export const geosteeringAPI = {
  getGeosteeringInfo: async (gridId: string, point: Point3D) => {
    const response = await fetch(`${API_BASE}/geosteering/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridId, point })
    });
    return handleResponse<GeosteeringInfo>(response);
  },
  
  getReservoirTop: async (gridId: string, x: number, y: number) => {
    const response = await fetch(`${API_BASE}/geosteering/reservoir-top`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridId, x, y })
    });
    return handleResponse<{ depth: number; value: number; formationId: number }>(response);
  }
};

export const simulationAPI = {
  startFlowSimulation: async (
    gridId: string, 
    params: SimulationParams, 
    wellPoints: Point3D[]
  ) => {
    const response = await fetch(`${API_BASE}/simulation/simulation/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridId, params, wellPoints })
    });
    return handleResponse<{ simulationId: string; progress: number }>(response);
  },
  
  getSimulationProgress: async (simulationId: string) => {
    const response = await fetch(`${API_BASE}/simulation/simulation/${simulationId}/progress`);
    return handleResponse<{
      progress: number;
      status: string;
      result?: SimulationResult;
      error?: string;
    }>(response);
  },
  
  getSimulationResult: async (simulationId: string) => {
    const response = await fetch(`${API_BASE}/simulation/simulation/${simulationId}/result`);
    return handleResponse<SimulationResult>(response);
  },
  
  listSimulations: async (gridId?: string) => {
    const url = gridId 
      ? `${API_BASE}/simulation/simulations?gridId=${gridId}` 
      : `${API_BASE}/simulation/simulations`;
    const response = await fetch(url);
    return handleResponse<{
      simulations: { simulationId: string; gridId: string; createdAt: string }[];
    }>(response);
  },
  
  startMonteCarlo: async (
    gridId: string,
    monteCarloParams: MonteCarloParams,
    baseKrigingParams: KrigingParams,
    simulationParams: SimulationParams,
    wellPoints: Point3D[]
  ) => {
    const response = await fetch(`${API_BASE}/simulation/montecarlo/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        gridId, 
        monteCarloParams, 
        baseKrigingParams, 
        simulationParams, 
        wellPoints 
      })
    });
    return handleResponse<{ mcId: string; progress: number }>(response);
  },
  
  getMonteCarloProgress: async (mcId: string) => {
    const response = await fetch(`${API_BASE}/simulation/montecarlo/${mcId}/progress`);
    return handleResponse<{
      progress: number;
      currentSim: number;
      totalSims: number;
      status: string;
      result?: MonteCarloResult;
      error?: string;
    }>(response);
  },
  
  getMonteCarloResult: async (mcId: string) => {
    const response = await fetch(`${API_BASE}/simulation/montecarlo/${mcId}/result`);
    return handleResponse<MonteCarloResult>(response);
  },
  
  listMonteCarlo: async (gridId?: string) => {
    const url = gridId 
      ? `${API_BASE}/simulation/montecarlo?gridId=${gridId}` 
      : `${API_BASE}/simulation/montecarlo`;
    const response = await fetch(url);
    return handleResponse<{
      simulations: { mcId: string; gridId: string; createdAt: string; numSims: number }[];
    }>(response);
  }
};

export const collaborationAPI = {
  createSession: async (gridId: string, host: User) => {
    const response = await fetch(`${API_BASE}/collaboration/session/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gridId, host })
    });
    return handleResponse<{ sessionId: string }>(response);
  },
  
  joinSession: async (sessionId: string, user: User) => {
    const response = await fetch(`${API_BASE}/collaboration/session/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, user })
    });
    return handleResponse<{
      success: boolean;
      user: User;
      users: User[];
      annotations: Annotation[];
    }>(response);
  },
  
  getSessionUsers: async (sessionId: string) => {
    const response = await fetch(`${API_BASE}/collaboration/session/${sessionId}/users`);
    return handleResponse<{ users: User[] }>(response);
  },
  
  getAnnotations: async (sessionId: string) => {
    const response = await fetch(`${API_BASE}/collaboration/session/${sessionId}/annotations`);
    return handleResponse<{ annotations: Annotation[] }>(response);
  },
  
  addAnnotation: async (
    sessionId: string, 
    annotation: Omit<Annotation, 'id' | 'createdAt' | 'updatedAt'>
  ) => {
    const response = await fetch(`${API_BASE}/collaboration/annotation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, annotation })
    });
    return handleResponse<Annotation>(response);
  },
  
  updateAnnotation: async (
    sessionId: string,
    annotationId: string,
    updates: Partial<Annotation>
  ) => {
    const response = await fetch(`${API_BASE}/collaboration/annotation/${annotationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, updates })
    });
    return handleResponse<Annotation>(response);
  },
  
  deleteAnnotation: async (sessionId: string, annotationId: string) => {
    const response = await fetch(`${API_BASE}/collaboration/annotation/${annotationId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    return handleResponse<{ success: boolean }>(response);
  },
  
  listSessions: async (gridId?: string) => {
    const url = gridId 
      ? `${API_BASE}/collaboration/sessions?gridId=${gridId}` 
      : `${API_BASE}/collaboration/sessions`;
    const response = await fetch(url);
    return handleResponse<{
      sessions: {
        sessionId: string;
        gridId: string;
        hostId: string;
        userCount: number;
        annotationCount: number;
        createdAt: number;
      }[];
    }>(response);
  }
};
