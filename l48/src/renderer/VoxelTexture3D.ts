import type { Vec3, VoxelGridData, VoxelTextureFormat, TextureObject } from '@/types';

export class VoxelTexture3D {
  private gl: WebGL2RenderingContext;
  private texture: WebGLTexture | null = null;
  private resolution: number;
  private size: Vec3;
  private center: Vec3;
  private format: VoxelTextureFormat;
  private internalFormat: number;
  private texFormat: number;
  private texType: number;
  private channels: number;
  private mipmapLevels: number;
  private data: Uint8Array | Float32Array | null = null;

  constructor(
    gl: WebGL2RenderingContext,
    resolution: number = 128,
    size: Vec3 = [10, 10, 10],
    center: Vec3 = [0, 0, 0],
    format: VoxelTextureFormat = 'RGBA8'
  ) {
    this.gl = gl;
    this.resolution = resolution;
    this.size = size;
    this.center = center;
    this.format = format;
    this.mipmapLevels = Math.floor(Math.log2(resolution)) + 1;

    this.configureFormat();
    this.channels = 4;
  }

  private configureFormat(): void {
    const gl = this.gl;

    switch (this.format) {
      case 'RGBA16F':
        this.internalFormat = gl.RGBA16F;
        this.texFormat = gl.RGBA;
        this.texType = gl.HALF_FLOAT;
        break;
      case 'RGBA32F':
        this.internalFormat = gl.RGBA32F;
        this.texFormat = gl.RGBA;
        this.texType = gl.FLOAT;
        break;
      case 'RGBA8':
      default:
        this.internalFormat = gl.RGBA8;
        this.texFormat = gl.RGBA;
        this.texType = gl.UNSIGNED_BYTE;
        break;
    }
  }

  public initialize(): boolean {
    const gl = this.gl;

    this.texture = gl.createTexture();
    if (!this.texture) {
      console.error('Failed to create 3D texture');
      return false;
    }

    gl.bindTexture(gl.TEXTURE_3D, this.texture);

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);

    const texSize = this.resolution;
    const totalVoxels = texSize * texSize * texSize * this.channels;

    if (this.texType === gl.FLOAT || this.texType === gl.HALF_FLOAT) {
      this.data = new Float32Array(totalVoxels);
    } else {
      this.data = new Uint8Array(totalVoxels);
    }

    gl.texStorage3D(
      gl.TEXTURE_3D,
      this.mipmapLevels,
      this.internalFormat,
      texSize,
      texSize,
      texSize
    );

    gl.bindTexture(gl.TEXTURE_3D, null);

