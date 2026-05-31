import type { Vec3, VoxelGridData, SceneObject, LightSource, VCTConfig } from '@/types';
import { vec3, mathUtils } from '@/utils/math';
import { voxelUtils } from '@/utils/voxel';
import { VoxelTexture3D } from './VoxelTexture3D';
import { Voxelizer } from './Voxelizer';
import { VoxelConeTracer } from './VoxelConeTracer';

import bakeVertexShaderSource from './shaders/bakeVertexShader.glsl?raw';
import bakeFragmentShaderSource from './shaders/bakeFragmentShader.glsl?raw';

export type BakeQuality = 'low' | 'medium' | 'high';

export interface BakeQualitySettings {
  readonly resolution: number;
  readonly coneSteps: number;
  readonly coneCount: number;
  readonly antialiasing: boolean;
}

export interface BakeProgress {
  readonly phase: 'voxelizing' | 'baking' | 'complete' | 'error';
  readonly progress: number;
  readonly message: string;
  readonly elapsedMs: number;
}

export interface BakeResult {
  readonly success: boolean;
  readonly irradianceTexture: VoxelTexture3D | null;
  readonly voxelGridData: VoxelGridData | null;
  readonly stats: BakeStats;
  readonly error?: string;
}

export interface BakeStats {
  readonly voxelCount: number;
  readonly voxelizationTimeMs: number;
  readonly bakeTimeMs: number;
  readonly totalTimeMs: number;
  readonly memoryUsage: number;
}

export interface BakeOptions {
  readonly quality?: BakeQuality;
  readonly useGPU?: boolean;
  readonly saveToStorage?: boolean;
  readonly onProgress?: (progress: BakeProgress) => void;
}

const BAKE_QUALITY_PRESETS: Record<BakeQuality, BakeQualitySettings> = {
  low: {
    resolution: 64,
    coneSteps: 32,
    coneCount: 4,
    antialiasing: false,
  },
  medium: {
    resolution: 128,
    coneSteps: 64,
    coneCount: 6,
    antialiasing: true,
  },
  high: {
    resolution: 256,
    coneSteps: 128,
    coneCount: 9,
    antialiasing: true,
  },
};

const STORAGE_KEY = 'voxel_bake_data';

export class LightBaker {
  private gl: WebGL2RenderingContext;
  private voxelizer: Voxelizer | null = null;
  private vct: VoxelConeTracer | null = null;
  private irradianceTexture: VoxelTexture3D | null = null;

  private shaderProgram: WebGLProgram | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private uniforms: Map<string, WebGLUniformLocation> = new Map();
  private attributes: Map<string, number> = new Map();

  private isBaking: boolean = false;
  private isInitialized: boolean = false;
  private abortRequested: boolean = false;

  private startTime: number = 0;
  private currentQuality: BakeQuality = 'medium';

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  public initialize(): boolean {
    if (this.isInitialized) return true;

    const gl = this.gl;

    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    if (!this.createShaderProgram()) {
      console.error('Failed to create bake shader program');
      return false;
    }

    this.createGeometryBuffers();
    this.createFramebuffer();

    this.isInitialized = true;
    return true;
  }

  private createShaderProgram(): boolean {
    const gl = this.gl;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, bakeVertexShaderSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, bakeFragmentShaderSource);

    if (!vertexShader || !fragmentShader) return false;

