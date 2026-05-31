import type { Vec3, VCTConfig, VoxelGridData } from '@/types';
import { vec3, mathUtils } from '@/utils/math';
import { voxelUtils } from '@/utils/voxel';
import { VoxelTexture3D } from './VoxelTexture3D';

export interface ConeTraceResult {
  readonly color: Vec3;
  readonly occlusion: number;
  readonly distance: number;
}

export interface IrradianceResult {
  readonly diffuse: Vec3;
  readonly specular: Vec3;
  readonly ao: number;
}

export interface VCTOptions {
  readonly config?: Partial<VCTConfig>;
  readonly useAnisotropicFiltering?: boolean;
  readonly useTrilinearInterpolation?: boolean;
}

const HEMISPHERE_SAMPLES = [
  [0.0, 0.0, 1.0],
  [0.7071, 0.0, 0.7071],
  [-0.7071, 0.0, 0.7071],
  [0.0, 0.7071, 0.7071],
  [0.0, -0.7071, 0.7071],
  [0.5774, 0.5774, 0.5774],
  [-0.5774, 0.5774, 0.5774],
  [0.5774, -0.5774, 0.5774],
  [-0.5774, -0.5774, 0.5774],
] as const;

const HEMISPHERE_WEIGHTS = [
  1.0 / 6.0,
  1.0 / 6.0,
  1.0 / 6.0,
  1.0 / 6.0,
  1.0 / 6.0,
  1.0 / 24.0,
  1.0 / 24.0,
  1.0 / 24.0,
  1.0 / 24.0,
] as const;

export class VoxelConeTracer {
  private config: VCTConfig;
  private voxelTexture: VoxelTexture3D | null = null;
  private voxelGridData: VoxelGridData | null = null;

  private useAnisotropicFiltering: boolean;
  private useTrilinearInterpolation: boolean;

  private hemisphereDirections: Vec3[] = [];
  private hemisphereWeights: number[] = [];

  constructor(options: VCTOptions = {}) {
    this.config = this.mergeConfig(options.config);
    this.useAnisotropicFiltering = options.useAnisotropicFiltering ?? true;
    this.useTrilinearInterpolation = options.useTrilinearInterpolation ?? true;

    this.initializeHemisphereSamples();
  }

  private mergeConfig(config?: Partial<VCTConfig>): VCTConfig {
    const defaultConfig: VCTConfig = {
      voxelResolution: 128,
      voxelSize: 0.1,
      voxelGridSize: [10, 10, 10],
      voxelGridCenter: [0, 0, 0],
      maxCones: 6,
      coneStepSize: 0.1,
      coneMaxSteps: 64,
      coneAperture: 0.57,
      indirectIntensity: 1.0,
      aoIntensity: 1.0,
    };

    if (!config) return defaultConfig;

    return {
      ...defaultConfig,
      ...config,
    };
  }

  private initializeHemisphereSamples(): void {
    const sampleCount = this.config.maxCones;

    for (let i = 0; i < sampleCount && i < HEMISPHERE_SAMPLES.length; i++) {
      this.hemisphereDirections.push([...HEMISPHERE_SAMPLES[i]] as Vec3);
      this.hemisphereWeights.push(HEMISPHERE_WEIGHTS[i]);
    }

    const weightSum = this.hemisphereWeights.reduce((a, b) => a + b, 0);
    const invSum = 1.0 / weightSum;
    for (let i = 0; i < this.hemisphereWeights.length; i++) {
      this.hemisphereWeights[i] *= invSum;
    }
  }

  public setVoxelTexture(texture: VoxelTexture3D): void {
    this.voxelTexture = texture;
    this.config.voxelResolution = texture.getResolution();
    this.config.voxelGridSize = texture.getSize();
    this.config.voxelGridCenter = texture.getCenter();
  }

  public setVoxelGridData(data: VoxelGridData): void {
    this.voxelGridData = data;
    this.config.voxelResolution = data.resolution;
    this.config.voxelGridSize = data.size;
    this.config.voxelGridCenter = data.center;
  }

  public worldToVoxel(worldPos: Vec3): Vec3 {
    return voxelUtils.worldToVoxel(
      worldPos,
      this.config.voxelGridCenter,
      this.config.voxelGridSize,
      this.config.voxelResolution
    );
  }

  public voxelToWorld(voxelPos: Vec3): Vec3 {
    return voxelUtils.voxelToWorld(
      voxelPos,
      this.config.voxelGridCenter,
      this.config.voxelGridSize,
      this.config.voxelResolution
    );
  }

  public sampleVoxel(
    voxelPos: Vec3,
    direction?: Vec3
  ): [number, number, number, number] {
    if (this.voxelGridData) {
      if (this.useTrilinearInterpolation) {
        const sample = voxelUtils.sampleVoxelTrilinear(
          this.voxelGridData.data,
          this.config.voxelResolution,
          voxelPos
        );
        if (sample) return sample;
      } else {
        const sample = voxelUtils.getVoxel(
          this.voxelGridData.data,
          this.config.voxelResolution,
          [Math.floor(voxelPos[0]), Math.floor(voxelPos[1]), Math.floor(voxelPos[2])]
        );
        if (sample) return sample;
      }
    }

    return [0, 0, 0, 0];
  }

