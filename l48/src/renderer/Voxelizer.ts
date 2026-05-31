import type { Vec3, VoxelGridData, SceneObject, LightSource } from '@/types';
import { vec3, mat4 } from '@/utils/math';
import { voxelUtils } from '@/utils/voxel';
import { VoxelTexture3D } from './VoxelTexture3D';

import voxelizeVertexShaderSource from './shaders/voxelizeVertexShader.glsl?raw';
import voxelizeFragmentShaderSource from './shaders/voxelizeFragmentShader.glsl?raw';

export interface VoxelizerOptions {
  readonly resolution?: number;
  readonly gridSize?: Vec3;
  readonly gridCenter?: Vec3;
  readonly useFloat?: boolean;
}

export interface VoxelizationStats {
  readonly voxelCount: number;
  readonly memoryUsage: number;
  readonly timeMs: number;
}

export class Voxelizer {
  private gl: WebGL2RenderingContext;
  private resolution: number;
  private gridSize: Vec3;
  private gridCenter: Vec3;
  private useFloat: boolean;

  private voxelTexture: VoxelTexture3D | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private shaderProgram: WebGLProgram | null = null;

  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: WebGLBuffer | null = null;
  private indexBuffer: WebGLBuffer | null = null;

  private uniforms: Map<string, WebGLUniformLocation> = new Map();
  private attributes: Map<string, number> = new Map();

  private isInitialized: boolean = false;

  constructor(gl: WebGL2RenderingContext, options: VoxelizerOptions = {}) {
    this.gl = gl;
    this.resolution = options.resolution ?? 128;
    this.gridSize = options.gridSize ?? [10, 10, 10];
    this.gridCenter = options.gridCenter ?? [0, 0, 0];
    this.useFloat = options.useFloat ?? false;
  }

  public initialize(): boolean {
    if (this.isInitialized) return true;

    const gl = this.gl;

    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    if (!this.createShaderProgram()) {
      console.error('Failed to create voxelization shader program');
      return false;
    }

    this.createGeometryBuffers();
    this.createFramebuffer();
    this.createVoxelTexture();

    this.isInitialized = true;
    return true;
  }

  private createShaderProgram(): boolean {
    const gl = this.gl;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, voxelizeVertexShaderSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, voxelizeFragmentShaderSource);

    if (!vertexShader || !fragmentShader) return false;

