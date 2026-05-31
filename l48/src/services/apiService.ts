import type {
  SceneObject,
  LightSource,
  VoxelGridData,
  BakeQuality,
} from '@/types';

export interface ApiConfig {
  readonly baseUrl?: string;
  readonly timeout?: number;
}

export interface SceneResponse {
  readonly id: string;
  readonly name: string;
  readonly objects: SceneObject[];
  readonly lights: LightSource[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface BakeTaskResponse {
  readonly id: string;
  readonly sceneId: string;
  readonly quality: BakeQuality;
  readonly status: 'pending' | 'processing' | 'completed' | 'failed';
  readonly progress: number;
  readonly message: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly voxelDataId?: string;
}

export interface VoxelDataResponse {
  readonly id: string;
  readonly sceneId: string;
  readonly bakeTaskId: string;
  readonly resolution: number;
  readonly size: [number, number, number];
  readonly center: [number, number, number];
  readonly data: number[];
  readonly dataType: 'uint8' | 'float32';
  readonly createdAt: string;
}

export interface CreateSceneRequest {
  readonly name: string;
  readonly objects: SceneObject[];
  readonly lights: LightSource[];
}

export interface UpdateSceneRequest {
  readonly name?: string;
  readonly objects?: SceneObject[];
  readonly lights?: LightSource[];
}

export interface CreateBakeTaskRequest {
  readonly sceneId: string;
  readonly quality: BakeQuality;
  readonly useGPU?: boolean;
}

export interface ApiError {
  readonly code: string;
  readonly message: string;
  readonly details?: unknown;
}

class ApiService {
  private baseUrl: string;
  private timeout: number;
  private authToken: string | null = null;

  constructor(config: ApiConfig = {}) {
    this.baseUrl = config.baseUrl ?? '/api';
    this.timeout = config.timeout ?? 30000;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  public setAuthToken(token: string | null): void {
    this.authToken = token;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(options.headers as Record<string, string> ?? {}),
      };

      if (this.authToken) {
        headers['Authorization'] = `Bearer ${this.authToken}`;
      }

      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorDetails: unknown;
        try {
          errorDetails = await response.json();
        } catch {
          errorDetails = await response.text();
        }

        const error: ApiError = {
          code: `HTTP_${response.status}`,
          message: `Request failed with status ${response.status}`,
          details: errorDetails,
        };

        throw error;
      }

      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        return await response.json() as T;
      }

      return undefined as T;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw {
          code: 'TIMEOUT',
          message: `Request timed out after ${this.timeout}ms`,
        } as ApiError;
      }

      if ((error as ApiError).code) {
        throw error;
      }