  public sampleVoxelAnisotropic(
    voxelPos: Vec3,
    direction: Vec3
  ): [number, number, number, number] {
    if (!this.useAnisotropicFiltering || !this.voxelTexture) {
      return this.sampleVoxel(voxelPos, direction);
    }

    const absDir = vec3.abs(direction);
    const maxComp = Math.max(absDir[0], Math.max(absDir[1], absDir[2]));

    if (maxComp === 0) {
      return this.sampleVoxel(voxelPos, direction);
    }

    let footprint: Vec3;
    if (absDir[0] === maxComp) {
      footprint = [1, absDir[1] / absDir[0], absDir[2] / absDir[0]];
    } else if (absDir[1] === maxComp) {
      footprint = [absDir[0] / absDir[1], 1, absDir[2] / absDir[1]];
    } else {
      footprint = [absDir[0] / absDir[2], absDir[1] / absDir[2], 1];
    }

    footprint = vec3.clamp(vec3.mul(footprint, 0.5), 0.5, 2);

    const mipLevel = vec3.create(
      Math.log2(footprint[0]),
      Math.log2(footprint[1]),
      Math.log2(footprint[2])
    );
    const mip = Math.max(mipLevel[0], Math.max(mipLevel[1], mipLevel[2]));

    const baseCoord = vec3.sub(voxelPos, [0.5, 0.5, 0.5]);
    const sample0 = this.sampleVoxelAtMip(baseCoord, Math.floor(mip));
    const sample1 = this.sampleVoxelAtMip(baseCoord, Math.ceil(mip));
    const t = mathUtils.fract(mip);

    return [
      mathUtils.lerp(sample0[0], sample1[0], t),
      mathUtils.lerp(sample0[1], sample1[1], t),
      mathUtils.lerp(sample0[2], sample1[2], t),
      mathUtils.lerp(sample0[3], sample1[3], t),
    ];
  }

