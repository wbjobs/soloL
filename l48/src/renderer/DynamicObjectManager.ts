import type {
  DynamicObject,
  DynamicObjectState,
  DynamicObjectManagerStats,
  BoundingBox,
  BoundingSphere,
  Mat4,
  Vec3,
} from '@/types';
import { mat4, vec3 } from '@/utils/math';

export class DynamicObjectManager {
  private objects: Map<string, DynamicObject> = new Map();
  private selectedObjectId: string | null = null;
  private needsUpdate: boolean = true;
  private listeners: Set<(state: DynamicObjectState) => void> = new Set();

  private idToColor: Map<string, Vec3> = new Map();
  private colorToId: Map<string, string> = new Map();
  private nextColorId: number = 1;

  public addObject(obj: Partial<Omit<DynamicObject, 'id' | 'modelMatrix'>> & { name: string; position: Vec3; rotation: Vec3; scale: Vec3; geometryType: DynamicObject['geometryType']; material: DynamicObject['material'] } & Pick<DynamicObject, 'isStatic' | 'isVisible' | 'layerMask'> & Partial<Pick<DynamicObject, 'id' | 'modelMatrix' | 'vertices' | 'indices' | 'normals'>>): DynamicObject {
    const id = obj.id || this.generateId();
    const modelMatrix = obj.modelMatrix || this.computeModelMatrix(obj.position, obj.rotation, obj.scale);

    const newObj: DynamicObject = {
      ...obj,
      id,
      modelMatrix,
    };

    this.objects.set(id, newObj);
    this.needsUpdate = true;
    this.assignObjectColor(id);
    this.notifyListeners();

    return newObj;
  }

  public removeObject(id: string): boolean {
    const removed = this.objects.delete(id);
    if (removed) {
      if (this.selectedObjectId === id) {
        this.selectedObjectId = null;
      }
      this.releaseObjectColor(id);
      this.needsUpdate = true;
      this.notifyListeners();
    }
    return removed;
  }

  public updateObject(id: string, updates: Partial<DynamicObject>): DynamicObject | null {
    const obj = this.objects.get(id);
    if (!obj) return null;

    const needsMatrixUpdate = updates.position !== undefined || updates.rotation !== undefined || updates.scale !== undefined;
    const newModelMatrix = needsMatrixUpdate
      ? this.computeModelMatrix(
          updates.position || obj.position,
          updates.rotation || obj.rotation,
          updates.scale || obj.scale
        )
      : obj.modelMatrix;

    const updatedObj: DynamicObject = {
      ...obj,
      ...updates,
      modelMatrix: newModelMatrix,
    };

    this.objects.set(id, updatedObj);
    this.needsUpdate = true;
    this.notifyListeners();

    return updatedObj;
  }

  public getObject(id: string): DynamicObject | undefined {
    return this.objects.get(id);
  }

  public getAllObjects(): ReadonlyMap<string, DynamicObject> {
    return this.objects;
  }

  public getVisibleObjects(): DynamicObject[] {
    return Array.from(this.objects.values()).filter(obj => obj.isVisible);
  }

  public getDynamicObjects(): DynamicObject[] {
    return Array.from(this.objects.values()).filter(obj => !obj.isStatic);
  }

  public getStaticObjects(): DynamicObject[] {
    return Array.from(this.objects.values()).filter(obj => obj.isStatic);
  }

  public getObjectsByLayer(layerMask: number): DynamicObject[] {
    return Array.from(this.objects.values()).filter(obj => (obj.layerMask & layerMask) !== 0);
  }

  public selectObject(id: string | null): void {
    this.selectedObjectId = id;
    this.notifyListeners();
  }

  public getSelectedObject(): DynamicObject | undefined {
    return this.selectedObjectId ? this.objects.get(this.selectedObjectId) : undefined;
  }

  public getSelectedObjectId(): string | null {
    return this.selectedObjectId;
  }

  public computeObjectBoundingBox(obj: DynamicObject): BoundingBox {
    const localMin: Vec3 = [-0.5, -0.5, -0.5];
    const localMax: Vec3 = [0.5, 0.5, 0.5];

    const corners: Vec3[] = [
      [localMin[0], localMin[1], localMin[2]],
      [localMax[0], localMin[1], localMin[2]],
      [localMin[0], localMax[1], localMin[2]],
      [localMax[0], localMax[1], localMin[2]],
      [localMin[0], localMin[1], localMax[2]],
      [localMax[0], localMin[1], localMax[2]],
      [localMin[0], localMax[1], localMax[2]],
      [localMax[0], localMax[1], localMax[2]],
    ];

    const transformedCorners = corners.map(c => mat4.transformPoint(obj.modelMatrix, c));

    let min: Vec3 = [Infinity, Infinity, Infinity];
    let max: Vec3 = [-Infinity, -Infinity, -Infinity];

    for (const c of transformedCorners) {
      min = [Math.min(min[0], c[0]), Math.min(min[1], c[1]), Math.min(min[2], c[2])];
      max = [Math.max(max[0], c[0]), Math.max(max[1], c[1]), Math.max(max[2], c[2])];
    }

    const center: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];

