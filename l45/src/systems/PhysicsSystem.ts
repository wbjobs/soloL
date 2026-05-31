import type { ISystem, World } from '../types/ecs';
import type {
  PositionComponent,
  VelocityComponent,
} from '../types/ecs';
import { useSimulationStore } from '../store/simulationStore';

const BOUNDARY_MIN = { x: -5, y: 0, z: -5 };
const BOUNDARY_MAX = { x: 5, y: 10, z: 5 };
const SUBSTEPS = 4;

export class PhysicsSystem implements ISystem {
  name = 'PhysicsSystem';
  private particlePositions: Float32Array;
  private particleVelocities: Float32Array;
  private particleDensities: Float32Array;
  private particlePressures: Float32Array;
  private forces: Float32Array;
  private maxParticles: number;
  private gridMap: Map<string, number[]>;
  private cellSize: number;
  private currentParticleCount: number = 0;

  constructor(maxParticles: number = 5000, smoothingRadius: number = 0.15) {
    this.maxParticles = maxParticles;
    this.cellSize = smoothingRadius * 2;
    this.particlePositions = new Float32Array(maxParticles * 3);
    this.particleVelocities = new Float32Array(maxParticles * 3);
    this.particleDensities = new Float32Array(maxParticles);
    this.particlePressures = new Float32Array(maxParticles);
    this.forces = new Float32Array(maxParticles * 3);
    this.gridMap = new Map();
  }

  private getGridKey(x: number, y: number, z: number): string {
    const gx = Math.floor(x / this.cellSize);
    const gy = Math.floor(y / this.cellSize);
    const gz = Math.floor(z / this.cellSize);
    return `${gx},${gy},${gz}`;
  }

  private buildSpatialGrid(particleCount: number): void {
    this.gridMap.clear();
    for (let i = 0; i < particleCount; i++) {
      const key = this.getGridKey(
        this.particlePositions[i * 3],
        this.particlePositions[i * 3 + 1],
        this.particlePositions[i * 3 + 2]
      );
      const cell = this.gridMap.get(key);
      if (cell) {
        cell.push(i);
      } else {
        this.gridMap.set(key, [i]);
      }
    }
  }

