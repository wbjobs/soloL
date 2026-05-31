import type {
  Vec3,
  Vec4,
  Mat4,
  LightSource,
  SceneObject,
  CameraConfig,
  SceneConfig,
  RenderStats,
  ShaderProgram,
  BufferObject,
  VoxelGridData,
  VoxelTextureFormat,
} from '@/types';
import { mat4, vec3 } from '@/utils/math';
import { voxelUtils } from '@/utils/voxel';
import { VoxelTexture3D } from './VoxelTexture3D';

import vertexShaderSource from './shaders/vctVertexShader.glsl?raw';
import fragmentShaderSource from './shaders/vctFragmentShader.glsl?raw';

export class WebGL2Renderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private shaderProgram: ShaderProgram | null = null;
  private voxelTexture: VoxelTexture3D | null = null;

  private vertexBuffer: BufferObject | null = null;
  private indexBuffer: BufferObject | null = null;
  private normalBuffer: BufferObject | null = null;
  private colorBuffer: BufferObject | null = null;
  private vao: WebGLVertexArrayObject | null = null;

  private modelMatrix: Mat4 = mat4.create();
  private viewMatrix: Mat4 = mat4.create();
  private projectionMatrix: Mat4 = mat4.create();
  private normalMatrix: Mat4 = mat4.create();

  private cameraPosition: Vec3 = [0, 0, 5];
  private cameraTarget: Vec3 = [0, 0, 0];
  private cameraUp: Vec3 = [0, 1, 0];

  private sceneConfig: SceneConfig;
  private lights: LightSource[] = [];
  private objects: SceneObject[] = [];

  private animationFrameId: number | null = null;
  private isRunning: boolean = false;
  private needsVoxelUpdate: boolean = true;

  private stats: RenderStats = {
    fps: 0,
    frameTime: 0,
    drawCalls: 0,
    triangles: 0,
    voxelMemory: 0,
  };

  private frameCount: number = 0;
  private lastFrameTime: number = 0;
  private fpsUpdateTime: number = 0;

  private onFrameCallback: ((stats: RenderStats) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, config?: Partial<SceneConfig>) {
    this.canvas = canvas;
    this.sceneConfig = this.mergeConfig(config);
  }

  private mergeConfig(config?: Partial<SceneConfig>): SceneConfig {
    const defaultConfig: SceneConfig = {
      backgroundColor: [0.1, 0.1, 0.15],
      ambientIntensity: 0.2,
      exposure: 1.0,
      gamma: 2.2,
      vct: {
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
      },
    };

    if (!config) return defaultConfig;

    return {
      ...defaultConfig,
      ...config,
      vct: {
        ...defaultConfig.vct,
        ...config.vct,
      },
    };
  }

  public initialize(): boolean {
    this.gl = this.canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
    });

    if (!this.gl) {
      console.error('WebGL2 is not supported');
      return false;
    }

    const gl = this.gl;

    gl.getExtension('EXT_color_buffer_float');
    gl.getExtension('OES_texture_float_linear');

    if (!this.createShaderProgram()) {
      console.error('Failed to create shader program');
      return false;
    }

    this.createGeometry();
    this.createVoxelTexture();
    this.setupViewport();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);

    this.updateMatrices();

    return true;
  }

  private createShaderProgram(): boolean {
    if (!this.gl) return false;

    const gl = this.gl;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentShaderSource);

    if (!vertexShader || !fragmentShader) return false;

    const program = gl.createProgram();
    if (!program) return false;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }

    const uniforms = new Map<string, WebGLUniformLocation>();
    const attributes = new Map<string, number>();

    const uniformNames = [
      'uModelMatrix', 'uViewMatrix', 'uProjectionMatrix', 'uNormalMatrix',
      'uVoxelTexture', 'uVoxelGridCenter', 'uVoxelGridSize', 'uVoxelResolution',
      'uCameraPosition', 'uBackgroundColor', 'uAmbientIntensity', 'uExposure', 'uGamma',
      'uLightCount', 'uLightPositions', 'uLightColors', 'uLightIntensities',
      'uLightRadii', 'uLightTypes', 'uLightDirections', 'uLightInnerAngles', 'uLightOuterAngles',
      'uConeStepSize', 'uConeMaxSteps', 'uConeAperture', 'uIndirectIntensity', 'uAOIntensity',
      'uAlbedo', 'uMetallic', 'uRoughness', 'uEmissive',
    ];

    for (const name of uniformNames) {
      const location = gl.getUniformLocation(program, name);
      if (location) uniforms.set(name, location);
    }

    const attributeNames = ['aPosition', 'aNormal', 'aTexCoord', 'aColor'];
    for (const name of attributeNames) {
      const location = gl.getAttribLocation(program, name);
      if (location >= 0) attributes.set(name, location);
    }

    this.shaderProgram = {
      program,
      vertexShader,
      fragmentShader,
      uniforms,
      attributes,
    };

    gl.useProgram(program);

    return true;
  }

  private compileShader(type: number, source: string): WebGLShader | null {
    if (!this.gl) return null;

    const gl = this.gl;
    const shader = gl.createShader(type);
    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const typeStr = type === gl.VERTEX_SHADER ? 'Vertex' : 'Fragment';
      console.error(`${typeStr} shader compile error:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private createGeometry(): void {
    if (!this.gl || !this.shaderProgram) return;

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

    const colors = new Float32Array(24 * 4);
    for (let i = 0; i < 24; i++) {
      colors[i * 4] = 1;
      colors[i * 4 + 1] = 1;
      colors[i * 4 + 2] = 1;
      colors[i * 4 + 3] = 1;
    }

    const indices = new Uint16Array([
      0, 1, 2,   0, 2, 3,
      4, 5, 6,   4, 6, 7,
      8, 9, 10,  8, 10, 11,
      12, 13, 14, 12, 14, 15,
      16, 17, 18, 16, 18, 19,
      20, 21, 22, 20, 22, 23,
    ]);

    this.vertexBuffer = this.createBuffer(
      gl.ARRAY_BUFFER,
      vertices,
      gl.STATIC_DRAW,
      gl.FLOAT,
      3
    );

    this.normalBuffer = this.createBuffer(
      gl.ARRAY_BUFFER,
      normals,
      gl.STATIC_DRAW,
      gl.FLOAT,
      3
    );

    this.colorBuffer = this.createBuffer(
      gl.ARRAY_BUFFER,
      colors,
      gl.STATIC_DRAW,
      gl.FLOAT,
      4
    );

    this.indexBuffer = this.createBuffer(
      gl.ELEMENT_ARRAY_BUFFER,
      indices,
      gl.STATIC_DRAW,
      gl.UNSIGNED_SHORT,
      1
    );

    const posAttr = this.shaderProgram.attributes.get('aPosition');
    const normAttr = this.shaderProgram.attributes.get('aNormal');
    const colorAttr = this.shaderProgram.attributes.get('aColor');

    if (posAttr !== undefined && this.vertexBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer.buffer);
      gl.enableVertexAttribArray(posAttr);
      gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 0, 0);
    }

    if (normAttr !== undefined && this.normalBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer.buffer);
      gl.enableVertexAttribArray(normAttr);
      gl.vertexAttribPointer(normAttr, 3, gl.FLOAT, false, 0, 0);
    }

    if (colorAttr !== undefined && this.colorBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer.buffer);
      gl.enableVertexAttribArray(colorAttr);
      gl.vertexAttribPointer(colorAttr, 4, gl.FLOAT, false, 0, 0);
    }

    if (this.indexBuffer) {
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer.buffer);
    }

    gl.bindVertexArray(null);
  }

  private createBuffer(
    target: number,
    data: BufferSource,
    usage: number,
    type: number,
    components: number
  ): BufferObject {
    if (!this.gl) throw new Error('WebGL context not initialized');

    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error('Failed to create buffer');

    gl.bindBuffer(target, buffer);
    gl.bufferData(target, data, usage);

    return { buffer, target, usage, type, components };
  }

  private createVoxelTexture(): void {
    if (!this.gl) return;

    const { vct } = this.sceneConfig;
    
    this.voxelTexture = new VoxelTexture3D(
      this.gl,
      vct.voxelResolution,
      vct.voxelGridSize,
      vct.voxelGridCenter,
      'RGBA8'
    );

    this.voxelTexture.initialize();
    this.stats.voxelMemory = this.voxelTexture.getMemoryUsage();
  }

  private setupViewport(): void {
    if (!this.gl) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  private updateMatrices(): void {
    const { fov, near, far } = this.getCameraConfig();
    const aspect = this.canvas.width / this.canvas.height;

    this.projectionMatrix = mat4.perspective(fov, aspect, near, far);
    this.viewMatrix = mat4.lookAt(this.cameraPosition, this.cameraTarget, this.cameraUp);
    
    const modelView = mat4.mul(this.viewMatrix, this.modelMatrix);
    this.normalMatrix = mat4.inverse(mat4.transpose(modelView));
  }

  private getCameraConfig(): CameraConfig {
    return {
      position: this.cameraPosition,
      target: this.cameraTarget,
      fov: Math.PI / 4,
      near: 0.1,
      far: 100,
      aspect: this.canvas.width / this.canvas.height,
    };
  }

  private updateUniforms(): void {
    if (!this.gl || !this.shaderProgram || !this.voxelTexture) return;

    const gl = this.gl;
    const { uniforms } = this.shaderProgram;
    const { vct } = this.sceneConfig;

    this.setMatrixUniform(uniforms.get('uModelMatrix'), this.modelMatrix);
    this.setMatrixUniform(uniforms.get('uViewMatrix'), this.viewMatrix);
    this.setMatrixUniform(uniforms.get('uProjectionMatrix'), this.projectionMatrix);
    this.setMatrixUniform(uniforms.get('uNormalMatrix'), this.normalMatrix);

    const texLoc = uniforms.get('uVoxelTexture');
    if (texLoc !== undefined) {
      this.voxelTexture.bind(0);
      gl.uniform1i(texLoc, 0);
    }

    this.setVec3Uniform(uniforms.get('uVoxelGridCenter'), vct.voxelGridCenter);
    this.setVec3Uniform(uniforms.get('uVoxelGridSize'), vct.voxelGridSize);
    
    const resLoc = uniforms.get('uVoxelResolution');
    if (resLoc !== undefined) gl.uniform1f(resLoc, vct.voxelResolution);

    this.setVec3Uniform(uniforms.get('uCameraPosition'), this.cameraPosition);
    this.setVec3Uniform(uniforms.get('uBackgroundColor'), this.sceneConfig.backgroundColor);
    
    const ambientLoc = uniforms.get('uAmbientIntensity');
    if (ambientLoc !== undefined) gl.uniform1f(ambientLoc, this.sceneConfig.ambientIntensity);
    
    const exposureLoc = uniforms.get('uExposure');
    if (exposureLoc !== undefined) gl.uniform1f(exposureLoc, this.sceneConfig.exposure);
    
    const gammaLoc = uniforms.get('uGamma');
    if (gammaLoc !== undefined) gl.uniform1f(gammaLoc, this.sceneConfig.gamma);

    this.updateLightUniforms();

    const stepLoc = uniforms.get('uConeStepSize');
    if (stepLoc !== undefined) gl.uniform1f(stepLoc, vct.coneStepSize);
    
    const maxStepsLoc = uniforms.get('uConeMaxSteps');
    if (maxStepsLoc !== undefined) gl.uniform1i(maxStepsLoc, vct.coneMaxSteps);
    
    const apertureLoc = uniforms.get('uConeAperture');
    if (apertureLoc !== undefined) gl.uniform1f(apertureLoc, vct.coneAperture);
    
    const indirectLoc = uniforms.get('uIndirectIntensity');
    if (indirectLoc !== undefined) gl.uniform1f(indirectLoc, vct.indirectIntensity);
    
    const aoLoc = uniforms.get('uAOIntensity');
    if (aoLoc !== undefined) gl.uniform1f(aoLoc, vct.aoIntensity);

    const albedoLoc = uniforms.get('uAlbedo');
    if (albedoLoc !== undefined) gl.uniform3f(albedoLoc, 1, 1, 1);
    
    const metallicLoc = uniforms.get('uMetallic');
    if (metallicLoc !== undefined) gl.uniform1f(metallicLoc, 0);
    
    const roughnessLoc = uniforms.get('uRoughness');
    if (roughnessLoc !== undefined) gl.uniform1f(roughnessLoc, 0.5);
    
    const emissiveLoc = uniforms.get('uEmissive');
    if (emissiveLoc !== undefined) gl.uniform3f(emissiveLoc, 0, 0, 0);
  }

  private updateLightUniforms(): void {
    if (!this.gl || !this.shaderProgram) return;

    const gl = this.gl;
    const { uniforms } = this.shaderProgram;

    const countLoc = uniforms.get('uLightCount');
    if (countLoc !== undefined) gl.uniform1i(countLoc, this.lights.length);

    const maxLights = 8;
    const positions: number[] = [];
    const colors: number[] = [];
    const intensities: number[] = [];
    const radii: number[] = [];
    const types: number[] = [];
    const directions: number[] = [];
    const innerAngles: number[] = [];
    const outerAngles: number[] = [];

    for (let i = 0; i < maxLights; i++) {
      if (i < this.lights.length) {
        const light = this.lights[i];
        positions.push(...light.position);
        colors.push(...light.color);
        intensities.push(light.intensity);
        radii.push(light.radius);
        types.push(light.type === 'directional' ? 0 : light.type === 'point' ? 1 : 2);
        directions.push(...light.direction);
        innerAngles.push(light.innerAngle);
        outerAngles.push(light.outerAngle);
      } else {
        positions.push(0, 0, 0);
        colors.push(0, 0, 0);
        intensities.push(0);
        radii.push(1);
        types.push(0);
        directions.push(0, -1, 0);
        innerAngles.push(0);
        outerAngles.push(0);
      }
    }

    const posLoc = uniforms.get('uLightPositions');
    if (posLoc !== undefined) gl.uniform3fv(posLoc, positions);
    
    const colorLoc = uniforms.get('uLightColors');
    if (colorLoc !== undefined) gl.uniform3fv(colorLoc, colors);
    
    const intLoc = uniforms.get('uLightIntensities');
    if (intLoc !== undefined) gl.uniform1fv(intLoc, intensities);
    
    const radLoc = uniforms.get('uLightRadii');
    if (radLoc !== undefined) gl.uniform1fv(radLoc, radii);
    
    const typeLoc = uniforms.get('uLightTypes');
    if (typeLoc !== undefined) gl.uniform1iv(typeLoc, types);
    
    const dirLoc = uniforms.get('uLightDirections');
    if (dirLoc !== undefined) gl.uniform3fv(dirLoc, directions);
    
    const innerLoc = uniforms.get('uLightInnerAngles');
    if (innerLoc !== undefined) gl.uniform1fv(innerLoc, innerAngles);
    
    const outerLoc = uniforms.get('uLightOuterAngles');
    if (outerLoc !== undefined) gl.uniform1fv(outerLoc, outerAngles);
  }

  private setMatrixUniform(location: WebGLUniformLocation | undefined, matrix: Mat4): void {
    if (!this.gl || location === undefined) return;
    this.gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
  }

  private setVec3Uniform(location: WebGLUniformLocation | undefined, value: Vec3): void {
    if (!this.gl || location === undefined) return;
    this.gl.uniform3f(location, value[0], value[1], value[2]);
  }

  private setVec4Uniform(location: WebGLUniformLocation | undefined, value: Vec4): void {
    if (!this.gl || location === undefined) return;
    this.gl.uniform4f(location, value[0], value[1], value[2], value[3]);
  }

  private updateVoxels(): void {
    if (!this.voxelTexture || !this.needsVoxelUpdate) return;

    const { vct } = this.sceneConfig;
    const gridData = voxelUtils.createVoxelGridData(
      vct.voxelResolution,
      vct.voxelGridSize,
      vct.voxelGridCenter,
      false
    );

    for (const obj of this.objects) {
      voxelUtils.voxelizeSceneObject(
        gridData.data,
        vct.voxelResolution,
        vct.voxelGridCenter,
        vct.voxelGridSize,
        obj
      );
    }

    this.voxelTexture.uploadVoxelGrid(gridData);
    this.voxelTexture.generateMipmaps();
    this.needsVoxelUpdate = false;
  }

  public render(): void {
    if (!this.gl || !this.shaderProgram || !this.vao) return;

    const gl = this.gl;

    this.updateVoxels();
    this.updateMatrices();
    this.updateUniforms();

    gl.clearColor(
      this.sceneConfig.backgroundColor[0],
      this.sceneConfig.backgroundColor[1],
      this.sceneConfig.backgroundColor[2],
      1
    );
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.useProgram(this.shaderProgram.program);
    gl.bindVertexArray(this.vao);

    for (const obj of this.objects) {
      this.modelMatrix = mat4.identity();
      this.modelMatrix = mat4.translate(this.modelMatrix, obj.position);
      this.modelMatrix = mat4.rotateX(this.modelMatrix, obj.rotation[0]);
      this.modelMatrix = mat4.rotateY(this.modelMatrix, obj.rotation[1]);
      this.modelMatrix = mat4.rotateZ(this.modelMatrix, obj.rotation[2]);
      this.modelMatrix = mat4.scale(this.modelMatrix, obj.scale);

      const modelView = mat4.mul(this.viewMatrix, this.modelMatrix);
      this.normalMatrix = mat4.inverse(mat4.transpose(modelView));

      this.setMatrixUniform(this.shaderProgram.uniforms.get('uModelMatrix'), this.modelMatrix);
      this.setMatrixUniform(this.shaderProgram.uniforms.get('uNormalMatrix'), this.normalMatrix);

      const albedoLoc = this.shaderProgram.uniforms.get('uAlbedo');
      if (albedoLoc !== undefined) {
        gl.uniform3f(albedoLoc, obj.material.baseColor[0], obj.material.baseColor[1], obj.material.baseColor[2]);
      }

      const metallicLoc = this.shaderProgram.uniforms.get('uMetallic');
      if (metallicLoc !== undefined) gl.uniform1f(metallicLoc, obj.material.metallic);

      const roughnessLoc = this.shaderProgram.uniforms.get('uRoughness');
      if (roughnessLoc !== undefined) gl.uniform1f(roughnessLoc, obj.material.roughness);

      const emissiveLoc = this.shaderProgram.uniforms.get('uEmissive');
      if (emissiveLoc !== undefined) {
        gl.uniform3f(emissiveLoc, obj.material.emissive[0], obj.material.emissive[1], obj.material.emissive[2]);
      }

      if (this.indexBuffer) {
        gl.drawElements(gl.TRIANGLES, 36, this.indexBuffer.type, 0);
      }

      this.stats.drawCalls++;
      this.stats.triangles += 12;
    }

    gl.bindVertexArray(null);
  }

  private animate = (timestamp: number): void => {
    if (!this.isRunning) return;

    const deltaTime = timestamp - this.lastFrameTime;
    this.lastFrameTime = timestamp;

    this.stats.frameTime = deltaTime;
    this.frameCount++;
    this.fpsUpdateTime += deltaTime;

    if (this.fpsUpdateTime >= 1000) {
      this.stats.fps = Math.round((this.frameCount * 1000) / this.fpsUpdateTime);
      this.frameCount = 0;
      this.fpsUpdateTime = 0;
    }

    this.stats.drawCalls = 0;
    this.stats.triangles = 0;

    this.render();

    if (this.onFrameCallback) {
      this.onFrameCallback({ ...this.stats });
    }

    this.animationFrameId = requestAnimationFrame(this.animate);
  };

  public start(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.lastFrameTime = performance.now();
    this.animationFrameId = requestAnimationFrame(this.animate);
  }

  public stop(): void {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  public resize(): void {
    this.setupViewport();
    this.updateMatrices();
  }

  public setCamera(position: Vec3, target: Vec3, up: Vec3 = [0, 1, 0]): void {
    this.cameraPosition = position;
    this.cameraTarget = target;
    this.cameraUp = up;
  }

  public setLights(lights: LightSource[]): void {
    this.lights = lights.slice(0, 8);
  }

  public addLight(light: LightSource): void {
    if (this.lights.length < 8) {
      this.lights.push(light);
    }
  }

  public removeLight(id: string): void {
    this.lights = this.lights.filter(l => l.id !== id);
  }

  public setObjects(objects: SceneObject[]): void {
    this.objects = objects;
    this.needsVoxelUpdate = true;
  }

  public addObject(obj: SceneObject): void {
    this.objects.push(obj);
    this.needsVoxelUpdate = true;
  }

  public removeObject(id: string): void {
    this.objects = this.objects.filter(o => o.id !== id);
    this.needsVoxelUpdate = true;
  }

  public updateObject(obj: SceneObject): void {
    const index = this.objects.findIndex(o => o.id === obj.id);
    if (index !== -1) {
      this.objects[index] = obj;
      this.needsVoxelUpdate = true;
    }
  }

  public setVoxelData(gridData: VoxelGridData): void {
    if (this.voxelTexture) {
      this.voxelTexture.uploadVoxelGrid(gridData);
      this.voxelTexture.generateMipmaps();
      this.stats.voxelMemory = this.voxelTexture.getMemoryUsage();
    }
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
    if (this.voxelTexture) {
      this.voxelTexture.updateRegion(x, y, z, width, height, depth, data);
      this.voxelTexture.generateMipmaps();
    }
  }

  public setConfig(config: Partial<SceneConfig>): void {
    this.sceneConfig = {
      ...this.sceneConfig,
      ...config,
      vct: {
        ...this.sceneConfig.vct,
        ...config.vct,
      },
    };

    if (config.vct?.voxelResolution && this.voxelTexture) {
      this.needsVoxelUpdate = true;
    }
  }

  public setVoxelFormat(format: VoxelTextureFormat): void {
    if (!this.gl || !this.voxelTexture) return;

    const { vct } = this.sceneConfig;
    
    this.voxelTexture.dispose();
    this.voxelTexture = new VoxelTexture3D(
      this.gl,
      vct.voxelResolution,
      vct.voxelGridSize,
      vct.voxelGridCenter,
      format
    );
    this.voxelTexture.initialize();
    this.stats.voxelMemory = this.voxelTexture.getMemoryUsage();
    this.needsVoxelUpdate = true;
  }

  public getStats(): RenderStats {
    return { ...this.stats };
  }

  public getVoxelMemoryUsage(): number {
    return this.voxelTexture?.getMemoryUsage() ?? 0;
  }

  public onFrame(callback: (stats: RenderStats) => void): void {
    this.onFrameCallback = callback;
  }

  public dispose(): void {
    this.stop();

    if (this.shaderProgram) {
      if (this.gl) {
        this.gl.deleteProgram(this.shaderProgram.program);
        this.gl.deleteShader(this.shaderProgram.vertexShader);
        this.gl.deleteShader(this.shaderProgram.fragmentShader);
      }
      this.shaderProgram = null;
    }

    [this.vertexBuffer, this.indexBuffer, this.normalBuffer, this.colorBuffer].forEach(buf => {
      if (buf && this.gl) {
        this.gl.deleteBuffer(buf.buffer);
      }
    });

    if (this.vao && this.gl) {
      this.gl.deleteVertexArray(this.vao);
      this.vao = null;
    }

    if (this.voxelTexture) {
      this.voxelTexture.dispose();
      this.voxelTexture = null;
    }

    this.gl = null;
  }
}

export default WebGL2Renderer;