    return { min, max, center, size };
  }

  public computeObjectBoundingSphere(obj: DynamicObject): BoundingSphere {
    const bbox = this.computeObjectBoundingBox(obj);
    const radius = Math.max(bbox.size[0], bbox.size[1], bbox.size[2]) / 2;

    return {
      center: bbox.center,
      radius,
    };
  }

  public getObjectByIdColor(r: number, g: number, b: number): DynamicObject | undefined {
    const key = `${r.toFixed(6)},${g.toFixed(6)},${b.toFixed(6)}`;
    const id = this.colorToId.get(key);
    return id ? this.objects.get(id) : undefined;
  }

  public getObjectColor(id: string): Vec3 | undefined {
    return this.idToColor.get(id);
  }

  public frustumCulling(
    viewProjectionMatrix: Mat4,
    objects?: DynamicObject[]
  ): DynamicObject[] {
    const objs = objects || this.getVisibleObjects();
    const planes = this.extractFrustumPlanes(viewProjectionMatrix);

    return objs.filter(obj => {
      const sphere = this.computeObjectBoundingSphere(obj);
      return this.isSphereInFrustum(sphere, planes);
    });
  }

  public getStats(): DynamicObjectManagerStats {
    const allObjects = Array.from(this.objects.values());

    return {
      objectCount: allObjects.length,
      dynamicObjectCount: allObjects.filter(o => !o.isStatic).length,
      staticObjectCount: allObjects.filter(o => o.isStatic).length,
      visibleObjectCount: allObjects.filter(o => o.isVisible).length,
    };
  }

  public getState(): DynamicObjectState {
    return {
      objects: new Map(this.objects),
      selectedObjectId: this.selectedObjectId,
      needsUpdate: this.needsUpdate,
    };
  }

  public resetNeedsUpdate(): void {
    this.needsUpdate = false;
  }

  public getNeedsUpdate(): boolean {
    return this.needsUpdate;
  }

  public subscribe(listener: (state: DynamicObjectState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public clear(): void {
    this.objects.clear();
    this.selectedObjectId = null;
    this.needsUpdate = true;
    this.idToColor.clear();
    this.colorToId.clear();
    this.nextColorId = 1;
    this.notifyListeners();
  }

  private computeModelMatrix(position: Vec3, rotation: Vec3, scale: Vec3): Mat4 {
    let matrix = mat4.identity();
    matrix = mat4.translate(matrix, position);
    matrix = mat4.rotateX(matrix, rotation[0]);
    matrix = mat4.rotateY(matrix, rotation[1]);
    matrix = mat4.rotateZ(matrix, rotation[2]);
    matrix = mat4.scale(matrix, scale);
    return matrix;
  }

  private assignObjectColor(id: string): void {
    const r = ((this.nextColorId >> 0) & 0xff) / 255;
    const g = ((this.nextColorId >> 8) & 0xff) / 255;
    const b = ((this.nextColorId >> 16) & 0xff) / 255;

    const color: Vec3 = [r, g, b];
    const key = `${r.toFixed(6)},${g.toFixed(6)},${b.toFixed(6)}`;

    this.idToColor.set(id, color);
    this.colorToId.set(key, id);
    this.nextColorId++;
  }

  private releaseObjectColor(id: string): void {
    const color = this.idToColor.get(id);
    if (color) {
      const key = `${color[0].toFixed(6)},${color[1].toFixed(6)},${color[2].toFixed(6)}`;
      this.colorToId.delete(key);
      this.idToColor.delete(id);
    }
  }

  private extractFrustumPlanes(matrix: Mat4): Vec3[] {
    const planes: Vec3[] = [];

    for (let i = 0; i < 4; i++) {
      planes.push([
        matrix[3] - matrix[i],
        matrix[7] - matrix[i + 4],
        matrix[11] - matrix[i + 8],
      ]);
      planes.push([
        matrix[3] + matrix[i],
        matrix[7] + matrix[i + 4],
        matrix[11] + matrix[i + 8],
      ]);
    }

    return planes.map(p => {
      const len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
      return len > 0 ? [p[0] / len, p[1] / len, p[2] / len] : p;
    });
  }

  private isSphereInFrustum(sphere: BoundingSphere, planes: Vec3[]): boolean {
    for (const plane of planes) {
      const distance = vec3.dot(plane, sphere.center);
      if (distance < -sphere.radius) {
        return false;
      }
    }
    return true;
  }

  private notifyListeners(): void {
    const state = this.getState();
    this.listeners.forEach(listener => listener(state));
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 11);
  }
}

export default DynamicObjectManager;