    return true;
  }

  public uploadData(
    data: Uint8Array | Float32Array,
    offsetX: number = 0,
    offsetY: number = 0,
    offsetZ: number = 0,
    width?: number,
    height?: number,
    depth?: number
  ): void {
    if (!this.texture || !this.data) {
      console.warn('Texture not initialized');
      return;
    }

    const gl = this.gl;
    const w = width ?? this.resolution - offsetX;
    const h = height ?? this.resolution - offsetY;
    const d = depth ?? this.resolution - offsetZ;

    if (data.length !== w * h * d * this.channels) {
      console.warn('Data size mismatch');
      return;
    }

    if (
      this.data instanceof Uint8Array && data instanceof Uint8Array ||
      this.data instanceof Float32Array && data instanceof Float32Array
    ) {
      const voxelSize = this.resolution;
      const stride = voxelSize * this.channels;
      const sliceStride = voxelSize * stride;

      for (let z = 0; z < d; z++) {
        for (let y = 0; y < h; y++) {
          const srcIdx = (z * h + y) * w * this.channels;
          const dstIdx = ((z + offsetZ) * voxelSize + (y + offsetY)) * voxelSize * this.channels + offsetX * this.channels;
          
          for (let x = 0; x < w; x++) {
            const srcBase = srcIdx + x * this.channels;
            const dstBase = dstIdx + x * this.channels;
            
            for (let c = 0; c < this.channels; c++) {
              (this.data as Uint8Array | Float32Array)[dstBase + c] = data[srcBase + c];
            }
          }
        }
      }
    }

    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      offsetX,
      offsetY,
      offsetZ,
      w,
      h,
      d,
      this.texFormat,
      this.texType,
      this.data,
      0
    );
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  public uploadVoxelGrid(gridData: VoxelGridData): void {
    if (!this.texture) {
      console.warn('Texture not initialized');
      return;
    }

    const gl = this.gl;
    this.resolution = gridData.resolution;
    this.size = gridData.size;
    this.center = gridData.center;
    this.data = gridData.data;

    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      0,
      0,
      0,
      this.resolution,
      this.resolution,
      this.resolution,
      this.texFormat,
      this.texType,
      this.data,
      0
    );
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  public updateRegion(
    x: number,
    y: number,
    z: number,
    width: number,
    height: number,
    depth: number,
    data: Uint8Array | Float32Array
  ): void {
    if (!this.texture) {
      console.warn('Texture not initialized');
      return;
    }

    const gl = this.gl;

    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      x,
      y,
      z,
      width,
      height,
      depth,
      this.texFormat,
      this.texType,
      data,
      0
    );
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  public generateMipmaps(): void {
    if (!this.texture) {
      console.warn('Texture not initialized');
      return;
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    gl.generateMipmap(gl.TEXTURE_3D);
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  public bind(unit: number = 0): void {
    if (!this.texture) return;

    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_3D, this.texture);
  }

  public unbind(): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  public clear(): void {
    if (!this.texture || !this.data) return;

    if (this.data instanceof Uint8Array) {
      this.data.fill(0);
    } else {
      this.data.fill(0);
    }

    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_3D, this.texture);
    gl.texSubImage3D(
      gl.TEXTURE_3D,
      0,
      0,
      0,
      0,
      this.resolution,
      this.resolution,
      this.resolution,
      this.texFormat,
      this.texType,
      this.data,
      0
    );
    gl.bindTexture(gl.TEXTURE_3D, null);
  }

  public getResolution(): number {
    return this.resolution;
  }

  public getSize(): Vec3 {
    return this.size;
  }

  public getCenter(): Vec3 {
    return this.center;
  }

  public getFormat(): VoxelTextureFormat {
    return this.format;
  }

  public getMemoryUsage(): number {
    const bytesPerChannel = this.format === 'RGBA32F' ? 4 : this.format === 'RGBA16F' ? 2 : 1;
    let total = 0;
    let currentSize = this.resolution;
    
    for (let level = 0; level < this.mipmapLevels; level++) {
      total += currentSize * currentSize * currentSize * this.channels * bytesPerChannel;
      currentSize = Math.max(1, Math.floor(currentSize / 2));
    }
    
    return total;
  }

  public getData(): Uint8Array | Float32Array | null {
    return this.data;
  }

  public getTextureObject(): TextureObject | null {
    if (!this.texture) return null;

    return {
      texture: this.texture,
      target: this.gl.TEXTURE_3D,
      width: this.resolution,
      height: this.resolution,
      depth: this.resolution,
      format: this.texFormat,
      internalFormat: this.internalFormat,
      type: this.texType,
    };
  }

  public dispose(): void {
    if (this.texture) {
      this.gl.deleteTexture(this.texture);
      this.texture = null;
    }
    this.data = null;
  }

  public setSize(size: Vec3): void {
    this.size = size;
  }

  public setCenter(center: Vec3): void {
    this.center = center;
  }

  public worldToVoxel(worldPos: Vec3): Vec3 {
    const halfSize: Vec3 = [this.size[0] * 0.5, this.size[1] * 0.5, this.size[2] * 0.5];
    const localPos: Vec3 = [
      worldPos[0] - this.center[0] + halfSize[0],
      worldPos[1] - this.center[1] + halfSize[1],
      worldPos[2] - this.center[2] + halfSize[2],
    ];
    const voxelSize: Vec3 = [
      this.size[0] / this.resolution,
      this.size[1] / this.resolution,
      this.size[2] / this.resolution,
    ];
    return [
      localPos[0] / voxelSize[0],
      localPos[1] / voxelSize[1],
      localPos[2] / voxelSize[2],
    ];
  }

  public voxelToWorld(voxelPos: Vec3): Vec3 {
    const voxelSize: Vec3 = [
      this.size[0] / this.resolution,
      this.size[1] / this.resolution,
      this.size[2] / this.resolution,
    ];
    const localPos: Vec3 = [
      (voxelPos[0] + 0.5) * voxelSize[0],
      (voxelPos[1] + 0.5) * voxelSize[1],
      (voxelPos[2] + 0.5) * voxelSize[2],
    ];
    const halfSize: Vec3 = [this.size[0] * 0.5, this.size[1] * 0.5, this.size[2] * 0.5];
    return [
      localPos[0] - halfSize[0] + this.center[0],
      localPos[1] - halfSize[1] + this.center[1],
      localPos[2] - halfSize[2] + this.center[2],
    ];
  }

  public isInside(worldPos: Vec3): boolean {
    const halfSize: Vec3 = [this.size[0] * 0.5, this.size[1] * 0.5, this.size[2] * 0.5];
    const min: Vec3 = [
      this.center[0] - halfSize[0],
      this.center[1] - halfSize[1],
      this.center[2] - halfSize[2],
    ];
    const max: Vec3 = [
      this.center[0] + halfSize[0],
      this.center[1] + halfSize[1],
      this.center[2] + halfSize[2],
    ];

    return (
      worldPos[0] >= min[0] && worldPos[0] <= max[0] &&
      worldPos[1] >= min[1] && worldPos[1] <= max[1] &&
      worldPos[2] >= min[2] && worldPos[2] <= max[2]
    );
  }
}

export default VoxelTexture3D;