  private sampleVoxelAtMip(
    voxelPos: Vec3,
    mipLevel: number
  ): [number, number, number, number] {
    if (!this.voxelGridData) return [0, 0, 0, 0];

    const mipScale = Math.pow(2, Math.max(0, mipLevel));
    const mipResolution = Math.max(1, Math.floor(this.config.voxelResolution / mipScale));
    const mipPos = vec3.div(voxelPos, mipScale);

    const x = Math.floor(mipPos[0]);
    const y = Math.floor(mipPos[1]);
    const z = Math.floor(mipPos[2]);

    if (x < 0 || x >= mipResolution || y < 0 || y >= mipResolution || z < 0 || z >= mipResolution) {
      return [0, 0, 0, 0];
    }

    const srcData = this.voxelGridData.data;
    const srcResolution = this.config.voxelResolution;
    const channels = srcData.length / (srcResolution * srcResolution * srcResolution);

    const blockSize = Math.floor(mipScale);
    let r = 0, g = 0, b = 0, a = 0;
    let count = 0;

    for (let dz = 0; dz < blockSize; dz++) {
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const sx = x * blockSize + dx;
          const sy = y * blockSize + dy;
          const sz = z * blockSize + dz;

          if (sx < srcResolution && sy < srcResolution && sz < srcResolution) {
            const idx = (sx + sy * srcResolution + sz * srcResolution * srcResolution) * channels;
            if (srcData instanceof Uint8Array) {
              r += srcData[idx];
              g += srcData[idx + 1];
              b += srcData[idx + 2];
              a += srcData[idx + 3];
            } else {
              r += srcData[idx] * 255;
              g += srcData[idx + 1] * 255;
              b += srcData[idx + 2] * 255;
              a += srcData[idx + 3] * 255;
            }
            count++;
          }
        }
      }
    }

    if (count === 0) return [0, 0, 0, 0];

    const invCount = 1 / count;
    return [r * invCount, g * invCount, b * invCount, a * invCount];
  }

  public coneTrace(
    origin: Vec3,
    direction: Vec3,
    aperture?: number
  ): ConeTraceResult {
    const { coneStepSize, coneMaxSteps, coneAperture } = this.config;
    const actualAperture = aperture ?? coneAperture;

    const voxelOrigin = this.worldToVoxel(origin);
    const normDir = vec3.normalize(direction);

    let accColor: Vec3 = [0, 0, 0];
    let accAlpha = 0;
    let hitDistance = Infinity;

    let stepSize = coneStepSize;
    let dist = stepSize * 0.5;

    for (let i = 0; i < coneMaxSteps && accAlpha < 0.95; i++) {
      const coneRadius = dist * Math.tan(actualAperture * 0.5);
      const samplePos = vec3.add(voxelOrigin, vec3.mul(normDir, dist));

      const voxelSample = this.sampleVoxelAnisotropic(samplePos, normDir);

      if (voxelSample[3] > 0.001) {
        const sampleColor: Vec3 = [
          (voxelSample[0] / 255) * (voxelSample[3] / 255),
          (voxelSample[1] / 255) * (voxelSample[3] / 255),
          (voxelSample[2] / 255) * (voxelSample[3] / 255),
        ];
        const sampleAlpha = voxelSample[3] / 255;
        const weight = sampleAlpha * (1 - accAlpha);

        accColor = vec3.add(accColor, vec3.mul(sampleColor, weight));
        accAlpha += weight;

        if (hitDistance === Infinity && sampleAlpha > 0.5) {
          hitDistance = dist;
        }
      }

      dist += Math.max(stepSize, coneRadius * 2);
    }

    return {
      color: accColor,
      occlusion: accAlpha,
      distance: hitDistance,
    };
  }

  public traceHemisphereCones(
    position: Vec3,
    normal: Vec3
  ): { readonly irradiance: Vec3; readonly ao: number } {
    const origin = vec3.add(position, vec3.mul(normal, 0.02));
    const sampleCount = this.config.maxCones;

    let totalIrradiance: Vec3 = [0, 0, 0];
    let totalAO = 0;

    for (let i = 0; i < sampleCount; i++) {
      const localDir = this.hemisphereDirections[i];
      const weight = this.hemisphereWeights[i];

      const worldDir = this.transformHemisphereDirection(localDir, normal);
      const ndotd = Math.max(vec3.dot(normal, worldDir), 0);

      if (ndotd > 0.001) {
        const coneResult = this.coneTrace(origin, worldDir);

        totalIrradiance = vec3.add(
          totalIrradiance,
          vec3.mul(coneResult.color, ndotd * weight)
        );
        totalAO += coneResult.occlusion * ndotd * weight;
      }
    }

    return {
      irradiance: vec3.mul(totalIrradiance, this.config.indirectIntensity),
      ao: 1 - totalAO * this.config.aoIntensity,
    };
  }

  private transformHemisphereDirection(
    localDir: Vec3,
    normal: Vec3
  ): Vec3 {
    const tangent = vec3.normalize(
      vec3.cross(
        normal,
        Math.abs(normal[1]) < 0.999 ? [0, 1, 0] : [1, 0, 0]
      )
    );
    const bitangent = vec3.cross(normal, tangent);

    return vec3.normalize([
      tangent[0] * localDir[0] + bitangent[0] * localDir[1] + normal[0] * localDir[2],
      tangent[1] * localDir[0] + bitangent[1] * localDir[1] + normal[1] * localDir[2],
      tangent[2] * localDir[0] + bitangent[2] * localDir[1] + normal[2] * localDir[2],
    ]);
  }

  public computeIrradiance(
    position: Vec3,
    normal: Vec3,
    albedo: Vec3
  ): IrradianceResult {
    const { irradiance, ao } = this.traceHemisphereCones(position, normal);

    const diffuse: Vec3 = [
      irradiance[0] * albedo[0],
      irradiance[1] * albedo[1],
      irradiance[2] * albedo[2],
    ];

    const reflectionDir = vec3.reflect(vec3.negate(normal), normal);
    const specularResult = this.coneTrace(
      vec3.add(position, vec3.mul(normal, 0.02)),
      reflectionDir,
      0.1
    );

    const specular: Vec3 = [
      specularResult.color[0] * 0.5,
      specularResult.color[1] * 0.5,
      specularResult.color[2] * 0.5,
    ];

    return {
      diffuse,
      specular,
      ao,
    };
  }

  public computeAmbientOcclusion(
    position: Vec3,
    normal: Vec3,
    sampleCount?: number
  ): number {
    const origin = vec3.add(position, vec3.mul(normal, 0.02));
    const count = sampleCount ?? this.config.maxCones;

    let totalOcclusion = 0;
    let totalWeight = 0;

    for (let i = 0; i < count && i < this.hemisphereDirections.length; i++) {
      const localDir = this.hemisphereDirections[i];
      const worldDir = this.transformHemisphereDirection(localDir, normal);
      const ndotd = Math.max(vec3.dot(normal, worldDir), 0);

      if (ndotd > 0.001) {
        const result = this.coneTrace(origin, worldDir, 0.3);
        totalOcclusion += result.occlusion * ndotd;
        totalWeight += ndotd;
      }
    }

    if (totalWeight === 0) return 1;

    return 1 - (totalOcclusion / totalWeight) * this.config.aoIntensity;
  }

  public getConfig(): VCTConfig {
    return { ...this.config };
  }

  public setConfig(config: Partial<VCTConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.maxCones !== undefined) {
      this.hemisphereDirections = [];
      this.hemisphereWeights = [];
      this.initializeHemisphereSamples();
    }
  }

  public setAnisotropicFiltering(enabled: boolean): void {
    this.useAnisotropicFiltering = enabled;
  }

  public setTrilinearInterpolation(enabled: boolean): void {
    this.useTrilinearInterpolation = enabled;
  }

  public getHemisphereSampleCount(): number {
    return this.hemisphereDirections.length;
  }

  public getHemisphereDirection(index: number): Vec3 | null {
    if (index < 0 || index >= this.hemisphereDirections.length) return null;
    return [...this.hemisphereDirections[index]];
  }
}

export default VoxelConeTracer;
