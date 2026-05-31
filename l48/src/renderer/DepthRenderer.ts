import type {
  DynamicObject,
  Mat4,
  Vec3,
  FramebufferObject,
  ShaderProgram,
  BufferObject,
  DepthBuffer,
  OcclusionConfig,
} from '@/types';
import { mat4 } from '@/utils/math';
import { DynamicObjectManager } from './DynamicObjectManager';

import depthVertexShaderSource from './shaders/depthVertexShader.glsl?raw';
import depthFragmentShaderSource from './shaders/depthFragmentShader.glsl?raw';

export class DepthRenderer {
  private gl: WebGL2RenderingContext | null = null;
  private objectManager: DynamicObjectManager;
  private config: OcclusionConfig;

  private depthShaderProgram: ShaderProgram | null = null;
  private framebuffers: Map<string, FramebufferObject> = new Map();

  private vao: WebGLVertexArrayObject | null = null;
  private vertexBuffer: BufferObject | null = null;
  private indexBuffer: BufferObject | null = null;

  private viewMatrix: Mat4 = mat4.create();
  private projectionMatrix: Mat4 = mat4.create();
  private near: number = 0.1;
  private far: number = 100;

  private currentWidth: number = 1024;
  private currentHeight: number = 1024;

  private stats = {
    drawCalls: 0,
    renderTime: 0,
  };

  constructor(objectManager: DynamicObjectManager, config?: Partial<OcclusionConfig>) {
    this.objectManager = objectManager;
    this.config = {
      depthMapResolution: 2048,
      raycastCount: 64,
      softShadowRadius: 0.05,
      occlusionBias: 0.002,
      temporalFilterSize: 3,
      enableTemporalAccumulation: true,
      ...config,
    };
  }

  public initialize(gl: WebGL2RenderingContext): boolean {
    this.gl = gl;

    if (!this.createDepthShaderProgram()) {
      console.error('Failed to create depth shader program');
      return false;
    }

    this.createGeometry();
    this.resize(this.config.depthMapResolution, this.config.depthMapResolution);

    return true;
  }

  public resize(width: number, height: number): void {
    this.currentWidth = width;
    this.currentHeight = height;

    this.framebuffers.forEach(fbo => {
      if (this.gl) {
        this.gl.deleteFramebuffer(fbo.framebuffer);
        this.gl.deleteTexture(fbo.depthTexture);
        if (fbo.colorTexture) {
          this.gl.deleteTexture(fbo.colorTexture);
        }
      }
    });
    this.framebuffers.clear();

    this.createFramebuffer('dynamic');
    this.createFramebuffer('id');
  }

  public setCamera(viewMatrix: Mat4, projectionMatrix: Mat4, near: number, far: number): void {
    this.viewMatrix = viewMatrix;
    this.projectionMatrix = projectionMatrix;
    this.near = near;
    this.far = far;
  }

