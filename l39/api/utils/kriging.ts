import { Point3D, KrigingParams } from '../../shared/types';

class KDTree {
  private points: Point3D[];
  private values: number[];
  private tree: any;

  constructor(points: Point3D[], values: number[]) {
    this.points = points;
    this.values = values;
    this.tree = this.buildTree(points, 0);
  }

  private buildTree(points: Point3D[], depth: number): any {
    if (points.length === 0) return null;

    const axis = depth % 3;
    const sorted = [...points].sort((a, b) => {
      if (axis === 0) return a.x - b.x;
      if (axis === 1) return a.y - b.y;
      return a.z - b.z;
    });

    const median = Math.floor(sorted.length / 2);
    const point = sorted[median];
    const index = this.points.findIndex(p => p.x === point.x && p.y === point.y && p.z === point.z);

    return {
      point,
      value: this.values[index],
      index,
      left: this.buildTree(sorted.slice(0, median), depth + 1),
      right: this.buildTree(sorted.slice(median + 1), depth + 1)
    };
  }

  public searchNeighbors(target: Point3D, radius: number, maxCount: number): { point: Point3D; value: number; distance: number }[] {
    const results: { point: Point3D; value: number; distance: number; index: number }[] = [];
    this.searchRecursive(this.tree, target, radius, 0, results);
    
    return results
      .sort((a, b) => a.distance - b.distance)
      .slice(0, maxCount)
      .map(r => ({ point: r.point, value: r.value, distance: r.distance }));
  }

  private searchRecursive(node: any, target: Point3D, radius: number, depth: number, results: any[]): void {
    if (!node) return;

    const distance = this.distance(node.point, target);
    if (distance <= radius) {
      results.push({
        point: node.point,
        value: node.value,
        distance,
        index: node.index
      });
    }

    const axis = depth % 3;
    const diff = axis === 0 ? target.x - node.point.x : 
                 axis === 1 ? target.y - node.point.y : 
                 target.z - node.point.z;

    if (diff < radius) {
      this.searchRecursive(diff < 0 ? node.left : node.right, target, radius, depth + 1, results);
    }
    if (Math.abs(diff) < radius) {
      this.searchRecursive(diff < 0 ? node.right : node.left, target, radius, depth + 1, results);
    }
  }

  private distance(a: Point3D, b: Point3D): number {
    return Math.sqrt(
      Math.pow(a.x - b.x, 2) + 
      Math.pow(a.y - b.y, 2) + 
      Math.pow(a.z - b.z, 2)
    );
  }
}

export function variogram(h: number, params: KrigingParams): number {
  const { model, range, sill, nugget } = params;
  
  if (h === 0) return 0;
  
  const normalizedH = h / range;
  
  switch (model) {
    case 'spherical':
      if (h >= range) return sill;
      return nugget + (sill - nugget) * (1.5 * normalizedH - 0.5 * Math.pow(normalizedH, 3));
    
    case 'exponential':
      return nugget + (sill - nugget) * (1 - Math.exp(-3 * normalizedH));
    
    case 'gaussian':
      return nugget + (sill - nugget) * (1 - Math.exp(-3 * Math.pow(normalizedH, 2)));
    
    default:
      return variogram(h, { ...params, model: 'spherical' });
  }
}

export function ordinaryKriging(
  interpolationPoint: Point3D,
  controlPoints: Point3D[],
  values: number[],
  params: KrigingParams
): { value: number; variance: number } {
  const { searchRadius, maxNeighbors } = params;
  
  const kdTree = new KDTree(controlPoints, values);
  const neighbors = kdTree.searchNeighbors(interpolationPoint, searchRadius, maxNeighbors);
  
  if (neighbors.length === 0) {
    return { value: 0, variance: params.sill };
  }
  
  if (neighbors.length === 1) {
    return { value: neighbors[0].value, variance: params.sill };
  }
  
  const n = neighbors.length;
  const matrixSize = n + 1;
  
  const K: number[][] = [];
  for (let i = 0; i < n; i++) {
    K[i] = [];
    for (let j = 0; j < n; j++) {
      const dist = Math.sqrt(
        Math.pow(neighbors[i].point.x - neighbors[j].point.x, 2) +
        Math.pow(neighbors[i].point.y - neighbors[j].point.y, 2) +
        Math.pow(neighbors[i].point.z - neighbors[j].point.z, 2)
      );
      K[i][j] = variogram(dist, params);
    }
    K[i][n] = 1;
  }
  K[n] = new Array(n + 1).fill(1);
  K[n][n] = 0;
  
  const M: number[] = [];
  for (let i = 0; i < n; i++) {
    M[i] = variogram(neighbors[i].distance, params);
  }
  M[n] = 1;
  
  const weights = solveLinearSystem(K, M);
  
  let estimatedValue = 0;
  let estimationVariance = M[n] * weights[n];
  
  for (let i = 0; i < n; i++) {
    estimatedValue += weights[i] * neighbors[i].value;
    estimationVariance += weights[i] * M[i];
  }
  
  return {
    value: estimatedValue,
    variance: Math.max(0, estimationVariance)
  };
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const augmented: number[][] = [];
  
  for (let i = 0; i < n; i++) {
    augmented[i] = [...A[i], b[i]];
  }
  
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(augmented[row][col]) > Math.abs(augmented[maxRow][col])) {
        maxRow = row;
      }
    }
    
    [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];
    
    const pivot = augmented[col][col];
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('Matrix is singular');
    }
    
    for (let j = col; j <= n; j++) {
      augmented[col][j] /= pivot;
    }
    
    for (let row = 0; row < n; row++) {
      if (row !== col && Math.abs(augmented[row][col]) > 1e-10) {
        const factor = augmented[row][col];
        for (let j = col; j <= n; j++) {
          augmented[row][j] -= factor * augmented[col][j];
        }
      }
    }
  }
  
  const solution: number[] = [];
  for (let i = 0; i < n; i++) {
    solution[i] = augmented[i][n];
  }
  
  return solution;
}

export function generateMockControlPoints(): { points: Point3D[]; values: number[] } {
  const points: Point3D[] = [];
  const values: number[] = [];
  
  const gridSize = 8;
  const spacing = 50;
  
  for (let ix = 0; ix < gridSize; ix++) {
    for (let iy = 0; iy < gridSize; iy++) {
      for (let iz = 0; iz < 5; iz++) {
        const x = (ix - gridSize / 2) * spacing + (Math.random() - 0.5) * 20;
        const y = (iy - gridSize / 2) * spacing + (Math.random() - 0.5) * 20;
        const z = iz * 20 + (Math.random() - 0.5) * 5;
        
        const distFromCenter = Math.sqrt(x * x + y * y + z * z);
        const layerValue = Math.floor(z / 20);
        
        let baseValue: number;
        switch (layerValue) {
          case 0: baseValue = 1.0; break;
          case 1: baseValue = 2.5; break;
          case 2: baseValue = 4.0; break;
          case 3: baseValue = 5.5; break;
          default: baseValue = 7.0;
        }
        
        const value = baseValue + 
                      Math.sin(x * 0.02) * 0.3 + 
                      Math.cos(y * 0.02) * 0.3 + 
                      (Math.random() - 0.5) * 0.2 -
                      distFromCenter * 0.001;
        
        points.push({ x, y, z });
        values.push(value);
      }
    }
  }
  
  return { points, values };
}

export function identifyFormation(value: number): number {
  if (value < 1.5) return 0;
  if (value < 3.0) return 1;
  if (value < 4.5) return 2;
  if (value < 6.0) return 3;
  return 4;
}
