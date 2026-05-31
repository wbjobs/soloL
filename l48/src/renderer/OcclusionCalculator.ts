import type {
  DynamicObject,
  OcclusionResult,
  OcclusionConfig,
  Mat4,
  Vec3,
  RaycastHit,
  LightSource,
  ShaderProgram,
} from '@/types';
import { mat4, vec3, mathUtils } from '@/utils/math';
import { DynamicObjectManager } from './DynamicObjectManager';
import { DepthRenderer } from './DepthRenderer';

import compositeShaderSource from './shaders/occlusionCompositeShader.glsl?raw';

export class OcclusionCalculator {
  private gl: WebGL2RenderingContext | null = null;
  private objectManager: DynamicObjectManager;
  private depthRenderer: DepthRenderer;
  private config: OcclusionConfig;

  private compositeShaderProgram: ShaderProgram | null = null;
  private occlusionResults: Map<string, OcclusionResult> = new Map();
  private occlusionMaskTexture: WebGLTexture | null = null;

  private viewMatrix: Mat4 = mat4.create();
  private projectionMatrix: Mat4 = mat4.create();
  private inverseViewMatrix: Mat4 = mat4.create();
  private inverseProjectionMatrix: Mat4 = mat4.create();
  private cameraPosition: Vec3 = [0, 0, 0];
  private near: number = 0.1;
  private far: number = 100;

  private temporalAccumulation: Map<string, number[]> = new Map();
  private frameCount: number = 0;

  private stats = {
    occlusionTime: 0,
    raycastCount: 0,
    totalRaycasts: 0,
  };

  constructor(
    objectManager: DynamicObjectManager,
    depthRenderer: DepthRenderer,
    config?: Partial<OcclusionConfig>
  ) {
    this.objectManager = objectManager;
    this.depthRenderer = depthRenderer;
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

    if (!this.depthRenderer.initialize(gl)) {
      console.error('Failed to initialize depth renderer');
      return false;
    }

    if (!this.createCompositeShaderProgram()) {
      console.error('Failed to create composite shader program');
      return false;
    }

    this.createOcclusionMaskTexture();

    return true;
  }

  public setCamera(
    viewMatrix: Mat4,
    projectionMatrix: Mat4,
    cameraPosition: Vec3,
    near: number,
    far: number
  ): void {
    this.viewMatrix = viewMatrix;
    this.projectionMatrix = projectionMatrix;
    this.inverseViewMatrix = mat4.inverse(viewMatrix);
    this.inverseProjectionMatrix = mat4.inverse(projectionMatrix);
    this.cameraPosition = cameraPosition;
    this.near = near;
    this.far = far;

    this.depthRenderer.setCamera(viewMatrix, projectionMatrix, near, far);
  }

  public calculateOcclusion(
    dynamicObjects: DynamicObject[],
    staticObjects: DynamicObject[],
    lights: LightSource[]
  ): Map<string, OcclusionResult> {
    const startTime = performance.now();
    this.stats.raycastCount = 0;

    const depthTexture = this.depthRenderer.render(dynamicObjects);

    this.occlusionResults.clear();

    const staticBBoxes = staticObjects.map(obj => ({
      object: obj,
      bbox: this.objectManager.computeObjectBoundingBox(obj),
    }));

    for (const dynamicObj of dynamicObjects) {
      if (!dynamicObj.material.castShadow) continue;

      const lightOcclusion: number[] = [];

      for (let i = 0; i < lights.length; i++) {
        const light = lights[i];
        const occlusion = this.calculateLightOcclusion(dynamicObj, light, staticBBoxes);
        lightOcclusion.push(occlusion);
      }

      const avgOcclusion = lightOcclusion.length > 0
        ? lightOcclusion.reduce((a, b) => a + b, 0) / lightOcclusion.length
        : 0;

      const visibility = 1.0 - avgOcclusion;

      const result: OcclusionResult = {
        objectId: dynamicObj.id,
        visibility,
        occlusionFactor: avgOcclusion,
        lightOcclusion: Object.freeze([...lightOcclusion]),
      };

      if (this.config.enableTemporalAccumulation) {
        const accumulated = this.applyTemporalFilter(dynamicObj.id, result);
        this.occlusionResults.set(dynamicObj.id, accumulated);
      } else {
        this.occlusionResults.set(dynamicObj.id, result);
      }
    }

    this.frameCount++;
    this.stats.occlusionTime = performance.now() - startTime;
    this.stats.totalRaycasts += this.stats.raycastCount;

    return this.occlusionResults;
  }

