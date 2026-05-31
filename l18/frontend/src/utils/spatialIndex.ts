import * as THREE from 'three';

interface OctreeNode {
  min: THREE.Vector3;
  max: THREE.Vector3;
  center: THREE.Vector3;
  children: OctreeNode[] | null;
  pointIndices: number[];
}

export class Octree {
  private root: OctreeNode;
  private maxDepth: number;
  private maxPointsPerNode: number;
  private points: Float32Array;

  constructor(
    points: Float32Array,
    maxDepth: number = 8,
    maxPointsPerNode: number = 1000
  ) {
    this.points = points;
    this.maxDepth = maxDepth;
    this.maxPointsPerNode = maxPointsPerNode;

    const bounds = this.calculateBounds(points);
    this.root = this.createNode(bounds.min, bounds.max);
    
    const pointCount = points.length / 3;
    for (let i = 0; i < pointCount; i++) {
      this.insertPoint(i, this.root, 0);
    }
  }

  private calculateBounds(points: Float32Array): { min: THREE.Vector3; max: THREE.Vector3 } {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    for (let i = 0; i < points.length; i += 3) {
      minX = Math.min(minX, points[i]);
      minY = Math.min(minY, points[i + 1]);
      minZ = Math.min(minZ, points[i + 2]);
      maxX = Math.max(maxX, points[i]);
      maxY = Math.max(maxY, points[i + 1]);
      maxZ = Math.max(maxZ, points[i + 2]);
    }

    const padding = 0.01;
    return {
      min: new THREE.Vector3(minX - padding, minY - padding, minZ - padding),
      max: new THREE.Vector3(maxX + padding, maxY + padding, maxZ + padding),
    };
  }

  private createNode(min: THREE.Vector3, max: THREE.Vector3): OctreeNode {
    return {
      min,
      max,
      center: new THREE.Vector3(
        (min.x + max.x) / 2,
        (min.y + max.y) / 2,
        (min.z + max.z) / 2
      ),
      children: null,
      pointIndices: [],
    };
  }

  private insertPoint(pointIndex: number, node: OctreeNode, depth: number): void {
    if (depth >= this.maxDepth) {
      node.pointIndices.push(pointIndex);
      return;
    }

    if (!node.children && node.pointIndices.length < this.maxPointsPerNode) {
      node.pointIndices.push(pointIndex);
      return;
    }

    if (!node.children) {
      this.splitNode(node);
      
      for (const idx of node.pointIndices) {
        this.insertPoint(idx, node, depth);
      }
      node.pointIndices = [];
    }

    const px = this.points[pointIndex * 3];
    const py = this.points[pointIndex * 3 + 1];
    const pz = this.points[pointIndex * 3 + 2];

    const childIndex = this.getChildIndex(node, px, py, pz);
    this.insertPoint(pointIndex, node.children![childIndex], depth + 1);
  }

  private splitNode(node: OctreeNode): void {
    const { min, max, center } = node;
    
    node.children = [
      this.createNode(new THREE.Vector3(min.x, min.y, min.z), new THREE.Vector3(center.x, center.y, center.z)),
      this.createNode(new THREE.Vector3(center.x, min.y, min.z), new THREE.Vector3(max.x, center.y, center.z)),
      this.createNode(new THREE.Vector3(min.x, center.y, min.z), new THREE.Vector3(center.x, max.y, center.z)),
      this.createNode(new THREE.Vector3(center.x, center.y, min.z), new THREE.Vector3(max.x, max.y, center.z)),
      this.createNode(new THREE.Vector3(min.x, min.y, center.z), new THREE.Vector3(center.x, center.y, max.z)),
      this.createNode(new THREE.Vector3(center.x, min.y, center.z), new THREE.Vector3(max.x, center.y, max.z)),
      this.createNode(new THREE.Vector3(min.x, center.y, center.z), new THREE.Vector3(center.x, max.y, max.z)),
      this.createNode(new THREE.Vector3(center.x, center.y, center.z), new THREE.Vector3(max.x, max.y, max.z)),
    ];
  }

