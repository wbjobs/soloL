import type { ISystem, World } from '../types/ecs';
import type {
  PositionComponent,
  VelocityComponent,
  HeightComponent,
  ErosionLevelComponent,
  ChemicalConcentrationComponent,
} from '../types/ecs';
import { useSimulationStore } from '../store/simulationStore';

export const TERRAIN_SIZE = 10;
export const TERRAIN_RESOLUTION = 64;
const MAX_DELTA_PER_FRAME = 0.005;
const MAX_CHEMICAL_CONCENTRATION = 2.0;

export enum TerrainMaterialType {
  SAND = 0,
  ROCK = 1,
  CLAY = 2,
}

export const MATERIAL_PROPERTIES = {
  [TerrainMaterialType.SAND]: {
    erosionRate: 1.5,
    depositionRate: 0.8,
    color: { r: 0.85, g: 0.75, b: 0.55 },
    name: '沙土',
  },
  [TerrainMaterialType.ROCK]: {
    erosionRate: 0.2,
    depositionRate: 0.1,
    color: { r: 0.45, g: 0.4, b: 0.35 },
    name: '岩石',
  },
  [TerrainMaterialType.CLAY]: {
    erosionRate: 0.8,
    depositionRate: 1.2,
    color: { r: 0.65, g: 0.45, b: 0.35 },
    name: '黏土',
  },
};

export class ErosionSystem implements ISystem {
  name = 'ErosionSystem';
  private heightMap: Float32Array;
  private sedimentMap: Float32Array;
  private normalMap: Float32Array;
  private materialMap: Uint8Array;
  private resolution: number;
  private size: number;
  private tempHeights: Float32Array;
  private tempSediments: Float32Array;

  constructor(resolution: number = TERRAIN_RESOLUTION, size: number = TERRAIN_SIZE) {
    this.resolution = resolution;
    this.size = size;
    this.heightMap = new Float32Array(resolution * resolution);
    this.sedimentMap = new Float32Array(resolution * resolution);
    this.normalMap = new Float32Array(resolution * resolution * 3);
    this.materialMap = new Uint8Array(resolution * resolution);
    this.tempHeights = new Float32Array(resolution * resolution);
    this.tempSediments = new Float32Array(resolution * resolution);
    this.initializeHeightMap();
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  private initializeHeightMap(): void {
    const scale = 4;
    for (let z = 0; z < this.resolution; z++) {
      for (let x = 0; x < this.resolution; x++) {
        const nx = x / this.resolution - 0.5;
        const nz = z / this.resolution - 0.5;
        
        let height = 0;
        height += Math.sin(nx * scale * Math.PI) * Math.cos(nz * scale * Math.PI) * 0.3;
        height += Math.sin(nx * scale * 2 * Math.PI + 1) * Math.cos(nz * scale * 2 * Math.PI + 0.5) * 0.15;
        height += Math.sin(nx * scale * 4 * Math.PI + 2) * Math.cos(nz * scale * 4 * Math.PI + 1) * 0.075;
        
        height += 0.5 - Math.sqrt(nx * nx + nz * nz) * 0.3;
        
        const idx = z * this.resolution + x;
        this.heightMap[idx] = Math.max(0, height);
        this.sedimentMap[idx] = 0;
        
        const distFromCenter = Math.sqrt(nx * nx + nz * nz);
        const noiseVal = Math.sin(nx * 8 + nz * 6) * 0.5 + 0.5;
        if (height > 0.5 || (noiseVal > 0.6 && distFromCenter < 0.3)) {
          this.materialMap[idx] = TerrainMaterialType.ROCK;
        } else if (height < 0.2 || distFromCenter > 0.4) {
          this.materialMap[idx] = TerrainMaterialType.SAND;
        } else {
          this.materialMap[idx] = TerrainMaterialType.CLAY;
        }
      }
    }
    this.updateNormals();
  }

  private updateNormals(): void {
    const step = this.size / this.resolution;
    for (let z = 0; z < this.resolution; z++) {
      for (let x = 0; x < this.resolution; x++) {
        const idx = z * this.resolution + x;
        
        const hL = x > 0 ? this.heightMap[idx - 1] : this.heightMap[idx];
        const hR = x < this.resolution - 1 ? this.heightMap[idx + 1] : this.heightMap[idx];
        const hD = z > 0 ? this.heightMap[idx - this.resolution] : this.heightMap[idx];
        const hU = z < this.resolution - 1 ? this.heightMap[idx + this.resolution] : this.heightMap[idx];
        
        const nx = (hL - hR) / (2 * step);
        const nz = (hD - hU) / (2 * step);
        const ny = 1;
        
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        this.normalMap[idx * 3] = nx / len;
        this.normalMap[idx * 3 + 1] = ny / len;
        this.normalMap[idx * 3 + 2] = nz / len;
      }
    }
  }

  private getHeightAt(worldX: number, worldZ: number): number {
    const halfSize = this.size / 2;
    const x = ((worldX + halfSize) / this.size) * this.resolution;
    const z = ((worldZ + halfSize) / this.size) * this.resolution;
    
    const x0 = Math.floor(Math.max(0, Math.min(this.resolution - 1, x)));
    const z0 = Math.floor(Math.max(0, Math.min(this.resolution - 1, z)));
    const x1 = Math.min(this.resolution - 1, x0 + 1);
    const z1 = Math.min(this.resolution - 1, z0 + 1);
    
    const fx = x - x0;
    const fz = z - z0;
    
    const h00 = this.heightMap[z0 * this.resolution + x0];
    const h10 = this.heightMap[z0 * this.resolution + x1];
    const h01 = this.heightMap[z1 * this.resolution + x0];
    const h11 = this.heightMap[z1 * this.resolution + x1];
    
    return h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) + h01 * (1 - fx) * fz + h11 * fx * fz;
  }