  public compositeWithBakedLight(
    bakedLightTexture: WebGLTexture,
    staticDepthTexture: WebGLTexture,
    dynamicDepthTexture: WebGLTexture | null,
    targetFramebuffer: WebGLFramebuffer | null,
    width: number,
    height: number
  ): void {
    if (!this.gl || !this.compositeShaderProgram) return;

    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFramebuffer);
    gl.viewport(0, 0, width, height);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    gl.useProgram(this.compositeShaderProgram.program);

    this.setMatrixUniform('uInverseProjection', this.inverseProjectionMatrix);
    this.setMatrixUniform('uInverseView', this.inverseViewMatrix);
    this.setVec3Uniform('uCameraPosition', this.cameraPosition);

    const nearLoc = this.compositeShaderProgram.uniforms.get('uNear');
    const farLoc = this.compositeShaderProgram.uniforms.get('uFar');
    const strengthLoc = this.compositeShaderProgram.uniforms.get('uOcclusionStrength');
    const intensityLoc = this.compositeShaderProgram.uniforms.get('uBakedLightIntensity');
    const resolutionLoc = this.compositeShaderProgram.uniforms.get('uResolution');

    if (nearLoc !== undefined) gl.uniform1f(nearLoc, this.near);
    if (farLoc !== undefined) gl.uniform1f(farLoc, this.far);
    if (strengthLoc !== undefined) gl.uniform1f(strengthLoc, 1.0);
    if (intensityLoc !== undefined) gl.uniform1f(intensityLoc, 1.0);
    if (resolutionLoc !== undefined) gl.uniform2f(resolutionLoc, width, height);

    this.bindTexture('uBakedLightTexture', bakedLightTexture, 0);
    this.bindTexture('uDepthTexture', staticDepthTexture, 1);

    if (dynamicDepthTexture) {
      this.bindTexture('uDynamicDepthTexture', dynamicDepthTexture, 2);
    }

    if (this.occlusionMaskTexture) {
      this.bindTexture('uOcclusionMaskTexture', this.occlusionMaskTexture, 3);
    }

    this.drawFullscreenQuad();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  public raycast(
    origin: Vec3,
    direction: Vec3,
    objects: DynamicObject[],
    maxDistance: number = 100
  ): RaycastHit | null {
    let closestHit: RaycastHit | null = null;
    let closestDistance = maxDistance;

    for (const obj of objects) {
      if (!obj.isVisible) continue;

      const hit = this.raycastObject(origin, direction, obj, closestDistance);
      if (hit && hit.distance < closestDistance) {
        closestHit = hit;
        closestDistance = hit.distance;
      }
    }

    this.stats.raycastCount++;

    return closestHit;
  }

  public getOcclusionResult(objectId: string): OcclusionResult | undefined {
    return this.occlusionResults.get(objectId);
  }

  public getAllOcclusionResults(): ReadonlyMap<string, OcclusionResult> {
    return this.occlusionResults;
  }

  public getStats() {
    return {
      ...this.stats,
      ...this.depthRenderer.getStats(),
    };
  }

  public updateConfig(config: Partial<OcclusionConfig>): void {
    this.config = { ...this.config, ...config };

    if (config.depthMapResolution) {
      this.depthRenderer.resize(config.depthMapResolution, config.depthMapResolution);
    }
  }

