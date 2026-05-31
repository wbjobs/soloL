import { SPHParams } from '@/types/sph';
import { gridShader, densityShader, forceShader, integrateShader, sortShader, forceFeedbackShader } from '@/shaders/sphShaders';

const PARTICLES_PER_BLOCK = 10000;
const MAX_PARTICLES_PER_CELL = 128;
const MAX_OBSTACLES = 32;

interface BufferBlock {
  positions: GPUBuffer;
  velocities: GPUBuffer;
  densities: GPUBuffer;
  forces: GPUBuffer;
  particleCount: number;
}

interface MappedReadbackBlock {
  positions: Float32Array;
  velocities: Float32Array;
  mapped: boolean;
}

export interface ForceFeedbackResult {
  forceX: number;
  forceY: number;
  forceZ: number;
  torqueX: number;
  torqueY: number;
  torqueZ: number;
}

export class SPHEngine {
  private device: GPUDevice | null = null;
  private paramsBuffer: GPUBuffer | null = null;
  
  private blocks: BufferBlock[] = [];
  private mappedBlocks: MappedReadbackBlock[] = [];
  private stagingBuffer: GPUBuffer | null = null;
  private stagingData: Float32Array | null = null;
  
  private obstaclesBuffer: GPUBuffer | null = null;
  private forceFeedbackBuffer: GPUBuffer | null = null;
  private forceFeedbackStagingBuffer: GPUBuffer | null = null;
  
  private gridCellsBuffer: GPUBuffer | null = null;
  private gridCountsBuffer: GPUBuffer | null = null;
  private gridCountsTempBuffer: GPUBuffer | null = null;
  private gridPrefixSumBuffer: GPUBuffer | null = null;
  
  private clearGridPipeline: GPUComputePipeline | null = null;
  private countPipeline: GPUComputePipeline | null = null;
  private sortPipeline: GPUComputePipeline | null = null;
  private densityPipeline: GPUComputePipeline | null = null;
  private forcePipeline: GPUComputePipeline | null = null;
  private integratePipeline: GPUComputePipeline | null = null;
  private forceFeedbackPipeline: GPUComputePipeline | null = null;
  
  private clearGridBindGroups: GPUBindGroup[] = [];
  private countBindGroups: GPUBindGroup[] = [];
  private sortBindGroups: GPUBindGroup[] = [];
  private densityBindGroups: GPUBindGroup[] = [];
  private forceBindGroups: GPUBindGroup[] = [];
  private integrateBindGroups: GPUBindGroup[] = [];
  private forceFeedbackBindGroups: GPUBindGroup[] = [];
  
  private totalParticles: number;
  private blockCount: number;
  private gridResolution: number = 64;
  private gridCellCount: number = 0;
  private obstacleCount: number = 0;
  
  private workgroupSize: number = 256;
  private initialized: boolean = false;
  private readbackPending: boolean = false;
  private forceFeedbackPending: boolean = false;
  private frameCounter: number = 0;
  
  constructor(particleCount: number = 100000) {
    this.totalParticles = particleCount;
    this.blockCount = Math.ceil(particleCount / PARTICLES_PER_BLOCK);
  }
  
  async init(): Promise<boolean> {
    if (!navigator.gpu) {
      console.error('WebGPU not supported');
      return false;
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      console.error('Failed to get GPU adapter');
      return false;
    }
    
    this.device = await adapter.requestDevice();
    if (!this.device) {
      console.error('Failed to get GPU device');
      return false;
    }
    
    this.gridCellCount = this.gridResolution * this.gridResolution * this.gridResolution;
    
    await this.createBuffers();
    await this.createPipelines();
    await this.createBindGroups();
    await this.initializeParticles();
    
    this.initialized = true;
    return true;
  }
  
  private createBuffer(size: number, usage: number): GPUBuffer {
    return this.device!.createBuffer({
      size: Math.ceil(size / 256) * 256,
      usage,
      mappedAtCreation: false,
    });
  }
  