  private getChildIndex(node: OctreeNode, x: number, y: number, z: number): number {
    const { center } = node;
    let index = 0;
    
    if (x >= center.x) index |= 1;
    if (y >= center.y) index |= 2;
    if (z >= center.z) index |= 4;
    
    return index;
  }

  querySphere(center: THREE.Vector3, radius: number): number[] {
    const result: number[] = [];
    this.querySphereRecursive(this.root, center, radius, result);
    return result;
  }

  private querySphereRecursive(
    node: OctreeNode,
    center: THREE.Vector3,
    radius: number,
    result: number[]
  ): void {
    if (!this.intersectsSphere(node, center, radius)) {
      return;
    }

    if (node.children) {
      for (const child of node.children) {
        this.querySphereRecursive(child, center, radius, result);
      }
    } else {
      const radiusSq = radius * radius;
      for (const idx of node.pointIndices) {
        const px = this.points[idx * 3];
        const py = this.points[idx * 3 + 1];
        const pz = this.points[idx * 3 + 2];
        
        const dx = px - center.x;
        const dy = py - center.y;
        const dz = pz - center.z;
        const distSq = dx * dx + dy * dy + dz * dz;
        
        if (distSq <= radiusSq) {
          result.push(idx);
        }
      }
    }
  }

  queryBox(min: THREE.Vector3, max: THREE.Vector3): number[] {
    const result: number[] = [];
    this.queryBoxRecursive(this.root, min, max, result);
    return result;
  }

  private queryBoxRecursive(
    node: OctreeNode,
    min: THREE.Vector3,
    max: THREE.Vector3,
    result: number[]
  ): void {
    if (!this.intersectsBox(node, min, max)) {
      return;
    }

    if (node.children) {
      for (const child of node.children) {
        this.queryBoxRecursive(child, min, max, result);
      }
    } else {
      for (const idx of node.pointIndices) {
        const px = this.points[idx * 3];
        const py = this.points[idx * 3 + 1];
        const pz = this.points[idx * 3 + 2];
        
        if (
          px >= min.x && px <= max.x &&
          py >= min.y && py <= max.y &&
          pz >= min.z && pz <= max.z
        ) {
          result.push(idx);
        }
      }
    }
  }

  private intersectsSphere(node: OctreeNode, center: THREE.Vector3, radius: number): boolean {
    const { min, max } = node;
    const radiusSq = radius * radius;
    
    let distSq = 0;
    
    if (center.x < min.x) distSq += (center.x - min.x) ** 2;
    else if (center.x > max.x) distSq += (center.x - max.x) ** 2;
    
    if (center.y < min.y) distSq += (center.y - min.y) ** 2;
    else if (center.y > max.y) distSq += (center.y - max.y) ** 2;
    
    if (center.z < min.z) distSq += (center.z - min.z) ** 2;
    else if (center.z > max.z) distSq += (center.z - max.z) ** 2;
    
    return distSq <= radiusSq;
  }

  private intersectsBox(node: OctreeNode, min: THREE.Vector3, max: THREE.Vector3): boolean {
    return (
      node.min.x <= max.x && node.max.x >= min.x &&
      node.min.y <= max.y && node.max.y >= min.y &&
      node.min.z <= max.z && node.max.z >= min.z
    );
  }

  getNearestPoint(point: THREE.Vector3): number | null {
    let nearestIdx: number | null = null;
    let nearestDistSq = Infinity;

    const stack: OctreeNode[] = [this.root];

    while (stack.length > 0) {
      const node = stack.pop()!;

      if (node.children) {
        const sortedChildren = [...node.children].sort((a, b) => {
          const distA = a.center.distanceToSquared(point);
          const distB = b.center.distanceToSquared(point);
          return distA - distB;
        });

        for (const child of sortedChildren.reverse()) {
          stack.push(child);
        }
      } else {
        for (const idx of node.pointIndices) {
          const px = this.points[idx * 3];
          const py = this.points[idx * 3 + 1];
          const pz = this.points[idx * 3 + 2];
          
          const dx = px - point.x;
          const dy = py - point.y;
          const dz = pz - point.z;
          const distSq = dx * dx + dy * dy + dz * dz;
          
          if (distSq < nearestDistSq) {
            nearestDistSq = distSq;
            nearestIdx = idx;
          }
        }
      }
    }

    return nearestIdx;
  }
}