      throw {
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Network error',
        details: error,
      } as ApiError;
    }
  }

  public async getScenes(): Promise<SceneResponse[]> {
    return this.request<SceneResponse[]>('/scenes', {
      method: 'GET',
    });
  }

  public async getScene(id: string): Promise<SceneResponse> {
    return this.request<SceneResponse>(`/scenes/${id}`, {
      method: 'GET',
    });
  }

  public async createScene(data: CreateSceneRequest): Promise<SceneResponse> {
    return this.request<SceneResponse>('/scenes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async updateScene(id: string, data: UpdateSceneRequest): Promise<SceneResponse> {
    return this.request<SceneResponse>(`/scenes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  public async deleteScene(id: string): Promise<void> {
    return this.request<void>(`/scenes/${id}`, {
      method: 'DELETE',
    });
  }

  public async addSceneObject(sceneId: string, obj: SceneObject): Promise<SceneResponse> {
    return this.request<SceneResponse>(`/scenes/${sceneId}/objects`, {
      method: 'POST',
      body: JSON.stringify(obj),
    });
  }

  public async updateSceneObject(sceneId: string, objectId: string, obj: Partial<SceneObject>): Promise<SceneResponse> {
    return this.request<SceneResponse>(`/scenes/${sceneId}/objects/${objectId}`, {
      method: 'PATCH',
      body: JSON.stringify(obj),
    });
  }

  public async removeSceneObject(sceneId: string, objectId: string): Promise<SceneResponse> {
    return this.request<SceneResponse>(`/scenes/${sceneId}/objects/${objectId}`, {
      method: 'DELETE',
    });
  }

  public async addLight(sceneId: string, light: LightSource): Promise<SceneResponse> {
    return this.request<SceneResponse>(`/scenes/${sceneId}/lights`, {
      method: 'POST',
      body: JSON.stringify(light),
    });
  }

  public async updateLight(sceneId: string, lightId: string, light: Partial<LightSource>): Promise<SceneResponse> {
    return this.request<SceneResponse>(`/scenes/${sceneId}/lights/${lightId}`, {
      method: 'PATCH',
      body: JSON.stringify(light),
    });
  }

  public async removeLight(sceneId: string, lightId: string): Promise<SceneResponse> {
    return this.request<SceneResponse>(`/scenes/${sceneId}/lights/${lightId}`, {
      method: 'DELETE',
    });
  }

  public async getBakeTasks(sceneId?: string): Promise<BakeTaskResponse[]> {
    const path = sceneId ? `/bake-tasks?sceneId=${sceneId}` : '/bake-tasks';
    return this.request<BakeTaskResponse[]>(path, {
      method: 'GET',
    });
  }

  public async getBakeTask(id: string): Promise<BakeTaskResponse> {
    return this.request<BakeTaskResponse>(`/bake-tasks/${id}`, {
      method: 'GET',
    });
  }

  public async createBakeTask(data: CreateBakeTaskRequest): Promise<BakeTaskResponse> {
    return this.request<BakeTaskResponse>('/bake-tasks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  public async cancelBakeTask(id: string): Promise<BakeTaskResponse> {
    return this.request<BakeTaskResponse>(`/bake-tasks/${id}/cancel`, {
      method: 'POST',
    });
  }

  public async getVoxelData(id: string): Promise<VoxelDataResponse> {
    return this.request<VoxelDataResponse>(`/voxel-data/${id}`, {
      method: 'GET',
    });
  }

  public async getVoxelDataByScene(sceneId: string): Promise<VoxelDataResponse[]> {
    return this.request<VoxelDataResponse[]>(`/voxel-data?sceneId=${sceneId}`, {
      method: 'GET',
    });
  }

  public async uploadVoxelData(
    sceneId: string,
    bakeTaskId: string,
    gridData: VoxelGridData
  ): Promise<VoxelDataResponse> {
    const dataType = gridData.data instanceof Float32Array ? 'float32' : 'uint8';

    return this.request<VoxelDataResponse>('/voxel-data', {
      method: 'POST',
      body: JSON.stringify({
        sceneId,
        bakeTaskId,
        resolution: gridData.resolution,
        size: gridData.size,
        center: gridData.center,
        data: Array.from(gridData.data),
        dataType,
      }),
    });
  }

  public async downloadVoxelData(id: string): Promise<VoxelGridData> {
    const response = await this.request<VoxelDataResponse>(`/voxel-data/${id}/download`, {
      method: 'GET',
    });

    const data = response.dataType === 'float32'
      ? new Float32Array(response.data)
      : new Uint8Array(response.data);

    return {
      resolution: response.resolution,
      size: response.size,
      center: response.center,
      data,
    };
  }

  public async deleteVoxelData(id: string): Promise<void> {
    return this.request<void>(`/voxel-data/${id}`, {
      method: 'DELETE',
    });
  }

  public async getHealth(): Promise<{ status: string; timestamp: string }> {
    return this.request<{ status: string; timestamp: string }>('/health', {
      method: 'GET',
    });
  }

  public isApiError(error: unknown): error is ApiError {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      'message' in error &&
      typeof (error as ApiError).code === 'string' &&
      typeof (error as ApiError).message === 'string'
    );
  }
}

export const apiService = new ApiService();

export default apiService;