  public getConfig(): OcclusionConfig {
    return { ...this.config };
  }

  public dispose(): void {
    this.depthRenderer.dispose();

    if (this.gl) {
      if (this.compositeShaderProgram) {
        this.gl.deleteProgram(this.compositeShaderProgram.program);
        this.gl.deleteShader(this.compositeShaderProgram.vertexShader);
        this.gl.deleteShader(this.compositeShaderProgram.fragmentShader);
      }

      if (this.occlusionMaskTexture) {
        this.gl.deleteTexture(this.occlusionMaskTexture);
      }
    }

    this.compositeShaderProgram = null;
    this.occlusionMaskTexture = null;
    this.gl = null;

    this.occlusionResults.clear();
    this.temporalAccumulation.clear();
  }

  private calculateLightOcclusion(
    dynamicObject: DynamicObject,
    light: LightSource,
    staticBBoxes: Array<{ object: DynamicObject; bbox: any }>
  ): number {
    const dynamicSphere = this.objectManager.computeObjectBoundingSphere(dynamicObject);
    const samplePoints = this.generateSamplePoints(dynamicSphere, this.config.raycastCount);

    let occludedSamples = 0;
    const totalSamples = samplePoints.length;

    for (const point of samplePoints) {
      const lightDirection = light.type === 'directional'
        ? vec3.normalize([-light.direction[0], -light.direction[1], -light.direction[2]])
        : vec3.normalize(vec3.sub(light.position, point));

      const hit = this.raycastBBoxes(point, lightDirection, staticBBoxes, light.type === 'directional' ? 1000 : vec3.distance(point, light.position));

      if (hit) {
        occludedSamples++;
      }
    }

    return totalSamples > 0 ? occludedSamples / totalSamples : 0;
  }

  private generateSamplePoints(sphere: { center: Vec3; radius: number }, count: number): Vec3[] {
    const points: Vec3[] = [];
    const phi = Math.PI * (3 - Math.sqrt(5));

    for (let i = 0; i < count; i++) {
      const y = 1 - (i / (count - 1)) * 2;
      const radius = Math.sqrt(1 - y * y);
      const theta = phi * i;

      const x = Math.cos(theta) * radius;
      const z = Math.sin(theta) * radius;

      points.push([
        sphere.center[0] + x * sphere.radius * 0.9,
        sphere.center[1] + y * sphere.radius * 0.9,
        sphere.center[2] + z * sphere.radius * 0.9,
      ]);
    }

    return points;
  }

  private raycastBBoxes(
    origin: Vec3,
    direction: Vec3,
    bboxes: Array<{ object: DynamicObject; bbox: any }>,
    maxDistance: number
  ): RaycastHit | null {
    for (const { object, bbox } of bboxes) {
      if (!object.material.receiveShadow) continue;

      const hit = this.raycastAABB(origin, direction, bbox.min, bbox.max, maxDistance);
      if (hit) {
        return {
          objectId: object.id,
          point: hit.point,
          normal: hit.normal,
          distance: hit.distance,
        };
      }
    }
    return null;
  }

  private raycastAABB(
    origin: Vec3,
    direction: Vec3,
    min: Vec3,
    max: Vec3,
    maxDistance: number
  ): { point: Vec3; normal: Vec3; distance: number } | null {
    let tmin = -Infinity;
    let tmax = Infinity;
    let hitAxis = 0;
    let hitSign = 1;

    for (let i = 0; i < 3; i++) {
      if (Math.abs(direction[i]) < 1e-8) {
        if (origin[i] < min[i] || origin[i] > max[i]) {
          return null;
        }
      } else {
        const invD = 1 / direction[i];
        let t1 = (min[i] - origin[i]) * invD;
        let t2 = (max[i] - origin[i]) * invD;
        let sign = -1;

        if (t1 > t2) {
          [t1, t2] = [t2, t1];
          sign = 1;
        }

        if (t1 > tmin) {
          tmin = t1;
          hitAxis = i;
          hitSign = sign;
        }
        tmax = Math.min(tmax, t2);

        if (tmin > tmax) return null;
      }
    }

    if (tmin < 0 || tmin > maxDistance) return null;

    const point: Vec3 = [
      origin[0] + direction[0] * tmin,
      origin[1] + direction[1] * tmin,
      origin[2] + direction[2] * tmin,
    ];

    const normal: Vec3 = [
      hitAxis === 0 ? hitSign : 0,
      hitAxis === 1 ? hitSign : 0,
      hitAxis === 2 ? hitSign : 0,
    ];

    return { point, normal, distance: tmin };
  }