    const program = gl.createProgram();
    if (!program) return false;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.bindFragDataLocation(program, 0, 'irradianceOutput');
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Bake program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }

    const uniformNames = [
      'uVoxelTexture', 'uVoxelGridCenter', 'uVoxelGridSize', 'uVoxelResolution',
      'uLightCount', 'uLightPositions', 'uLightColors', 'uLightIntensities',
      'uLightRadii', 'uLightTypes', 'uLightDirections',
      'uConeStepSize', 'uConeMaxSteps', 'uConeAperture', 'uConeCount',
      'uIndirectIntensity', 'uAOIntensity',
      'uSliceIndex', 'uSliceDirection',
    ];

    for (const name of uniformNames) {
      const location = gl.getUniformLocation(program, name);
      if (location) this.uniforms.set(name, location);
    }

    const attributeNames = ['aPosition', 'aTexCoord'];
    for (const name of attributeNames) {
      const location = gl.getAttribLocation(program, name);
      if (location >= 0) this.attributes.set(name, location);
    }

    this.shaderProgram = program;
    return true;
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const typeStr = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
      console.error(`Bake ${typeStr} shader compile error:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private createGeometryBuffers(): void {
    const gl = this.gl;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const vertices = new Float32Array([
      -1, -1,  0, 0,
       1, -1,  1, 0,
       1,  1,  1, 1,
      -1,  1,  0, 1,
    ]);

    const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);

    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const posAttr = this.attributes.get('aPosition');
    const texAttr = this.attributes.get('aTexCoord');

    if (posAttr !== undefined) {
      gl.enableVertexAttribArray(posAttr);
      gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 16, 0);
    }

    if (texAttr !== undefined) {
      gl.enableVertexAttribArray(texAttr);
      gl.vertexAttribPointer(texAttr, 2, gl.FLOAT, false, 16, 8);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);
  }

  private createFramebuffer(): void {
    const gl = this.gl;
    this.framebuffer = gl.createFramebuffer();
  }

  public async bake(
    objects: SceneObject[],
    lights: LightSource[],
    options: BakeOptions = {}
  ): Promise<BakeResult> {
    if (this.isBaking) {
      return {
        success: false,
        irradianceTexture: null,
        voxelGridData: null,
        stats: this.createEmptyStats(),
        error: 'Bake already in progress',
      };
    }

    this.isBaking = true;
    this.abortRequested = false;
    this.startTime = performance.now();
    this.currentQuality = options.quality ?? 'medium';

    const settings = BAKE_QUALITY_PRESETS[this.currentQuality];
    const useGPU = options.useGPU ?? true;
    const saveToStorage = options.saveToStorage ?? false;
    const onProgress = options.onProgress;

    try {
      this.reportProgress('voxelizing', 0, 'Initializing voxelizer...', onProgress);

      if (!this.voxelizer) {
        this.voxelizer = new Voxelizer(this.gl, {
          resolution: settings.resolution,
          gridSize: [10, 10, 10],
          gridCenter: [0, 0, 0],
          useFloat: true,
        });
        this.voxelizer.initialize();
      } else {
        this.voxelizer.setResolution(settings.resolution);
      }

      this.reportProgress('voxelizing', 0.1, 'Voxelizing scene geometry...', onProgress);

      const voxelStats = useGPU
        ? this.voxelizer.voxelizeSceneGPU(objects, lights)
        : this.voxelizer.voxelizeScene(objects, lights);

      this.reportProgress('voxelizing', 0.3, 'Voxelization complete', onProgress);

      const voxelTexture = this.voxelizer.getVoxelTexture();
      const voxelGridData = this.voxelizer.getVoxelGridData();

      if (!voxelTexture || !voxelGridData) {
        throw new Error('Failed to create voxel texture');
      }

      if (!this.vct) {
        const vctConfig: Partial<VCTConfig> = {
          voxelResolution: settings.resolution,
          coneMaxSteps: settings.coneSteps,
          maxCones: settings.coneCount,
        };
        this.vct = new VoxelConeTracer({ config: vctConfig });
      } else {
        this.vct.setConfig({
          voxelResolution: settings.resolution,
          coneMaxSteps: settings.coneSteps,
          maxCones: settings.coneCount,
        });
      }

      this.vct.setVoxelTexture(voxelTexture);
      this.vct.setVoxelGridData(voxelGridData);

      this.reportProgress('baking', 0.35, 'Creating irradiance texture...', onProgress);

      this.createIrradianceTexture(settings.resolution);

      this.reportProgress('baking', 0.4, 'Computing indirect lighting...', onProgress);

      await this.bakeIrradianceGPU(
        voxelTexture,
        lights,
        settings,
        (progress) => {
          this.reportProgress('baking', 0.4 + progress * 0.55, 'Baking irradiance...', onProgress);
        }
      );

      this.reportProgress('baking', 0.95, 'Generating mipmaps...', onProgress);

      if (this.irradianceTexture) {
        this.irradianceTexture.generateMipmaps();
      }

      const totalTimeMs = performance.now() - this.startTime;
      const stats: BakeStats = {
        voxelCount: voxelStats.voxelCount,
        voxelizationTimeMs: voxelStats.timeMs,
        bakeTimeMs: totalTimeMs - voxelStats.timeMs,
        totalTimeMs,
        memoryUsage: voxelStats.memoryUsage + (this.irradianceTexture?.getMemoryUsage() ?? 0),
      };

      if (saveToStorage) {
        this.saveToStorage(voxelGridData, this.irradianceTexture);
      }

      this.reportProgress('complete', 1.0, 'Bake complete!', onProgress);

      return {
        success: true,
        irradianceTexture: this.irradianceTexture,
        voxelGridData,
        stats,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.reportProgress('error', 0, `Bake failed: ${errorMessage}`, onProgress);

      return {
        success: false,
        irradianceTexture: null,
        voxelGridData: null,
        stats: this.createEmptyStats(),
        error: errorMessage,
      };
    } finally {
      this.isBaking = false;
    }
  }

  private createIrradianceTexture(resolution: number): void {
    if (this.irradianceTexture) {
      this.irradianceTexture.dispose();
    }

    this.irradianceTexture = new VoxelTexture3D(
      this.gl,
      resolution,
      [10, 10, 10],
      [0, 0, 0],
      'RGBA16F'
    );
    this.irradianceTexture.initialize();
  }

  private async bakeIrradianceGPU(
    voxelTexture: VoxelTexture3D,
    lights: LightSource[],
    settings: BakeQualitySettings,
    onSliceProgress: (progress: number) => void
  ): Promise<void> {
    if (!this.shaderProgram || !this.vao || !this.framebuffer || !this.irradianceTexture) {
      throw new Error('Baker not properly initialized');
    }

    const gl = this.gl;
    const resolution = settings.resolution;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.useProgram(this.shaderProgram);
    gl.bindVertexArray(this.vao);

    gl.viewport(0, 0, resolution, resolution);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    this.bindVoxelTexture(voxelTexture);
    this.setLightUniforms(lights);

    this.setFloatUniform('uConeStepSize', 0.1);
    this.setIntUniform('uConeMaxSteps', settings.coneSteps);
    this.setFloatUniform('uConeAperture', 0.57);
    this.setIntUniform('uConeCount', settings.coneCount);
    this.setFloatUniform('uIndirectIntensity', 1.0);
    this.setFloatUniform('uAOIntensity', 1.0);

    for (let z = 0; z < resolution; z++) {
      if (this.abortRequested) {
        throw new Error('Bake aborted');
      }

      this.setIntUniform('uSliceIndex', z);
      this.setIntUniform('uSliceDirection', 2);

      gl.framebufferTextureLayer(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        this.irradianceTexture.getTextureObject()?.texture ?? null,
        0,
        z
      );

      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);

      if (z % 8 === 0) {
        onSliceProgress(z / resolution);
        await this.sleep(0);
      }
    }

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  public bakeIrradianceCPU(
    voxelGridData: VoxelGridData,
    lights: LightSource[],
    settings: BakeQualitySettings,
    onProgress: (progress: number) => void
  ): VoxelGridData {
    const resolution = settings.resolution;
    const totalVoxels = resolution * resolution * resolution;
    const data = new Float32Array(totalVoxels * 4);

    const vctConfig: Partial<VCTConfig> = {
      voxelResolution: resolution,
      coneMaxSteps: settings.coneSteps,
      maxCones: settings.coneCount,
    };
    const vct = new VoxelConeTracer({ config: vctConfig });
    vct.setVoxelGridData(voxelGridData);

    let processed = 0;

    for (let z = 0; z < resolution; z++) {
      for (let y = 0; y < resolution; y++) {
        for (let x = 0; x < resolution; x++) {
          if (this.abortRequested) {
            throw new Error('Bake aborted');
          }

          const voxelPos: Vec3 = [x, y, z];
          const worldPos = vct.voxelToWorld(voxelPos);

          const voxelSample = voxelUtils.getVoxel(
            voxelGridData.data,
            resolution,
            voxelPos
          );

          let irradiance: Vec3 = [0, 0, 0];
          let ao = 1;

          if (voxelSample && voxelSample[3] > 128) {
            const normal = this.estimateNormal(voxelGridData, voxelPos, resolution);
            if (normal) {
              const albedo: Vec3 = [
                voxelSample[0] / 255,
                voxelSample[1] / 255,
                voxelSample[2] / 255,
              ];
              const result = vct.computeIrradiance(worldPos, normal, albedo);
              irradiance = result.diffuse;
              ao = result.ao;
            }
          }

          const idx = (x + y * resolution + z * resolution * resolution) * 4;
          data[idx] = irradiance[0];
          data[idx + 1] = irradiance[1];
          data[idx + 2] = irradiance[2];
          data[idx + 3] = ao;

          processed++;
          if (processed % 10000 === 0) {
            onProgress(processed / totalVoxels);
          }
        }
      }
    }

    return {
      resolution,
      size: voxelGridData.size,
      center: voxelGridData.center,
      data,
    };
  }

  private estimateNormal(
    gridData: VoxelGridData,
    pos: Vec3,
    resolution: number
  ): Vec3 | null {
    const [x, y, z] = pos;

    if (x <= 0 || x >= resolution - 1 || y <= 0 || y >= resolution - 1 || z <= 0 || z >= resolution - 1) {
      return null;
    }

    const getAlpha = (dx: number, dy: number, dz: number): number => {
      const sample = voxelUtils.getVoxel(
        gridData.data,
        resolution,
        [x + dx, y + dy, z + dz]
      );
      return sample ? sample[3] / 255 : 0;
    };

    const dx = (getAlpha(1, 0, 0) - getAlpha(-1, 0, 0)) / 2;
    const dy = (getAlpha(0, 1, 0) - getAlpha(0, -1, 0)) / 2;
    const dz = (getAlpha(0, 0, 1) - getAlpha(0, 0, -1)) / 2;

    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.001) return null;

    return vec3.normalize([-dx, -dy, -dz]);
  }

  private bindVoxelTexture(texture: VoxelTexture3D): void {
    texture.bind(0);
    this.setIntUniform('uVoxelTexture', 0);
    this.setVec3Uniform('uVoxelGridCenter', texture.getCenter());
    this.setVec3Uniform('uVoxelGridSize', texture.getSize());
    this.setFloatUniform('uVoxelResolution', texture.getResolution());
  }

  private setLightUniforms(lights: LightSource[]): void {
    const maxLights = 8;
    const positions: number[] = [];
    const colors: number[] = [];
    const intensities: number[] = [];
    const radii: number[] = [];
    const types: number[] = [];
    const directions: number[] = [];

    for (let i = 0; i < maxLights; i++) {
      if (i < lights.length) {
        const light = lights[i];
        positions.push(...light.position);
        colors.push(...light.color);
        intensities.push(light.intensity);
        radii.push(light.radius);
        types.push(light.type === 'directional' ? 0 : light.type === 'point' ? 1 : 2);
        directions.push(...light.direction);
      } else {
        positions.push(0, 0, 0);
        colors.push(0, 0, 0);
        intensities.push(0);
        radii.push(1);
        types.push(0);
        directions.push(0, -1, 0);
      }
    }

    this.setIntUniform('uLightCount', Math.min(lights.length, maxLights));
    this.setVec3ArrayUniform('uLightPositions', positions);
    this.setVec3ArrayUniform('uLightColors', colors);
    this.setFloatArrayUniform('uLightIntensities', intensities);
    this.setFloatArrayUniform('uLightRadii', radii);
    this.setIntArrayUniform('uLightTypes', types);
    this.setVec3ArrayUniform('uLightDirections', directions);
  }

  private setMatrixUniform(name: string, matrix: Mat4): void {
    const location = this.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
    }
  }

  private setVec3Uniform(name: string, value: Vec3): void {
    const location = this.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniform3f(location, value[0], value[1], value[2]);
    }
  }

  private setFloatUniform(name: string, value: number): void {
    const location = this.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniform1f(location, value);
    }
  }

  private setIntUniform(name: string, value: number): void {
    const location = this.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniform1i(location, value);
    }
  }

  private setVec3ArrayUniform(name: string, values: number[]): void {
    const location = this.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniform3fv(location, values);
    }
  }

  private setFloatArrayUniform(name: string, values: number[]): void {
    const location = this.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniform1fv(location, values);
    }
  }

  private setIntArrayUniform(name: string, values: number[]): void {
    const location = this.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniform1iv(location, values);
    }
  }

  private reportProgress(
    phase: BakeProgress['phase'],
    progress: number,
    message: string,
    callback?: (progress: BakeProgress) => void
  ): void {
    if (!callback) return;

    callback({
      phase,
      progress: mathUtils.clamp(progress, 0, 1),
      message,
      elapsedMs: performance.now() - this.startTime,
    });
  }

  private createEmptyStats(): BakeStats {
    return {
      voxelCount: 0,
      voxelizationTimeMs: 0,
      bakeTimeMs: 0,
      totalTimeMs: 0,
      memoryUsage: 0,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public abort(): void {
    this.abortRequested = true;
  }

  public getIrradianceTexture(): VoxelTexture3D | null {
    return this.irradianceTexture;
  }

  public getQualitySettings(quality: BakeQuality): BakeQualitySettings {
    return { ...BAKE_QUALITY_PRESETS[quality] };
  }

  public isCurrentlyBaking(): boolean {
    return this.isBaking;
  }

  public getCurrentQuality(): BakeQuality {
    return this.currentQuality;
  }

  public saveToStorage(
    voxelGridData: VoxelGridData,
    irradianceTexture: VoxelTexture3D | null
  ): void {
    try {
      const data = {
        timestamp: Date.now(),
        quality: this.currentQuality,
        voxelGridData: {
          resolution: voxelGridData.resolution,
          size: voxelGridData.size,
          center: voxelGridData.center,
          dataType: voxelGridData.data instanceof Float32Array ? 'float32' : 'uint8',
          data: Array.from(voxelGridData.data),
        },
      };

      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.warn('Failed to save bake data to storage:', error);
    }
  }

  public loadFromStorage(): {
    readonly voxelGridData: VoxelGridData;
    readonly quality: BakeQuality;
  } | null {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return null;

      const data = JSON.parse(stored);
      const voxelData = data.voxelGridData.dataType === 'float32'
        ? new Float32Array(data.voxelGridData.data)
        : new Uint8Array(data.voxelGridData.data);

      return {
        voxelGridData: {
          resolution: data.voxelGridData.resolution,
          size: data.voxelGridData.size,
          center: data.voxelGridData.center,
          data: voxelData,
        },
        quality: data.quality,
      };
    } catch (error) {
      console.warn('Failed to load bake data from storage:', error);
      return null;
    }
  }

  public clearStorage(): void {
    localStorage.removeItem(STORAGE_KEY);
  }

  public dispose(): void {
    this.abort();

    const gl = this.gl;

    if (this.shaderProgram) {
      gl.deleteProgram(this.shaderProgram);
      this.shaderProgram = null;
    }

    if (this.vao) {
      gl.deleteVertexArray(this.vao);
      this.vao = null;
    }

    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
      this.framebuffer = null;
    }

    if (this.voxelizer) {
      this.voxelizer.dispose();
      this.voxelizer = null;
    }

    if (this.irradianceTexture) {
      this.irradianceTexture.dispose();
      this.irradianceTexture = null;
    }

    this.vct = null;
    this.uniforms.clear();
    this.attributes.clear();
    this.isInitialized = false;
    this.isBaking = false;
  }
}

export default LightBaker;