  private setHeightAt(worldX: number, worldZ: number, delta: number): void {
    const halfSize = this.size / 2;
    const x = Math.floor(((worldX + halfSize) / this.size) * this.resolution);
    const z = Math.floor(((worldZ + halfSize) / this.size) * this.resolution);
    
    if (x >= 0 && x < this.resolution && z >= 0 && z < this.resolution) {
      const idx = z * this.resolution + x;
      this.heightMap[idx] = Math.max(0, this.heightMap[idx] + delta);
    }
  }

  private getSedimentAt(worldX: number, worldZ: number): number {
    const halfSize = this.size / 2;
    const x = Math.floor(((worldX + halfSize) / this.size) * this.resolution);
    const z = Math.floor(((worldZ + halfSize) / this.size) * this.resolution);
    
    if (x >= 0 && x < this.resolution && z >= 0 && z < this.resolution) {
      return this.sedimentMap[z * this.resolution + x];
    }
    return 0;
  }

  private setSedimentAt(worldX: number, worldZ: number, delta: number): void {
    const halfSize = this.size / 2;
    const x = Math.floor(((worldX + halfSize) / this.size) * this.resolution);
    const z = Math.floor(((worldZ + halfSize) / this.size) * this.resolution);
    
    if (x >= 0 && x < this.resolution && z >= 0 && z < this.resolution) {
      this.sedimentMap[z * this.resolution + x] = Math.max(0, this.sedimentMap[z * this.resolution + x] + delta);
    }
  }

  private getMaterialAt(worldX: number, worldZ: number): TerrainMaterialType {
    const halfSize = this.size / 2;
    const x = Math.floor(((worldX + halfSize) / this.size) * this.resolution);
    const z = Math.floor(((worldZ + halfSize) / this.size) * this.resolution);
    
    if (x >= 0 && x < this.resolution && z >= 0 && z < this.resolution) {
      return this.materialMap[z * this.resolution + x];
    }
    return TerrainMaterialType.SAND;
  }

  getMaterialMap(): Uint8Array {
    return this.materialMap;
  }