  public render(objects: DynamicObject[]): WebGLTexture | null {
    if (!this.gl || !this.depthShaderProgram || !this.vao) return null;

    const startTime = performance.now();
    this.stats.drawCalls = 0;

    const fbo = this.framebuffers.get('dynamic');
    if (!fbo) return null;

    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    gl.viewport(0, 0, fbo.width, fbo.height);

    gl.clearColor(1.0, 1.0, 1.0, 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    gl.useProgram(this.depthShaderProgram.program);
    gl.bindVertexArray(this.vao);

    this.setMatrixUniform('uViewMatrix', this.viewMatrix);
    this.setMatrixUniform('uProjectionMatrix', this.projectionMatrix);

    const nearLoc = this.depthShaderProgram.uniforms.get('uNear');
    const farLoc = this.depthShaderProgram.uniforms.get('uFar');
    if (nearLoc !== undefined) gl.uniform1f(nearLoc, this.near);
    if (farLoc !== undefined) gl.uniform1f(farLoc, this.far);

    const viewProjection = mat4.mul(this.projectionMatrix, this.viewMatrix);
    const visibleObjects = this.objectManager.frustumCulling(viewProjection, objects);

    for (const obj of visibleObjects) {
      if (!obj.material.castShadow) continue;

      this.setMatrixUniform('uModelMatrix', obj.modelMatrix);

      const objectColor = this.objectManager.getObjectColor(obj.id);
      const objectIdLoc = this.depthShaderProgram.uniforms.get('uObjectId');
      if (objectIdLoc !== undefined && objectColor) {
        gl.uniform3f(objectIdLoc, objectColor[0], objectColor[1], objectColor[2]);
      }

      this.drawObjectGeometry(obj);
      this.stats.drawCalls++;
    }

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.stats.renderTime = performance.now() - startTime;

    return fbo.depthTexture;
  }

  public renderIdMap(objects: DynamicObject[]): WebGLTexture | null {
    if (!this.gl || !this.depthShaderProgram || !this.vao) return null;

    const fbo = this.framebuffers.get('id');
    if (!fbo) return null;

    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);
    gl.viewport(0, 0, fbo.width, fbo.height);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(this.depthShaderProgram.program);
    gl.bindVertexArray(this.vao);

    this.setMatrixUniform('uViewMatrix', this.viewMatrix);
    this.setMatrixUniform('uProjectionMatrix', this.projectionMatrix);

    const nearLoc = this.depthShaderProgram.uniforms.get('uNear');
    const farLoc = this.depthShaderProgram.uniforms.get('uFar');
    if (nearLoc !== undefined) gl.uniform1f(nearLoc, this.near);
    if (farLoc !== undefined) gl.uniform1f(farLoc, this.far);

    const viewProjection = mat4.mul(this.projectionMatrix, this.viewMatrix);
    const visibleObjects = this.objectManager.frustumCulling(viewProjection, objects);

    for (const obj of visibleObjects) {
      this.setMatrixUniform('uModelMatrix', obj.modelMatrix);

      const objectColor = this.objectManager.getObjectColor(obj.id);
      const objectIdLoc = this.depthShaderProgram.uniforms.get('uObjectId');
      if (objectIdLoc !== undefined && objectColor) {
        gl.uniform3f(objectIdLoc, objectColor[0], objectColor[1], objectColor[2]);
      }

      this.drawObjectGeometry(obj);
    }

    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.enable(gl.CULL_FACE);

    return fbo.colorTexture || null;
  }

  public readDepthBuffer(x: number, y: number, width: number, height: number): DepthBuffer | null {
    if (!this.gl) return null;

    const fbo = this.framebuffers.get('dynamic');
    if (!fbo) return null;

    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.framebuffer);

