import * as THREE from 'three';

const RENDER_TARGET_SIZE = 1024;

export class GPUPicker {
  private renderTarget: THREE.WebGLRenderTarget;
  private idMaterial: THREE.ShaderMaterial;
  private renderer: THREE.WebGLRenderer;
  private pixelBuffer: Uint8Array;
  private pickTexture: THREE.DataTexture | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.renderer = renderer;
    
    this.renderTarget = new THREE.WebGLRenderTarget(RENDER_TARGET_SIZE, RENDER_TARGET_SIZE, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    this.idMaterial = new THREE.ShaderMaterial({
      uniforms: {},
      vertexShader: `
        attribute float pointId;
        varying vec4 vIdColor;
        
        vec3 encodeId(float id) {
          float r = mod(id, 256.0) / 255.0;
          float g = mod(floor(id / 256.0), 256.0) / 255.0;
          float b = mod(floor(id / 65536.0), 256.0) / 255.0;
          return vec3(r, g, b);
        }
        
        void main() {
          vIdColor = vec4(encodeId(pointId), 1.0);
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          gl_PointSize = 8.0;
        }
      `,
      fragmentShader: `
        varying vec4 vIdColor;
        
        void main() {
          float r = distance(gl_PointCoord, vec2(0.5));
          if (r > 0.5) discard;
          gl_FragColor = vIdColor;
        }
      `,
    });

    this.pixelBuffer = new Uint8Array(4);
  }

  setPointIds(geometry: THREE.BufferGeometry, pointCount: number): void {
    const ids = new Float32Array(pointCount);
    for (let i = 0; i < pointCount; i++) {
      ids[i] = i;
    }
    geometry.setAttribute('pointId', new THREE.BufferAttribute(ids, 1));
  }

  pickPoint(
    mouseX: number,
    mouseY: number,
    camera: THREE.PerspectiveCamera,
    pointsObject: THREE.Points
  ): number | null {
    const originalMaterial = pointsObject.material;
    const originalRenderTarget = this.renderer.getRenderTarget();

    try {
      const rect = this.renderer.domElement.getBoundingClientRect();
      const x = ((mouseX - rect.left) / rect.width) * 2 - 1;
      const y = -((mouseY - rect.top) / rect.height) * 2 + 1;

      const originalPosition = camera.position.clone();
      const originalTarget = new THREE.Vector3(0, 0, 0);
      const originalRotation = camera.rotation.clone();

      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(x, y), camera);
      const rayDirection = raycaster.ray.direction.clone();

      camera.position.copy(raycaster.ray.origin);
      camera.lookAt(raycaster.ray.origin.clone().add(rayDirection));
      camera.updateMatrixWorld();

      pointsObject.material = this.idMaterial;

      this.renderer.setRenderTarget(this.renderTarget);
      this.renderer.setClearColor(0x000000, 0);
      this.renderer.clear();
      this.renderer.render(pointsObject, camera);

      const pickX = Math.floor((x + 1) / 2 * RENDER_TARGET_SIZE);
      const pickY = Math.floor((-y + 1) / 2 * RENDER_TARGET_SIZE);

      this.renderer.readRenderTargetPixels(
        this.renderTarget,
        Math.max(0, Math.min(RENDER_TARGET_SIZE - 1, pickX)),
        Math.max(0, Math.min(RENDER_TARGET_SIZE - 1, pickY)),
        1,
        1,
        this.pixelBuffer
      );

      camera.position.copy(originalPosition);
      camera.rotation.copy(originalRotation);
      camera.updateMatrixWorld();

      if (this.pixelBuffer[3] === 0) {
        return null;
      }

      const pointId = this.pixelBuffer[0] + (this.pixelBuffer[1] << 8) + (this.pixelBuffer[2] << 16);
      return pointId;
    } finally {
      pointsObject.material = originalMaterial;
      this.renderer.setRenderTarget(originalRenderTarget);
    }
  }

  getPointsInBrush(
    center: THREE.Vector3,
    brushSize: number,
    points: Float32Array,
    cameraPosition: THREE.Vector3,
    enableBackFaceCulling: boolean = true
  ): number[] {
    const indices: number[] = [];
    const brushSizeSq = brushSize * brushSize;
    const pointCount = points.length / 3;

    for (let i = 0; i < pointCount; i++) {
      const idx = i * 3;
      const px = points[idx];
      const py = points[idx + 1];
      const pz = points[idx + 2];

      const dx = px - center.x;
      const dy = py - center.y;
      const dz = pz - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > brushSizeSq) continue;

      if (enableBackFaceCulling) {
        const viewDir = new THREE.Vector3(
          cameraPosition.x - px,
          cameraPosition.y - py,
          cameraPosition.z - pz
        ).normalize();

        const pointToCenter = new THREE.Vector3(dx, dy, dz).normalize();
        const dotProduct = viewDir.dot(pointToCenter);

        if (dotProduct < 0.1) continue;
      }

      indices.push(i);
    }

    return indices;
  }

  getPointsInCube(
    center: THREE.Vector3,
    cubeSize: number,
    points: Float32Array,
    cameraPosition: THREE.Vector3,
    enableBackFaceCulling: boolean = true
  ): number[] {
    const indices: number[] = [];
    const halfSize = cubeSize / 2;
    const minX = center.x - halfSize;
    const maxX = center.x + halfSize;
    const minY = center.y - halfSize;
    const maxY = center.y + halfSize;
    const minZ = center.z - halfSize;
    const maxZ = center.z + halfSize;
    const pointCount = points.length / 3;

    for (let i = 0; i < pointCount; i++) {
      const idx = i * 3;
      const px = points[idx];
      const py = points[idx + 1];
      const pz = points[idx + 2];

      if (px < minX || px > maxX || py < minY || py > maxY || pz < minZ || pz > maxZ) {
        continue;
      }

      if (enableBackFaceCulling) {
        const viewDir = new THREE.Vector3(
          cameraPosition.x - px,
          cameraPosition.y - py,
          cameraPosition.z - pz
        ).normalize();

        const pointToCenter = new THREE.Vector3(
          center.x - px,
          center.y - py,
          center.z - pz
        ).normalize();
        const dotProduct = viewDir.dot(pointToCenter);

        if (dotProduct < 0.1) continue;
      }

      indices.push(i);
    }

    return indices;
  }

  dispose(): void {
    this.renderTarget.dispose();
    this.idMaterial.dispose();
    if (this.pickTexture) {
      this.pickTexture.dispose();
    }
  }
}

export default GPUPicker;