  private getNeighbors(i: number): number[] {
    const neighbors: number[] = [];
    const x = this.particlePositions[i * 3];
    const y = this.particlePositions[i * 3 + 1];
    const z = this.particlePositions[i * 3 + 2];
    const h = this.cellSize;

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = this.getGridKey(x + dx * h, y + dy * h, z + dz * h);
          const cell = this.gridMap.get(key);
          if (cell) {
            for (const j of cell) {
              if (j !== i) {
                const dx2 = this.particlePositions[j * 3] - x;
                const dy2 = this.particlePositions[j * 3 + 1] - y;
                const dz2 = this.particlePositions[j * 3 + 2] - z;
                const distSq = dx2 * dx2 + dy2 * dy2 + dz2 * dz2;
                if (distSq < h * h) {
                  neighbors.push(j);
                }
              }
            }
          }
        }
      }
    }
    return neighbors;
  }

  private poly6Kernel(r: number, h: number): number {
    if (r > h) return 0;
    const factor = 315 / (64 * Math.PI * Math.pow(h, 9));
    const diff = h * h - r * r;
    return factor * diff * diff * diff;
  }

  private spikyKernelGradient(r: number, h: number): number {
    if (r > h || r < 0.0001) return 0;
    const diff = h - r;
    const factor = -45 / (Math.PI * Math.pow(h, 6));
    return factor * diff * diff;
  }

  private viscosityKernelLaplacian(r: number, h: number): number {
    if (r > h) return 0;
    const factor = 45 / (Math.PI * Math.pow(h, 6));
    return factor * (h - r);
  }

  private clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  update(deltaTime: number, world: World): void {
    const params = useSimulationStore.getState();
    if (params.isPaused) return;

    const particleEntities = world.queryEntities([
      'position',
      'velocity',
      'mass',
      'chemicalConcentration',
    ]);

    const particleCount = Math.min(particleEntities.length, this.maxParticles);
    this.currentParticleCount = particleCount;
    useSimulationStore.getState().setParticleCount(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const pos = world.getComponent<PositionComponent>(particleEntities[i], 'position');
      const vel = world.getComponent<VelocityComponent>(particleEntities[i], 'velocity');
      if (pos && vel) {
        this.particlePositions[i * 3] = pos.x;
        this.particlePositions[i * 3 + 1] = pos.y;
        this.particlePositions[i * 3 + 2] = pos.z;
        this.particleVelocities[i * 3] = vel.vx;
        this.particleVelocities[i * 3 + 1] = vel.vy;
        this.particleVelocities[i * 3 + 2] = vel.vz;
      }
    }

    const baseDt = Math.min(deltaTime, 0.02);
    const subDt = baseDt / SUBSTEPS;

    for (let step = 0; step < SUBSTEPS; step++) {
      this.buildSpatialGrid(particleCount);
      const h = params.smoothingRadius;

      for (let i = 0; i < particleCount; i++) {
        const neighbors = this.getNeighbors(i);
        let density = 0;

        for (let j = 0; j < neighbors.length; j++) {
          const neighborIdx = neighbors[j];
          const dx = this.particlePositions[neighborIdx * 3] - this.particlePositions[i * 3];
          const dy = this.particlePositions[neighborIdx * 3 + 1] - this.particlePositions[i * 3 + 1];
          const dz = this.particlePositions[neighborIdx * 3 + 2] - this.particlePositions[i * 3 + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          density += params.particleMass * this.poly6Kernel(dist, h);
        }
        this.particleDensities[i] = this.clamp(density, params.restDensity * 0.5, params.restDensity * 3);
        this.particlePressures[i] = this.clamp(
          params.restDensity * 100 * (density / params.restDensity - 1),
          -5000, 5000
        );
      }

      for (let i = 0; i < particleCount; i++) {
        const neighbors = this.getNeighbors(i);
        let fx = 0, fy = params.gravity, fz = 0;

        for (let j = 0; j < neighbors.length; j++) {
          const neighborIdx = neighbors[j];
          const dx = this.particlePositions[neighborIdx * 3] - this.particlePositions[i * 3];
          const dy = this.particlePositions[neighborIdx * 3 + 1] - this.particlePositions[i * 3 + 1];
          const dz = this.particlePositions[neighborIdx * 3 + 2] - this.particlePositions[i * 3 + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

          if (dist < 0.0001) continue;

          const pressureForce =
            ((this.particlePressures[i] + this.particlePressures[neighborIdx]) /
              (2 * this.particleDensities[neighborIdx] + 0.001)) *
            params.particleMass *
            this.spikyKernelGradient(dist, h);

          const invDist = 1 / dist;
          fx -= dx * invDist * pressureForce;
          fy -= dy * invDist * pressureForce;
          fz -= dz * invDist * pressureForce;

          const viscosityForce =
            params.viscosity *
            params.particleMass *
            this.viscosityKernelLaplacian(dist, h) /
            (this.particleDensities[neighborIdx] + 0.001);

          fx += (this.particleVelocities[neighborIdx * 3] - this.particleVelocities[i * 3]) * viscosityForce;
          fy += (this.particleVelocities[neighborIdx * 3 + 1] - this.particleVelocities[i * 3 + 1]) * viscosityForce;
          fz += (this.particleVelocities[neighborIdx * 3 + 2] - this.particleVelocities[i * 3 + 2]) * viscosityForce;
        }

        this.forces[i * 3] = this.clamp(fx, -1000, 1000);
        this.forces[i * 3 + 1] = this.clamp(fy, -1000, 1000);
        this.forces[i * 3 + 2] = this.clamp(fz, -1000, 1000);
      }

      for (let i = 0; i < particleCount; i++) {
        const densityFactor = 1 / (this.particleDensities[i] + 0.001);

        this.particleVelocities[i * 3] += this.forces[i * 3] * subDt * densityFactor;
        this.particleVelocities[i * 3 + 1] += this.forces[i * 3 + 1] * subDt * densityFactor;
        this.particleVelocities[i * 3 + 2] += this.forces[i * 3 + 2] * subDt * densityFactor;

        const speedSq =
          this.particleVelocities[i * 3] ** 2 +
          this.particleVelocities[i * 3 + 1] ** 2 +
          this.particleVelocities[i * 3 + 2] ** 2;
        const maxSpeed = 15;
        if (speedSq > maxSpeed * maxSpeed) {
          const scale = maxSpeed / Math.sqrt(speedSq);
          this.particleVelocities[i * 3] *= scale;
          this.particleVelocities[i * 3 + 1] *= scale;
          this.particleVelocities[i * 3 + 2] *= scale;
        }

        this.particlePositions[i * 3] += this.particleVelocities[i * 3] * subDt;
        this.particlePositions[i * 3 + 1] += this.particleVelocities[i * 3 + 1] * subDt;
        this.particlePositions[i * 3 + 2] += this.particleVelocities[i * 3 + 2] * subDt;

        const restitution = 0.3;
        const friction = 0.05;

        if (this.particlePositions[i * 3] < BOUNDARY_MIN.x) {
          this.particlePositions[i * 3] = BOUNDARY_MIN.x;
          this.particleVelocities[i * 3] *= -restitution;
        }
        if (this.particlePositions[i * 3] > BOUNDARY_MAX.x) {
          this.particlePositions[i * 3] = BOUNDARY_MAX.x;
          this.particleVelocities[i * 3] *= -restitution;
        }
        if (this.particlePositions[i * 3 + 1] < BOUNDARY_MIN.y) {
          this.particlePositions[i * 3 + 1] = BOUNDARY_MIN.y;
          this.particleVelocities[i * 3 + 1] *= -restitution;
          this.particleVelocities[i * 3] *= (1 - friction);
          this.particleVelocities[i * 3 + 2] *= (1 - friction);
        }
        if (this.particlePositions[i * 3 + 1] > BOUNDARY_MAX.y) {
          this.particlePositions[i * 3 + 1] = BOUNDARY_MAX.y;
          this.particleVelocities[i * 3 + 1] *= -restitution;
        }
        if (this.particlePositions[i * 3 + 2] < BOUNDARY_MIN.z) {
          this.particlePositions[i * 3 + 2] = BOUNDARY_MIN.z;
          this.particleVelocities[i * 3 + 2] *= -restitution;
        }
        if (this.particlePositions[i * 3 + 2] > BOUNDARY_MAX.z) {
          this.particlePositions[i * 3 + 2] = BOUNDARY_MAX.z;
          this.particleVelocities[i * 3 + 2] *= -restitution;
        }
      }
    }

    for (let i = 0; i < particleCount; i++) {
      const pos = world.getComponent<PositionComponent>(particleEntities[i], 'position');
      const vel = world.getComponent<VelocityComponent>(particleEntities[i], 'velocity');
      if (pos && vel) {
        pos.x = this.particlePositions[i * 3];
        pos.y = this.particlePositions[i * 3 + 1];
        pos.z = this.particlePositions[i * 3 + 2];
        vel.vx = this.particleVelocities[i * 3];
        vel.vy = this.particleVelocities[i * 3 + 1];
        vel.vz = this.particleVelocities[i * 3 + 2];
      }
    }
  }

  getParticlePositions(): Float32Array {
    return this.particlePositions;
  }

  getCurrentParticleCount(): number {
    return this.currentParticleCount;
  }
}
