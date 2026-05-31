import { World } from './World';
import { PhysicsSystem } from '../systems/PhysicsSystem';
import { ErosionSystem } from '../systems/ErosionSystem';
import { useSimulationStore } from '../store/simulationStore';
import type {
  PositionComponent,
  VelocityComponent,
  MassComponent,
  ChemicalConcentrationComponent,
  HeightComponent,
  ErosionLevelComponent,
} from '../types/ecs';

export class SimulationManager {
  world: World;
  physicsSystem: PhysicsSystem;
  erosionSystem: ErosionSystem;
  private lastTime: number = 0;
  private emissionAccumulator: number = 0;
  private isRunning: boolean = false;
  private animationFrameId: number | null = null;

  constructor() {
    this.world = new World();
    this.physicsSystem = new PhysicsSystem(5000, 0.15);
    this.erosionSystem = new ErosionSystem();

    this.world.addSystem(this.physicsSystem);
    this.world.addSystem(this.erosionSystem);

    this.initializeTerrain();
  }

  private initializeTerrain(): void {
    const resolution = this.erosionSystem.getResolution();
    const size = this.erosionSystem.getSize();
    const heightMap = this.erosionSystem.getHeightMap();

    for (let z = 0; z < resolution; z++) {
      for (let x = 0; x < resolution; x++) {
        const entityId = this.world.createEntity();
        const worldX = (x / resolution - 0.5) * size;
        const worldZ = (z / resolution - 0.5) * size;
        const idx = z * resolution + x;

        this.world.addComponent(entityId, 'position', {
          x: worldX,
          y: heightMap[idx],
          z: worldZ,
        } as PositionComponent);

        this.world.addComponent(entityId, 'height', {
          value: heightMap[idx],
          nx: 0,
          ny: 1,
          nz: 0,
        } as HeightComponent);

        this.world.addComponent(entityId, 'erosionLevel', {
          value: 0,
          sediment: 0,
        } as ErosionLevelComponent);
      }
    }
  }

  emitParticle(): void {
    const params = useSimulationStore.getState();
    const particleEntities = this.world.queryEntities([
      'position',
      'velocity',
      'mass',
      'chemicalConcentration',
    ]);

    if (particleEntities.length >= params.maxParticles) return;

    const entityId = this.world.createEntity();

    const spawnX = (Math.random() - 0.5) * 2;
    const spawnZ = (Math.random() - 0.5) * 2;

    this.world.addComponent(entityId, 'position', {
      x: spawnX,
      y: 3 + Math.random() * 0.5,
      z: spawnZ - 3,
    } as PositionComponent);

    this.world.addComponent(entityId, 'velocity', {
      vx: (Math.random() - 0.5) * 0.5,
      vy: -1 - Math.random() * 0.5,
      vz: 2 + Math.random() * 0.5,
    } as VelocityComponent);

    this.world.addComponent(entityId, 'mass', {
      value: params.particleMass,
    } as MassComponent);

    this.world.addComponent(entityId, 'chemicalConcentration', {
      value: 0,
    } as ChemicalConcentrationComponent);
  }

  private removeOldParticles(): void {
    const particleEntities = this.world.queryEntities([
      'position',
      'velocity',
      'mass',
      'chemicalConcentration',
    ]);

    const toRemove: number[] = [];
    for (const entityId of particleEntities) {
      const pos = this.world.getComponent<PositionComponent>(entityId, 'position');
      const vel = this.world.getComponent<VelocityComponent>(entityId, 'velocity');
      
      if (pos && vel) {
        const speed = Math.sqrt(vel.vx * vel.vx + vel.vy * vel.vy + vel.vz * vel.vz);
        if (pos.y < 0.01 && speed < 0.01) {
          toRemove.push(entityId);
        }
      }
    }

    for (const entityId of toRemove) {
      this.world.removeEntity(entityId);
    }
  }

  update(currentTime: number): void {
    const params = useSimulationStore.getState();
    const deltaTime = Math.min((currentTime - this.lastTime) / 1000, 0.033);
    this.lastTime = currentTime;

    if (params.isPaused) return;

    this.emissionAccumulator += params.emissionRate * deltaTime;
    while (this.emissionAccumulator >= 1) {
      this.emitParticle();
      this.emissionAccumulator -= 1;
    }

    this.world.update(deltaTime);
    this.removeOldParticles();

    const fps = 1 / deltaTime;
    useSimulationStore.getState().setFps(Math.round(fps));
  }

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.lastTime = performance.now();

    const loop = () => {
      if (!this.isRunning) return;
      const currentTime = performance.now();
      this.update(currentTime);
      this.animationFrameId = requestAnimationFrame(loop);
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  reset(): void {
    const wasRunning = this.isRunning;
    this.stop();

    const particleEntities = this.world.queryEntities([
      'position',
      'velocity',
      'mass',
      'chemicalConcentration',
    ]);
    for (const entityId of particleEntities) {
      this.world.removeEntity(entityId);
    }

    this.erosionSystem.reset();
    useSimulationStore.getState().reset();
    this.emissionAccumulator = 0;

    if (wasRunning) {
      this.start();
    }
  }

  getHeightMap(): Float32Array {
    return this.erosionSystem.getHeightMap();
  }

  getNormalMap(): Float32Array {
    return this.erosionSystem.getNormalMap();
  }

  getSedimentMap(): Float32Array {
    return this.erosionSystem.getSedimentMap();
  }

  getMaterialMap(): Uint8Array {
    return this.erosionSystem.getMaterialMap();
  }

  getTerrainResolution(): number {
    return this.erosionSystem.getResolution();
  }

  getTerrainSize(): number {
    return this.erosionSystem.getSize();
  }

  getParticlePositions(): Float32Array {
    return this.physicsSystem.getParticlePositions();
  }

  getParticleCount(): number {
    return useSimulationStore.getState().particleCount;
  }
}

let simulationManagerInstance: SimulationManager | null = null;

export function getSimulationManager(): SimulationManager {
  if (!simulationManagerInstance) {
    simulationManagerInstance = new SimulationManager();
  }
  return simulationManagerInstance;
}