  private createMappedBuffer(size: number): { buffer: GPUBuffer; data: Float32Array } {
    const alignedSize = Math.ceil(size / 256) * 256;
    const buffer = this.device!.createBuffer({
      size: alignedSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
      mappedAtCreation: false,
    });
    const data = new Float32Array(alignedSize / 4);
    return { buffer, data };
  }
  
  private createBuffers(): void {
    const d = this.device!;
    
    for (let i = 0; i < this.blockCount; i++) {
      const blockParticles = Math.min(PARTICLES_PER_BLOCK, this.totalParticles - i * PARTICLES_PER_BLOCK);
      
      this.blocks.push({
        positions: this.createBuffer(blockParticles * 16, 
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC),
        velocities: this.createBuffer(blockParticles * 16,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC),
        densities: this.createBuffer(blockParticles * 4,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
        forces: this.createBuffer(blockParticles * 12,
          GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST),
        particleCount: blockParticles,
      });
      
      this.mappedBlocks.push({
        positions: new Float32Array(blockParticles * 4),
        velocities: new Float32Array(blockParticles * 4),
        mapped: false,
      });
    }
    
    const totalSize = this.totalParticles * 16 * 2;
    this.stagingBuffer = this.createBuffer(totalSize, 
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST);
    this.stagingData = new Float32Array(totalSize / 4);
    
    this.obstaclesBuffer = this.createBuffer(
      MAX_OBSTACLES * 48,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    
    this.forceFeedbackBuffer = this.createBuffer(
      MAX_OBSTACLES * 32,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );
    
    this.forceFeedbackStagingBuffer = this.createBuffer(
      MAX_OBSTACLES * 32,
      GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    );
    
    this.gridCellsBuffer = this.createBuffer(
      this.gridCellCount * MAX_PARTICLES_PER_CELL * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    
    this.gridCountsBuffer = this.createBuffer(
      this.gridCellCount * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    
    this.gridCountsTempBuffer = this.createBuffer(
      this.gridCellCount * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    );
    
    this.gridPrefixSumBuffer = this.createBuffer(
      this.gridCellCount * 4,
      GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    );
    
    this.paramsBuffer = this.createBuffer(256, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
  }
  
  private createComputePipeline(code: string, entryPoint: string): GPUComputePipeline {
    const module = this.device!.createShaderModule({ code });
    return this.device!.createComputePipeline({
      layout: 'auto',
      compute: { module, entryPoint },
    });
  }
  
  private createPipelines(): void {
    this.clearGridPipeline = this.createComputePipeline(gridShader, 'clearGrid');
    this.countPipeline = this.createComputePipeline(gridShader, 'countParticles');
    this.sortPipeline = this.createComputePipeline(sortShader, 'sortParticles');
    this.densityPipeline = this.createComputePipeline(densityShader, 'computeDensity');
    this.forcePipeline = this.createComputePipeline(forceShader, 'computeForces');
    this.integratePipeline = this.createComputePipeline(integrateShader, 'integrate');
    this.forceFeedbackPipeline = this.createComputePipeline(forceFeedbackShader, 'computeForceFeedback');
  }
  
  private createBindGroups(): void {
    const d = this.device!;
    
    for (let i = 0; i < this.blockCount; i++) {
      const block = this.blocks[i];
      
      this.clearGridBindGroups.push(d.createBindGroup({
        layout: this.clearGridPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer! } },
          { binding: 1, resource: { buffer: block.positions } },
          { binding: 2, resource: { buffer: this.gridCountsTempBuffer! } },
        ],
      }));
      
      this.countBindGroups.push(d.createBindGroup({
        layout: this.countPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer! } },
          { binding: 1, resource: { buffer: block.positions } },
          { binding: 2, resource: { buffer: this.gridCountsTempBuffer! } },
        ],
      }));
      
      this.sortBindGroups.push(d.createBindGroup({
        layout: this.sortPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer! } },
          { binding: 1, resource: { buffer: block.positions } },
          { binding: 2, resource: { buffer: this.gridCellsBuffer! } },
          { binding: 3, resource: { buffer: this.gridCountsTempBuffer! } },
        ],
      }));
      
      this.densityBindGroups.push(d.createBindGroup({
        layout: this.densityPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer! } },
          { binding: 1, resource: { buffer: block.positions } },
          { binding: 2, resource: { buffer: block.densities } },
          { binding: 3, resource: { buffer: this.gridCellsBuffer! } },
          { binding: 4, resource: { buffer: this.gridCountsBuffer! } },
        ],
      }));
      
      this.forceBindGroups.push(d.createBindGroup({
        layout: this.forcePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer! } },
          { binding: 1, resource: { buffer: block.positions } },
          { binding: 2, resource: { buffer: block.velocities } },
          { binding: 3, resource: { buffer: block.densities } },
          { binding: 4, resource: { buffer: block.forces } },
          { binding: 5, resource: { buffer: this.gridCellsBuffer! } },
          { binding: 6, resource: { buffer: this.gridCountsBuffer! } },
        ],
      }));
      
      this.integrateBindGroups.push(d.createBindGroup({
        layout: this.integratePipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer! } },
          { binding: 1, resource: { buffer: block.positions } },
          { binding: 2, resource: { buffer: block.velocities } },
          { binding: 3, resource: { buffer: block.forces } },
          { binding: 4, resource: { buffer: block.positions } },
          { binding: 5, resource: { buffer: block.velocities } },
          { binding: 6, resource: { buffer: block.densities } },
          { binding: 7, resource: { buffer: this.obstaclesBuffer! } },
        ],
      }));
      
      this.forceFeedbackBindGroups.push(d.createBindGroup({
        layout: this.forceFeedbackPipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer: this.paramsBuffer! } },
          { binding: 1, resource: { buffer: block.positions } },
          { binding: 2, resource: { buffer: block.velocities } },
          { binding: 3, resource: { buffer: block.densities } },
          { binding: 4, resource: { buffer: this.obstaclesBuffer! } },
          { binding: 5, resource: { buffer: this.forceFeedbackBuffer! } },
        ],
      }));
    }
  }
  
  private initializeParticles(): void {
    const d = this.device!;
    const perDim = Math.ceil(Math.cbrt(this.totalParticles));
    const boxSize = 1.2;
    const spacing = boxSize / perDim * 0.9;
    
    for (let blockIdx = 0; blockIdx < this.blockCount; blockIdx++) {
      const block = this.blocks[blockIdx];
      const startIdx = blockIdx * PARTICLES_PER_BLOCK;
      
      const positions = new Float32Array(block.particleCount * 4);
      const velocities = new Float32Array(block.particleCount * 4);
      
      for (let i = 0; i < block.particleCount; i++) {
        const globalIdx = startIdx + i;
        const x = globalIdx % perDim;
        const y = Math.floor(globalIdx / perDim) % perDim;
        const z = Math.floor(globalIdx / (perDim * perDim));
        
        positions[i * 4] = (x - perDim / 2) * spacing + (Math.random() - 0.5) * spacing * 0.2;
        positions[i * 4 + 1] = (y - perDim / 2) * spacing + (Math.random() - 0.5) * spacing * 0.2 + 0.3;
        positions[i * 4 + 2] = (z - perDim / 2) * spacing + (Math.random() - 0.5) * spacing * 0.2;
        positions[i * 4 + 3] = 1000;
        
        velocities[i * 4] = 0;
        velocities[i * 4 + 1] = 0;
        velocities[i * 4 + 2] = 0;
        velocities[i * 4 + 3] = 0;
      }
      
      d.queue.writeBuffer(block.positions, 0, positions);
      d.queue.writeBuffer(block.velocities, 0, velocities);
    }
  }
  
  updateObstacles(obstacleData: Float32Array, count: number): void {
    if (!this.initialized) return;
    
    this.obstacleCount = count;
    this.device!.queue.writeBuffer(this.obstaclesBuffer!, 0, obstacleData);
  }
  
  private updateParamsBuffer(params: SPHParams): void {
    const gridSize = params.smoothingRadius;
    this.gridResolution = Math.min(Math.max(Math.ceil(params.boundarySize / gridSize) + 4, 16), 128);
    this.gridCellCount = this.gridResolution * this.gridResolution * this.gridResolution;
    
    const data = new Float32Array([
      PARTICLES_PER_BLOCK,
      gridSize,
      1.0 / gridSize,
      this.gridResolution,
      params.smoothingRadius,
      params.restDensity,
      params.stiffness,
      params.viscosity,
      params.gravity,
      params.timeStep,
      params.damping,
      params.boundarySize,
      MAX_PARTICLES_PER_CELL,
      this.totalParticles,
      this.obstacleCount,
      0,
    ]);
    
    this.device!.queue.writeBuffer(this.paramsBuffer!, 0, data);
  }
  
  private clearGridCounts(): void {
    const zeros = new Uint32Array(this.gridCellCount).fill(0);
    this.device!.queue.writeBuffer(this.gridCountsTempBuffer!, 0, zeros);
    
    const zeros2 = new Float32Array(MAX_OBSTACLES * 8).fill(0);
    this.device!.queue.writeBuffer(this.forceFeedbackBuffer!, 0, zeros2);
  }
  
  step(params: SPHParams): void {
    if (!this.initialized) return;
    
    this.frameCounter++;
    this.updateParamsBuffer(params);
    this.clearGridCounts();
    
    const d = this.device!;
    const encoder = d.createCommandEncoder();
    
    const gridWorkgroups = Math.ceil(this.gridCellCount / this.workgroupSize);
    
    {
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.clearGridPipeline!);
      for (let i = 0; i < this.blockCount; i++) {
        pass.setBindGroup(0, this.clearGridBindGroups[i]);
        pass.dispatchWorkgroups(gridWorkgroups);
      }
      pass.end();
    }
    
    for (let i = 0; i < this.blockCount; i++) {
      const block = this.blocks[i];
      const workgroups = Math.ceil(block.particleCount / this.workgroupSize);
      
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.countPipeline!);
      pass.setBindGroup(0, this.countBindGroups[i]);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    }
    
    encoder.copyBufferToBuffer(
      this.gridCountsTempBuffer!, 0,
      this.gridCountsBuffer!, 0,
      this.gridCellCount * 4
    );
    
    this.clearGridCounts();
    
    for (let i = 0; i < this.blockCount; i++) {
      const block = this.blocks[i];
      const workgroups = Math.ceil(block.particleCount / this.workgroupSize);
      
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.sortPipeline!);
      pass.setBindGroup(0, this.sortBindGroups[i]);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    }
    
    for (let i = 0; i < this.blockCount; i++) {
      const block = this.blocks[i];
      const workgroups = Math.ceil(block.particleCount / this.workgroupSize);
      
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.densityPipeline!);
      pass.setBindGroup(0, this.densityBindGroups[i]);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    }
    
    for (let i = 0; i < this.blockCount; i++) {
      const block = this.blocks[i];
      const workgroups = Math.ceil(block.particleCount / this.workgroupSize);
      
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.forcePipeline!);
      pass.setBindGroup(0, this.forceBindGroups[i]);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    }
    
    for (let i = 0; i < this.blockCount; i++) {
      const block = this.blocks[i];
      const workgroups = Math.ceil(block.particleCount / this.workgroupSize);
      
      const pass = encoder.beginComputePass();
      pass.setPipeline(this.integratePipeline!);
      pass.setBindGroup(0, this.integrateBindGroups[i]);
      pass.dispatchWorkgroups(workgroups);
      pass.end();
    }
    
    if (this.obstacleCount > 0) {
      for (let i = 0; i < this.blockCount; i++) {
        const block = this.blocks[i];
        const workgroups = Math.ceil(block.particleCount / 64);
        
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.forceFeedbackPipeline!);
        pass.setBindGroup(0, this.forceFeedbackBindGroups[i]);
        pass.dispatchWorkgroups(workgroups);
        pass.end();
      }
    }
    
    if (this.frameCounter % 2 === 0 && !this.readbackPending) {
      let offset = 0;
      for (let i = 0; i < this.blockCount; i++) {
        encoder.copyBufferToBuffer(
          this.blocks[i].positions, 0,
          this.stagingBuffer!, offset,
          this.blocks[i].particleCount * 16
        );
        offset += this.blocks[i].particleCount * 16;
      }
      for (let i = 0; i < this.blockCount; i++) {
        encoder.copyBufferToBuffer(
          this.blocks[i].velocities, 0,
          this.stagingBuffer!, offset,
          this.blocks[i].particleCount * 16
        );
        offset += this.blocks[i].particleCount * 16;
      }
      this.readbackPending = true;
    }
    
    if (this.obstacleCount > 0 && this.frameCounter % 4 === 0 && !this.forceFeedbackPending) {
      encoder.copyBufferToBuffer(
        this.forceFeedbackBuffer!, 0,
        this.forceFeedbackStagingBuffer!, 0,
        MAX_OBSTACLES * 32
      );
      this.forceFeedbackPending = true;
    }
    
    d.queue.submit([encoder.finish()]);
  }
  
  async getParticleData(): Promise<{ positions: Float32Array; velocities: Float32Array } | null> {
    if (!this.initialized || !this.readbackPending || !this.stagingBuffer || !this.stagingData) {
      return null;
    }
    
    try {
      await this.stagingBuffer.mapAsync(GPUMapMode.READ);
      const mappedData = new Float32Array(this.stagingBuffer.getMappedRange());
      this.stagingData.set(mappedData);
      this.stagingBuffer.unmap();
      
      const positions = new Float32Array(this.totalParticles * 4);
      const velocities = new Float32Array(this.totalParticles * 4);
      
      let offset = 0;
      let posOffset = 0;
      let velOffset = this.totalParticles * 4;
      
      for (let i = 0; i < this.blockCount; i++) {
        const count = this.blocks[i].particleCount;
        for (let j = 0; j < count * 4; j++) {
          positions[posOffset + j] = this.stagingData[offset + j];
        }
        posOffset += count * 4;
        offset += count * 4;
      }
      
      for (let i = 0; i < this.blockCount; i++) {
        const count = this.blocks[i].particleCount;
        for (let j = 0; j < count * 4; j++) {
          velocities[velOffset + j - this.totalParticles * 4] = this.stagingData[offset + j];
        }
        velOffset += count * 4;
        offset += count * 4;
      }
      
      this.readbackPending = false;
      return { positions, velocities };
    } catch (e) {
      this.readbackPending = false;
      return null;
    }
  }
  
  async getForceFeedback(): Promise<ForceFeedbackResult[] | null> {
    if (!this.initialized || !this.forceFeedbackPending || this.obstacleCount === 0) {
      return null;
    }
    
    try {
      await this.forceFeedbackStagingBuffer!.mapAsync(GPUMapMode.READ);
      const mappedData = new Float32Array(this.forceFeedbackStagingBuffer!.getMappedRange());
      
      const results: ForceFeedbackResult[] = [];
      for (let i = 0; i < this.obstacleCount; i++) {
        const base = i * 8;
        results.push({
          forceX: mappedData[base],
          forceY: mappedData[base + 1],
          forceZ: mappedData[base + 2],
          torqueX: mappedData[base + 3],
          torqueY: mappedData[base + 4],
          torqueZ: mappedData[base + 5],
        });
      }
      
      this.forceFeedbackStagingBuffer!.unmap();
      this.forceFeedbackPending = false;
      return results;
    } catch (e) {
      this.forceFeedbackPending = false;
      return null;
    }
  }
  
  getParticleCount(): number {
    return this.totalParticles;
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
  
  reset(): void {
    this.initializeParticles();
  }
  
  destroy(): void {
    for (const block of this.blocks) {
      block.positions.destroy();
      block.velocities.destroy();
      block.densities.destroy();
      block.forces.destroy();
    }
    
    this.stagingBuffer?.destroy();
    this.obstaclesBuffer?.destroy();
    this.forceFeedbackBuffer?.destroy();
    this.forceFeedbackStagingBuffer?.destroy();
    
    this.gridCellsBuffer?.destroy();
    this.gridCountsBuffer?.destroy();
    this.gridCountsTempBuffer?.destroy();
    this.gridPrefixSumBuffer?.destroy();
    this.paramsBuffer?.destroy();
    this.device = null;
  }
}
