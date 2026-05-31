export type Vec3 = readonly [number, number, number];

export type Vec4 = readonly [number, number, number, number];

export type Mat4 = readonly [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

export interface VoxelData {
  readonly position: Vec3;
  readonly size: Vec3;
  readonly color: Vec4;
  readonly normal: Vec3;
  readonly emissive: Vec3;
  readonly roughness: number;
  readonly metallic: number;
}

export interface LightSource {
  readonly id: string;
  readonly type: 'directional' | 'point' | 'spot';
  readonly position: Vec3;
  readonly direction: Vec3;
  readonly color: Vec3;
  readonly intensity: number;
  readonly radius: number;
  readonly innerAngle: number;
  readonly outerAngle: number;
}

export interface SceneObject {
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
  readonly geometryType: 'box' | 'sphere' | 'plane' | 'custom';
  readonly material: {
    readonly baseColor: Vec4;
    readonly emissive: Vec3;
    readonly roughness: number;
    readonly metallic: number;
  };
}

export interface CameraConfig {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
  readonly near: number;
  readonly far: number;
  readonly aspect: number;
}

export interface VCTConfig {
  readonly voxelResolution: number;
  readonly voxelSize: number;
  readonly voxelGridSize: Vec3;
  readonly voxelGridCenter: Vec3;
  readonly maxCones: number;
  readonly coneStepSize: number;
  readonly coneMaxSteps: number;
  readonly coneAperture: number;
  readonly indirectIntensity: number;
  readonly aoIntensity: number;
}

export interface SceneConfig {
  readonly backgroundColor: Vec3;
  readonly ambientIntensity: number;
  readonly exposure: number;
  readonly gamma: number;
  readonly vct: VCTConfig;
}

export interface RenderStats {
  fps: number;
  frameTime: number;
  drawCalls: number;
  triangles: number;
  voxelMemory: number;
}

export interface VoxelGridData {
  readonly resolution: number;
  readonly size: Vec3;
  readonly center: Vec3;
  readonly data: Uint8Array | Float32Array;
}

export type VoxelTextureFormat = 'RGBA8' | 'RGBA16F' | 'RGBA32F';

export interface WebGL2Context extends WebGL2RenderingContext {
  readonly canvas: HTMLCanvasElement;
}

export interface ShaderProgram {
  readonly program: WebGLProgram;
  readonly vertexShader: WebGLShader;
  readonly fragmentShader: WebGLShader;
  readonly uniforms: ReadonlyMap<string, WebGLUniformLocation>;
  readonly attributes: ReadonlyMap<string, number>;
}

export interface BufferObject {
  readonly buffer: WebGLBuffer;
  readonly target: number;
  readonly usage: number;
  readonly type: number;
  readonly components: number;
}

export interface TextureObject {
  readonly texture: WebGLTexture;
  readonly target: number;
  readonly width: number;
  readonly height: number;
  readonly depth?: number;
  readonly format: number;
  readonly internalFormat: number;
  readonly type: number;
}

export interface DynamicObject {
  readonly id: string;
  readonly name: string;
  readonly position: Vec3;
  readonly rotation: Vec3;
  readonly scale: Vec3;
  readonly geometryType: 'box' | 'sphere' | 'plane' | 'mesh';
  readonly vertices?: Float32Array;
  readonly indices?: Uint16Array;
  readonly normals?: Float32Array;
  readonly material: {
    readonly baseColor: Vec4;
    readonly emissive: Vec3;
    readonly roughness: number;
    readonly metallic: number;
    readonly castShadow: boolean;
    readonly receiveShadow: boolean;
  };
  readonly modelMatrix: Mat4;
  readonly isStatic: boolean;
  readonly isVisible: boolean;
  readonly layerMask: number;
}

export interface DynamicObjectState {
  readonly objects: ReadonlyMap<string, DynamicObject>;
  readonly selectedObjectId: string | null;
  readonly needsUpdate: boolean;
}

export interface OcclusionResult {
  readonly objectId: string;
  readonly visibility: number;
  readonly occlusionFactor: number;
  readonly lightOcclusion: readonly number[];
}

export interface DepthBuffer {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;
  readonly near: number;
  readonly far: number;
}

export interface FramebufferObject {
  readonly framebuffer: WebGLFramebuffer;
  readonly depthTexture: WebGLTexture;
  readonly colorTexture?: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

export interface RaycastHit {
  readonly objectId: string;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly distance: number;
  readonly faceIndex?: number;
}

export interface GizmoState {
  readonly active: boolean;
  readonly mode: 'translate' | 'rotate' | 'scale';
  readonly axis: 'x' | 'y' | 'z' | null;
  readonly startPosition: Vec3;
  readonly startRotation: Vec3;
  readonly startScale: Vec3;
  readonly startMouse: { x: number; y: number };
}

export interface EditorInteractionState {
  readonly selectedObjectId: string | null;
  readonly hoveredObjectId: string | null;
  readonly gizmo: GizmoState;
  readonly isDragging: boolean;
  readonly isPanning: boolean;
  readonly isOrbiting: boolean;
  readonly lastMousePosition: { x: number; y: number };
}

export interface OcclusionConfig {
  readonly depthMapResolution: number;
  readonly raycastCount: number;
  readonly softShadowRadius: number;
  readonly occlusionBias: number;
  readonly temporalFilterSize: number;
  readonly enableTemporalAccumulation: boolean;
}

export interface DynamicObjectManagerStats {
  readonly objectCount: number;
  readonly dynamicObjectCount: number;
  readonly staticObjectCount: number;
  readonly visibleObjectCount: number;
}

export interface BoundingBox {
  readonly min: Vec3;
  readonly max: Vec3;
  readonly center: Vec3;
  readonly size: Vec3;
}

export interface BoundingSphere {
  readonly center: Vec3;
  readonly radius: number;
}