  update(deltaTime: number, world: World): void {
    const params = useSimulationStore.getState();
    if (params.isPaused) return;

    const particleEntities = world.queryEntities([
      'position',
      'velocity',
      'chemicalConcentration',
    ]);

    const dt = Math.min(deltaTime, 0.016);
    const erosionStrength = params.erosionStrength;
    const transportCoeff = params.transportCoefficient;
    const depositionThreshold = params.depositionThreshold;

    this.tempHeights.fill(0);
    this.tempSediments.fill(0);

    for (const entityId of particleEntities) {
      const pos = world.getComponent<PositionComponent>(entityId, 'position');
      const vel = world.getComponent<VelocityComponent>(entityId, 'velocity');
      const chemical = world.getComponent<ChemicalConcentrationComponent>(entityId, 'chemicalConcentration');

      if (!pos || !vel || !chemical) continue;

      const terrainHeight = this.getHeightAt(pos.x, pos.z);
      const speed = Math.sqrt(vel.vx * vel.vx + vel.vz * vel.vz);

      if (pos.y <= terrainHeight + 0.15) {
        const materialType = this.getMaterialAt(pos.x, pos.z);
        const materialProps = MATERIAL_PROPERTIES[materialType];
        
        const dissolution = this.clamp(
          erosionStrength * speed * dt * materialProps.erosionRate,
          0,
          MAX_DELTA_PER_FRAME
        );
        this.addToTempHeight(pos.x, pos.z, -dissolution);
        chemical.value = this.clamp(chemical.value + dissolution * transportCoeff, 0, MAX_CHEMICAL_CONCENTRATION);

        if (speed < depositionThreshold || chemical.value > 1.0) {
          const deposition = this.clamp(
            Math.min(chemical.value * 0.5 * dt * materialProps.depositionRate, chemical.value),
            0,
            MAX_DELTA_PER_FRAME
          );
          this.addToTempSediment(pos.x, pos.z, deposition);
          this.addToTempHeight(pos.x, pos.z, deposition * 0.5);
          chemical.value = Math.max(0, chemical.value - deposition);
        }
      }

      if (speed < 0.1 && pos.y < terrainHeight + 0.05) {
        const deposition = this.clamp(chemical.value * 0.1 * dt, 0, MAX_DELTA_PER_FRAME * 0.5);
        this.addToTempHeight(pos.x, pos.z, deposition);
        chemical.value = Math.max(0, chemical.value - deposition);
      }
    }

    for (let i = 0; i < this.resolution * this.resolution; i++) {
      this.heightMap[i] = this.clamp(this.heightMap[i] + this.tempHeights[i], 0, 3);
      
      if (this.sedimentMap[i] > 0.001) {
        const sedimentTransfer = this.sedimentMap[i] * 0.01 * dt;
        this.heightMap[i] = this.clamp(this.heightMap[i] + sedimentTransfer * 0.3, 0, 3);
        this.sedimentMap[i] = Math.max(0, this.sedimentMap[i] - sedimentTransfer);
      }
      
      this.sedimentMap[i] = this.clamp(this.sedimentMap[i] + this.tempSediments[i], 0, 2);
    }

    this.updateNormals();

    const terrainEntities = world.queryEntities(['position', 'height', 'erosionLevel']);
    for (let i = 0; i < Math.min(terrainEntities.length, this.resolution * this.resolution); i++) {
      const entityId = terrainEntities[i];
      const height = world.getComponent<HeightComponent>(entityId, 'height');
      const erosion = world.getComponent<ErosionLevelComponent>(entityId, 'erosionLevel');
      
      if (height && erosion) {
        height.value = this.heightMap[i];
        height.nx = this.normalMap[i * 3];
        height.ny = this.normalMap[i * 3 + 1];
        height.nz = this.normalMap[i * 3 + 2];
        erosion.value = 1 - (this.heightMap[i] / (this.heightMap[i] + this.sedimentMap[i] + 0.001));
        erosion.sediment = this.sedimentMap[i];
      }
    }
  }

  private addToTempHeight(worldX: number, worldZ: number, delta: number): void {
    const halfSize = this.size / 2;
    const x = Math.floor(((worldX + halfSize) / this.size) * this.resolution);
    const z = Math.floor(((worldZ + halfSize) / this.size) * this.resolution);
    
    if (x >= 0 && x < this.resolution && z >= 0 && z < this.resolution) {
      this.tempHeights[z * this.resolution + x] += delta;
    }
  }

  private addToTempSediment(worldX: number, worldZ: number, delta: number): void {
    const halfSize = this.size / 2;
    const x = Math.floor(((worldX + halfSize) / this.size) * this.resolution);
    const z = Math.floor(((worldZ + halfSize) / this.size) * this.resolution);
    
    if (x >= 0 && x < this.resolution && z >= 0 && z < this.resolution) {
      this.tempSediments[z * this.resolution + x] += delta;
    }
  }

  getHeightMap(): Float32Array {
    return this.heightMap;
  }

  getNormalMap(): Float32Array {
    return this.normalMap;
  }

  getSedimentMap(): Float32Array {
    return this.sedimentMap;
  }

  getResolution(): number {
    return this.resolution;
  }

  getSize(): number {
    return this.size;
  }

  reset(): void {
    this.initializeHeightMap();
  }
}