  private raycastObject(
    origin: Vec3,
    direction: Vec3,
    obj: DynamicObject,
    maxDistance: number
  ): RaycastHit | null {
    const bbox = this.objectManager.computeObjectBoundingBox(obj);
    const aabbHit = this.raycastAABB(origin, direction, bbox.min, bbox.max, maxDistance);

    if (!aabbHit) return null;

    if (obj.vertices && obj.indices && obj.normals) {
      return this.raycastMesh(origin, direction, obj, maxDistance);
    }

    return {
      objectId: obj.id,
      point: aabbHit.point,
      normal: aabbHit.normal,
      distance: aabbHit.distance,
    };
  }

  private raycastMesh(
    origin: Vec3,
    direction: Vec3,
    obj: DynamicObject,
    maxDistance: number
  ): RaycastHit | null {
    if (!obj.vertices || !obj.indices) return null;

    let closestHit: RaycastHit | null = null;
    let closestDistance = maxDistance;
    const invModel = mat4.inverse(obj.modelMatrix);

    const localOrigin = mat4.transformPoint(invModel, origin);
    const localDirection = vec3.normalize(mat4.transformDirection(invModel, direction));

    for (let i = 0; i < obj.indices.length; i += 3) {
      const i0 = obj.indices[i] * 3;
      const i1 = obj.indices[i + 1] * 3;
      const i2 = obj.indices[i + 2] * 3;

      const v0: Vec3 = [obj.vertices[i0], obj.vertices[i0 + 1], obj.vertices[i0 + 2]];
      const v1: Vec3 = [obj.vertices[i1], obj.vertices[i1 + 1], obj.vertices[i1 + 2]];
      const v2: Vec3 = [obj.vertices[i2], obj.vertices[i2 + 1], obj.vertices[i2 + 2]];

      const hit = this.raycastTriangle(localOrigin, localDirection, v0, v1, v2, closestDistance);

      if (hit && hit.distance < closestDistance) {
        closestDistance = hit.distance;

        const worldPoint = mat4.transformPoint(obj.modelMatrix, hit.point);
        const worldNormal = vec3.normalize(mat4.transformDirection(obj.modelMatrix, hit.normal));

        closestHit = {
          objectId: obj.id,
          point: worldPoint,
          normal: worldNormal,
          distance: hit.distance,
          faceIndex: i / 3,
        };
      }
    }

    return closestHit;
  }

  private raycastTriangle(
    origin: Vec3,
    direction: Vec3,
    v0: Vec3,
    v1: Vec3,
    v2: Vec3,
    maxDistance: number
  ): { point: Vec3; normal: Vec3; distance: number } | null {
    const edge1 = vec3.sub(v1, v0);
    const edge2 = vec3.sub(v2, v0);
    const h = vec3.cross(direction, edge2);
    const a = vec3.dot(edge1, h);

    if (Math.abs(a) < 1e-8) return null;

    const f = 1 / a;
    const s = vec3.sub(origin, v0);
    const u = f * vec3.dot(s, h);

    if (u < 0 || u > 1) return null;

    const q = vec3.cross(s, edge1);
    const v = f * vec3.dot(direction, q);

    if (v < 0 || u + v > 1) return null;

    const t = f * vec3.dot(edge2, q);

    if (t < 0 || t > maxDistance) return null;

    const point: Vec3 = [
      origin[0] + direction[0] * t,
      origin[1] + direction[1] * t,
      origin[2] + direction[2] * t,
    ];

    const normal = vec3.normalize(vec3.cross(edge1, edge2));

    return { point, normal, distance: t };
  }