export class SpatialGrid {
  private cellSize: number;
  private grid: Map<string, number[]>;
  private points: Float32Array;

  constructor(points: Float32Array, cellSize: number = 1.0) {
    this.points = points;
    this.cellSize = cellSize;
    this.grid = new Map();

    const pointCount = points.length / 3;
    for (let i = 0; i < pointCount; i++) {
      const x = Math.floor(points[i * 3] / cellSize);
      const y = Math.floor(points[i * 3 + 1] / cellSize);
      const z = Math.floor(points[i * 3 + 2] / cellSize);
      const key = `${x},${y},${z}`;

      if (!this.grid.has(key)) {
        this.grid.set(key, []);
      }
      this.grid.get(key)!.push(i);
    }
  }

  querySphere(center: THREE.Vector3, radius: number): number[] {
    const result: number[] = [];
    const radiusSq = radius * radius;
    
    const minX = Math.floor((center.x - radius) / this.cellSize);
    const maxX = Math.floor((center.x + radius) / this.cellSize);
    const minY = Math.floor((center.y - radius) / this.cellSize);
    const maxY = Math.floor((center.y + radius) / this.cellSize);
    const minZ = Math.floor((center.z - radius) / this.cellSize);
    const maxZ = Math.floor((center.z + radius) / this.cellSize);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = `${x},${y},${z}`;
          const cell = this.grid.get(key);
          
          if (cell) {
            for (const idx of cell) {
              const px = this.points[idx * 3];
              const py = this.points[idx * 3 + 1];
              const pz = this.points[idx * 3 + 2];
              
              const dx = px - center.x;
              const dy = py - center.y;
              const dz = pz - center.z;
              const distSq = dx * dx + dy * dy + dz * dz;
              
              if (distSq <= radiusSq) {
                result.push(idx);
              }
            }
          }
        }
      }
    }

    return result;
  }

  queryBox(min: THREE.Vector3, max: THREE.Vector3): number[] {
    const result: number[] = [];
    
    const minX = Math.floor(min.x / this.cellSize);
    const maxX = Math.floor(max.x / this.cellSize);
    const minY = Math.floor(min.y / this.cellSize);
    const maxY = Math.floor(max.y / this.cellSize);
    const minZ = Math.floor(min.z / this.cellSize);
    const maxZ = Math.floor(max.z / this.cellSize);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          const key = `${x},${y},${z}`;
          const cell = this.grid.get(key);
          
          if (cell) {
            for (const idx of cell) {
              const px = this.points[idx * 3];
              const py = this.points[idx * 3 + 1];
              const pz = this.points[idx * 3 + 2];
              
              if (
                px >= min.x && px <= max.x &&
                py >= min.y && py <= max.y &&
                pz >= min.z && pz <= max.z
              ) {
                result.push(idx);
              }
            }
          }
        }
      }
    }

    return result;
  }
}

export function filterBackFacingPoints(
  pointIndices: number[],
  points: Float32Array,
  cameraPosition: THREE.Vector3,
  brushCenter: THREE.Vector3,
  threshold: number = 0.1
): number[] {
  return pointIndices.filter((idx) => {
    const px = points[idx * 3];
    const py = points[idx * 3 + 1];
    const pz = points[idx * 3 + 2];

    const viewDir = new THREE.Vector3(
      cameraPosition.x - px,
      cameraPosition.y - py,
      cameraPosition.z - pz
    ).normalize();

    const pointToCenter = new THREE.Vector3(
      brushCenter.x - px,
      brushCenter.y - py,
      brushCenter.z - pz
    ).normalize();

    const dotProduct = viewDir.dot(pointToCenter);
    return dotProduct >= threshold;
  });
}

export default Octree;