    const program = gl.createProgram();
    if (!program) return false;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.bindFragDataLocation(program, 0, 'voxelOutput');
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Voxelization program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }

    const uniformNames = [
      'uModelMatrix', 'uViewMatrix', 'uProjectionMatrix',
      'uVoxelGridCenter', 'uVoxelGridSize', 'uVoxelResolution',
      'uAlbedo', 'uEmissive', 'uMetallic', 'uRoughness',
      'uFaceIndex',
    ];

    for (const name of uniformNames) {
      const location = gl.getUniformLocation(program, name);
      if (location) this.uniforms.set(name, location);
    }

    const attributeNames = ['aPosition', 'aNormal', 'aTexCoord'];
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
      console.error(`Voxelization ${typeStr} shader compile error:`, gl.getShaderInfoLog(shader));
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
      -1, -1,  1,   1, -1,  1,   1,  1,  1,  -1,  1,  1,
      -1, -1, -1,  -1,  1, -1,   1,  1, -1,   1, -1, -1,
      -1,  1, -1,  -1,  1,  1,   1,  1,  1,   1,  1, -1,
      -1, -1, -1,   1, -1, -1,   1, -1,  1,  -1, -1,  1,
       1, -1, -1,   1,  1, -1,   1,  1,  1,   1, -1,  1,
      -1, -1, -1,  -1, -1,  1,  -1,  1,  1,  -1,  1, -1,
    ]);

    const normals = new Float32Array([
      0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
      0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
      0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
      0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
      1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
      -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0,
    ]);

    const texCoords = new Float32Array([
      0, 0,  1, 0,  1, 1,  0, 1,
      0, 0,  1, 0,  1, 1,  0, 1,
      0, 0,  1, 0,  1, 1,  0, 1,
      0, 0,  1, 0,  1, 1,  0, 1,
      0, 0,  1, 0,  1, 1,  0, 1,
      0, 0,  1, 0,  1, 1,  0, 1,
    ]);

    const indices = new Uint16Array([
      0, 1, 2,   0, 2, 3,
      4, 5, 6,   4, 6, 7,
      8, 9, 10,  8, 10, 11,
      12, 13, 14, 12, 14, 15,
      16, 17, 18, 16, 18, 19,
      20, 21, 22, 20, 22, 23,
    ]);

    this.vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const normalBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);

    const texCoordBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

    this.indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);

    const posAttr = this.attributes.get('aPosition');
    const normAttr = this.attributes.get('aNormal');
    const texAttr = this.attributes.get('aTexCoord');

    if (posAttr !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      gl.enableVertexAttribArray(posAttr);
      gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 0, 0);
    }

    if (normAttr !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, normalBuffer);
      gl.enableVertexAttribArray(normAttr);
      gl.vertexAttribPointer(normAttr, 3, gl.FLOAT, false, 0, 0);
    }

    if (texAttr !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
      gl.enableVertexAttribArray(texAttr);
      gl.vertexAttribPointer(texAttr, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bindVertexArray(null);
  }

  private createFramebuffer(): void {
    const gl = this.gl;
    this.framebuffer = gl.createFramebuffer();
  }

  private createVoxelTexture(): void {
    this.voxelTexture = new VoxelTexture3D(
      this.gl,
      this.resolution,
      this.gridSize,
      this.gridCenter,
      this.useFloat ? 'RGBA16F' : 'RGBA8'
    );
    this.voxelTexture.initialize();
  }

  public voxelizeScene(
    objects: SceneObject[],
    lights: LightSource[]
  ): VoxelizationStats {
    if (!this.isInitialized || !this.voxelTexture) {
      throw new Error('Voxelizer not initialized');
    }

    const startTime = performance.now();
    const gl = this.gl;

    this.voxelTexture.clear();

    const gridData = voxelUtils.createVoxelGridData(
      this.resolution,
      this.gridSize,
      this.gridCenter,
      this.useFloat
    );

    for (const obj of objects) {
      voxelUtils.voxelizeSceneObject(
        gridData.data,
        this.resolution,
        this.gridCenter,
        this.gridSize,
        obj
      );
    }

    this.voxelTexture.uploadVoxelGrid(gridData);
    this.voxelTexture.generateMipmaps();

    let voxelCount = 0;
    const data = gridData.data;
    const stride = 4;
    for (let i = 0; i < data.length; i += stride) {
      if (data[i + 3] > 0) {
        voxelCount++;
      }
    }

    const timeMs = performance.now() - startTime;

    return {
      voxelCount,
      memoryUsage: this.voxelTexture.getMemoryUsage(),
      timeMs,
    };
  }

  public voxelizeSceneGPU(
    objects: SceneObject[],
    lights: LightSource[]
  ): VoxelizationStats {
    if (!this.isInitialized || !this.shaderProgram || !this.vao || !this.framebuffer || !this.voxelTexture) {
      throw new Error('Voxelizer not initialized');
    }

    const startTime = performance.now();
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.framebuffer);
    gl.useProgram(this.shaderProgram);
    gl.bindVertexArray(this.vao);

    gl.viewport(0, 0, this.resolution, this.resolution);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);

    this.setVec3Uniform('uVoxelGridCenter', this.gridCenter);
    this.setVec3Uniform('uVoxelGridSize', this.gridSize);
    this.setFloatUniform('uVoxelResolution', this.resolution);

    const halfSize = vec3.mul(this.gridSize, 0.5);
    const min = vec3.sub(this.gridCenter, halfSize);
    const max = vec3.add(this.gridCenter, halfSize);

    const projection = mat4.ortho(min[0], max[0], min[1], max[1], min[2], max[2]);
    const views = [
      mat4.lookAt(this.gridCenter, vec3.add(this.gridCenter, [1, 0, 0]), [0, 1, 0]),
      mat4.lookAt(this.gridCenter, vec3.add(this.gridCenter, [-1, 0, 0]), [0, 1, 0]),
      mat4.lookAt(this.gridCenter, vec3.add(this.gridCenter, [0, 1, 0]), [0, 0, 1]),
      mat4.lookAt(this.gridCenter, vec3.add(this.gridCenter, [0, -1, 0]), [0, 0, -1]),
      mat4.lookAt(this.gridCenter, vec3.add(this.gridCenter, [0, 0, 1]), [0, 1, 0]),
      mat4.lookAt(this.gridCenter, vec3.add(this.gridCenter, [0, 0, -1]), [0, 1, 0]),
    ];

    for (let face = 0; face < 6; face++) {
      this.setIntUniform('uFaceIndex', face);
      this.setMatrixUniform('uViewMatrix', views[face]);
      this.setMatrixUniform('uProjectionMatrix', projection);

      for (const obj of objects) {
        const modelMatrix = this.computeObjectMatrix(obj);
        this.setMatrixUniform('uModelMatrix', modelMatrix);

        this.setVec3Uniform('uAlbedo', [
          obj.material.baseColor[0],
          obj.material.baseColor[1],
          obj.material.baseColor[2],
        ]);
        this.setVec3Uniform('uEmissive', obj.material.emissive);
        this.setFloatUniform('uMetallic', obj.material.metallic);
        this.setFloatUniform('uRoughness', obj.material.roughness);

        gl.drawElements(gl.TRIANGLES, 36, gl.UNSIGNED_SHORT, 0);
      }
    }

    this.voxelTexture.generateMipmaps();

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.disable(gl.BLEND);

    const voxelCount = this.resolution * this.resolution * this.resolution;
    const timeMs = performance.now() - startTime;

    return {
      voxelCount,
      memoryUsage: this.voxelTexture.getMemoryUsage(),
      timeMs,
    };
  }

  private computeObjectMatrix(obj: SceneObject): Mat4 {
    let matrix = mat4.identity();
    matrix = mat4.translate(matrix, obj.position);
    matrix = mat4.rotateX(matrix, obj.rotation[0]);
    matrix = mat4.rotateY(matrix, obj.rotation[1]);
    matrix = mat4.rotateZ(matrix, obj.rotation[2]);
    matrix = mat4.scale(matrix, obj.scale);
    return matrix;
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

  public getVoxelTexture(): VoxelTexture3D | null {
    return this.voxelTexture;
  }

  public getVoxelGridData(): VoxelGridData | null {
    if (!this.voxelTexture) return null;

    return {
      resolution: this.resolution,
      size: this.gridSize,
      center: this.gridCenter,
      data: this.voxelTexture.getData() ?? new Uint8Array(),
    };
  }

  public updateVoxelRegion(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    data: Uint8Array | Float32Array
  ): void {
    if (!this.voxelTexture) return;
    this.voxelTexture.updateRegion(x, y, z, width, height, depth, data);
    this.voxelTexture.generateMipmaps();
  }

  public clear(): void {
    if (this.voxelTexture) {
      this.voxelTexture.clear();
    }
  }

  public dispose(): void {
    const gl = this.gl;

    if (this.shaderProgram) {
      gl.deleteProgram(this.shaderProgram);
      this.shaderProgram = null;
    }

    if (this.vao) {
      gl.deleteVertexArray(this.vao);
      this.vao = null;
    }

    if (this.vertexBuffer) {
      gl.deleteBuffer(this.vertexBuffer);
      this.vertexBuffer = null;
    }

    if (this.indexBuffer) {
      gl.deleteBuffer(this.indexBuffer);
      this.indexBuffer = null;
    }

    if (this.framebuffer) {
      gl.deleteFramebuffer(this.framebuffer);
      this.framebuffer = null;
    }

    if (this.voxelTexture) {
      this.voxelTexture.dispose();
      this.voxelTexture = null;
    }

    this.uniforms.clear();
    this.attributes.clear();
    this.isInitialized = false;
  }

  public getResolution(): number {
    return this.resolution;
  }

  public getGridSize(): Vec3 {
    return this.gridSize;
  }

  public getGridCenter(): Vec3 {
    return this.gridCenter;
  }

  public setResolution(resolution: number): void {
    this.resolution = resolution;
    if (this.voxelTexture) {
      this.voxelTexture.dispose();
      this.createVoxelTexture();
    }
  }

  public setGridSize(size: Vec3): void {
    this.gridSize = size;
    if (this.voxelTexture) {
      this.voxelTexture.setSize(size);
    }
  }

  public setGridCenter(center: Vec3): void {
    this.gridCenter = center;
    if (this.voxelTexture) {
      this.voxelTexture.setCenter(center);
    }
  }
}

export default Voxelizer;