    const pixels = new Float32Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.FLOAT, pixels);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const depthData = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      depthData[i] = pixels[i * 4];
    }

    return {
      width,
      height,
      data: depthData,
      near: this.near,
      far: this.far,
    };
  }

  public sampleDepth(depthTexture: WebGLTexture, uv: Vec3): number {
    if (!this.gl) return 1.0;

    const fbo = this.framebuffers.get('dynamic');
    if (!fbo) return 1.0;

    const x = Math.floor(uv[0] * fbo.width);
    const y = Math.floor(uv[1] * fbo.height);

    const depthBuffer = this.readDepthBuffer(x, y, 1, 1);
    if (!depthBuffer || depthBuffer.data.length === 0) return 1.0;

    return depthBuffer.data[0];
  }

  public getDepthTexture(): WebGLTexture | null {
    return this.framebuffers.get('dynamic')?.depthTexture || null;
  }

  public getIdTexture(): WebGLTexture | null {
    return this.framebuffers.get('id')?.colorTexture || null;
  }

  public getFramebuffer(name: string): FramebufferObject | undefined {
    return this.framebuffers.get(name);
  }

  public getStats() {
    return { ...this.stats };
  }

  public getResolution(): { width: number; height: number } {
    return { width: this.currentWidth, height: this.currentHeight };
  }

  public dispose(): void {
    if (!this.gl) return;

    const gl = this.gl;

    if (this.depthShaderProgram) {
      gl.deleteProgram(this.depthShaderProgram.program);
      gl.deleteShader(this.depthShaderProgram.vertexShader);
      gl.deleteShader(this.depthShaderProgram.fragmentShader);
      this.depthShaderProgram = null;
    }

    this.framebuffers.forEach(fbo => {
      gl.deleteFramebuffer(fbo.framebuffer);
      gl.deleteTexture(fbo.depthTexture);
      if (fbo.colorTexture) {
        gl.deleteTexture(fbo.colorTexture);
      }
    });
    this.framebuffers.clear();

    if (this.vertexBuffer) gl.deleteBuffer(this.vertexBuffer.buffer);
    if (this.indexBuffer) gl.deleteBuffer(this.indexBuffer.buffer);
    if (this.vao) gl.deleteVertexArray(this.vao);

    this.gl = null;
  }

  private createDepthShaderProgram(): boolean {
    if (!this.gl) return false;

    const gl = this.gl;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, depthVertexShaderSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, depthFragmentShaderSource);

    if (!vertexShader || !fragmentShader) return false;

    const program = gl.createProgram();
    if (!program) return false;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Depth shader program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }

    const uniforms = new Map<string, WebGLUniformLocation>();
    const attributes = new Map<string, number>();

    const uniformNames = [
      'uModelMatrix', 'uViewMatrix', 'uProjectionMatrix',
      'uNear', 'uFar', 'uObjectId',
    ];

    for (const name of uniformNames) {
      const location = gl.getUniformLocation(program, name);
      if (location) uniforms.set(name, location);
    }

    const attributeNames = ['aPosition'];
    for (const name of attributeNames) {
      const location = gl.getAttribLocation(program, name);
      if (location >= 0) attributes.set(name, location);
    }

    this.depthShaderProgram = {
      program,
      vertexShader,
      fragmentShader,
      uniforms,
      attributes,
    };

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
      const typeStr = type === gl.VERTEX_SHADER ? 'Depth Vertex' : 'Depth Fragment';
      console.error(`${typeStr} shader compile error:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private createGeometry(): void {
    if (!this.gl || !this.depthShaderProgram) return;

    const gl = this.gl;

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const vertices = new Float32Array([
      -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1,
      -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1,
      -1, 1, -1, -1, 1, 1, 1, 1, 1, 1, 1, -1,
      -1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1,
      1, -1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1,
      -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1,
    ]);

    const indices = new Uint16Array([
      0, 1, 2, 0, 2, 3,
      4, 5, 6, 4, 6, 7,
      8, 9, 10, 8, 10, 11,
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

    this.indexBuffer = this.createBuffer(
      gl.ELEMENT_ARRAY_BUFFER,
      indices,
      gl.STATIC_DRAW,
      gl.UNSIGNED_SHORT,
      1
    );

    const posAttr = this.depthShaderProgram.attributes.get('aPosition');
    if (posAttr !== undefined && this.vertexBuffer) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer.buffer);
      gl.enableVertexAttribArray(posAttr);
      gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 0, 0);
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

  private createFramebuffer(name: string): FramebufferObject | null {
    if (!this.gl) return null;

    const gl = this.gl;
    const width = this.currentWidth;
    const height = this.currentHeight;

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) return null;

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    const depthTexture = gl.createTexture();
    if (!depthTexture) {
      gl.deleteFramebuffer(framebuffer);
      return null;
    }

    gl.bindTexture(gl.TEXTURE_2D, depthTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT32F, width, height, 0, gl.DEPTH_COMPONENT, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture, 0);

    const colorTexture = gl.createTexture();
    if (!colorTexture) {
      gl.deleteTexture(depthTexture);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }

    gl.bindTexture(gl.TEXTURE_2D, colorTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, width, height, 0, gl.RGBA, gl.FLOAT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture, 0);

    const drawBuffers = [gl.COLOR_ATTACHMENT0];
    gl.drawBuffers(drawBuffers);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error(`Framebuffer incomplete: ${status}`);
      gl.deleteTexture(colorTexture);
      gl.deleteTexture(depthTexture);
      gl.deleteFramebuffer(framebuffer);
      return null;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);

    const fbo: FramebufferObject = {
      framebuffer,
      depthTexture,
      colorTexture,
      width,
      height,
    };

    this.framebuffers.set(name, fbo);

    return fbo;
  }

  private drawObjectGeometry(obj: DynamicObject): void {
    if (!this.gl || !this.indexBuffer) return;

    const gl = this.gl;

    if (obj.vertices && obj.indices) {
      const vertexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, obj.vertices, gl.STATIC_DRAW);

      const indexBuffer = gl.createBuffer();
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, obj.indices, gl.STATIC_DRAW);

      const posAttr = this.depthShaderProgram?.attributes.get('aPosition');
      if (posAttr !== undefined) {
        gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
        gl.enableVertexAttribArray(posAttr);
        gl.vertexAttribPointer(posAttr, 3, gl.FLOAT, false, 0, 0);
      }

      gl.drawElements(gl.TRIANGLES, obj.indices.length, gl.UNSIGNED_SHORT, 0);

      gl.deleteBuffer(vertexBuffer);
      gl.deleteBuffer(indexBuffer);
    } else {
      gl.drawElements(gl.TRIANGLES, 36, this.indexBuffer.type, 0);
    }
  }

  private setMatrixUniform(name: string, matrix: Mat4): void {
    if (!this.gl || !this.depthShaderProgram) return;

    const location = this.depthShaderProgram.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
    }
  }
}

export default DepthRenderer;