  private applyTemporalFilter(objectId: string, result: OcclusionResult): OcclusionResult {
    let history = this.temporalAccumulation.get(objectId);
    if (!history) {
      history = [];
      this.temporalAccumulation.set(objectId, history);
    }

    history.push(result.occlusionFactor);

    const filterSize = this.config.temporalFilterSize;
    if (history.length > filterSize) {
      history.shift();
    }

    const smoothedOcclusion = history.reduce((a, b) => a + b, 0) / history.length;

    return {
      ...result,
      occlusionFactor: smoothedOcclusion,
      visibility: 1.0 - smoothedOcclusion,
    };
  }

  private createCompositeShaderProgram(): boolean {
    if (!this.gl) return false;

    const gl = this.gl;

    const vertexShaderSource = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aPosition;

out vec2 vTexCoord;

void main() {
    vTexCoord = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
}`;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, compositeShaderSource);

    if (!vertexShader || !fragmentShader) return false;

    const program = gl.createProgram();
    if (!program) return false;

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Composite shader program link error:', gl.getProgramInfoLog(program));
      gl.deleteProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      return false;
    }

    const uniforms = new Map<string, WebGLUniformLocation>();
    const attributes = new Map<string, number>();

    const uniformNames = [
      'uBakedLightTexture', 'uDepthTexture', 'uDynamicDepthTexture', 'uOcclusionMaskTexture',
      'uInverseProjection', 'uInverseView', 'uCameraPosition',
      'uNear', 'uFar', 'uOcclusionStrength', 'uBakedLightIntensity', 'uResolution',
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

    this.compositeShaderProgram = {
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
      const typeStr = type === gl.VERTEX_SHADER ? 'Composite Vertex' : 'Composite Fragment';
      console.error(`${typeStr} shader compile error:`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }

    return shader;
  }

  private createOcclusionMaskTexture(): void {
    if (!this.gl) return;

    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) return;

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 1, 1, 0, gl.RED, gl.UNSIGNED_BYTE, new Uint8Array([255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.occlusionMaskTexture = texture;
  }

  private bindTexture(uniformName: string, texture: WebGLTexture, unit: number): void {
    if (!this.gl || !this.compositeShaderProgram) return;

    const gl = this.gl;
    const location = this.compositeShaderProgram.uniforms.get(uniformName);
    if (location !== undefined) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(location, unit);
    }
  }

  private setMatrixUniform(name: string, matrix: Mat4): void {
    if (!this.gl || !this.compositeShaderProgram) return;

    const location = this.compositeShaderProgram.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniformMatrix4fv(location, false, new Float32Array(matrix));
    }
  }

  private setVec3Uniform(name: string, value: Vec3): void {
    if (!this.gl || !this.compositeShaderProgram) return;

    const location = this.compositeShaderProgram.uniforms.get(name);
    if (location !== undefined) {
      this.gl.uniform3f(location, value[0], value[1], value[2]);
    }
  }

  private drawFullscreenQuad(): void {
    if (!this.gl || !this.compositeShaderProgram) return;

    const gl = this.gl;

    const vertices = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1,
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posAttr = this.compositeShaderProgram.attributes.get('aPosition');
    if (posAttr !== undefined) {
      gl.enableVertexAttribArray(posAttr);
      gl.vertexAttribPointer(posAttr, 2, gl.FLOAT, false, 0, 0);
    }

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.deleteBuffer(buffer);
  }
}

export default OcclusionCalculator;
