import { Point3D, KrigingParams, Fault, FaultPoint, IndicatorKrigingResult } from '../../shared/types';

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

export function distance3D(a: Point3D, b: Point3D): number {
  return Math.sqrt(
    Math.pow(a.x - b.x, 2) + 
    Math.pow(a.y - b.y, 2) + 
    Math.pow(a.z - b.z, 2)
  );
}

export function distanceToFaultPlane(point: Point3D, fault: Fault): { distance: number; side: number } {
  if (fault.points.length < 3) {
    return { distance: Infinity, side: 1 };
  }

  const strikeRad = (fault.strike * Math.PI) / 180;
  const dipRad = (fault.dip * Math.PI) / 180;
  
  const normal = {
    x: Math.sin(strikeRad) * Math.sin(dipRad),
    y: -Math.cos(strikeRad) * Math.sin(dipRad),
    z: Math.cos(dipRad)
  };
  
  const origin = fault.points[0];
  const d = -(normal.x * origin.x + normal.y * origin.y + normal.z * origin.z);
  
  const distance = normal.x * point.x + normal.y * point.y + normal.z * point.z + d;
  const normalizer = Math.sqrt(normal.x * normal.x + normal.y * normal.y + normal.z * normal.z);
  
  return {
    distance: Math.abs(distance) / normalizer,
    side: distance >= 0 ? 1 : -1
  };
}

export function distanceToNearestFault(point: Point3D, faults: Fault[]): { distance: number; nearestFault: Fault | null; side: number } {
  let minDistance = Infinity;
  let nearestFault: Fault | null = null;
  let nearestSide = 1;
  
  for (const fault of faults) {
    const { distance, side } = distanceToFaultPlane(point, fault);
    if (distance < minDistance) {
      minDistance = distance;
      nearestFault = fault;
      nearestSide = side;
    }
  }
  
  return { distance: minDistance, nearestFault, side: nearestSide };
}

export function calculateLocalRange(
  point: Point3D,
  faults: Fault[],
  baseRange: number,
  influenceZone: number = 50
): number {
  const { distance } = distanceToNearestFault(point, faults);
  
  if (distance >= influenceZone) {
    return baseRange;
  }
  
  const factor = 0.3 + 0.7 * (distance / influenceZone);
  return baseRange * factor;
}

export function indicatorTransform(values: number[], threshold: number): number[] {
  return values.map(v => v <= threshold ? 1 : 0);
}

export function indicatorKriging(
  interpolationPoint: Point3D,
  controlPoints: Point3D[],
  values: number[],
  params: KrigingParams,
  threshold: number
): IndicatorKrigingResult {
  const indicators = indicatorTransform(values, threshold);
  
  const { searchRadius, maxNeighbors } = params;
  const kdTree = new KDTree(controlPoints, indicators);
  const neighbors = kdTree.searchNeighbors(interpolationPoint, searchRadius, maxNeighbors);
  
  if (neighbors.length === 0) {
    return { probability: 0.5, variance: 1.0, indicator: 0 };
  }
  
  if (neighbors.length === 1) {
    return { 
      probability: neighbors[0].value, 
      variance: 0.5, 
      indicator: neighbors[0].value 
    };
  }
  
  const n = neighbors.length;
  const matrixSize = n + 1;
  
  const K: number[][] = [];
  for (let i = 0; i < n; i++) {
    K[i] = [];
    for (let j = 0; j < n; j++) {
      const dist = distance3D(neighbors[i].point, neighbors[j].point);
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
  
  try {
    const weights = solveLinearSystem(K, M);
    
    let probability = 0;
    let variance = M[n] * weights[n];
    
    for (let i = 0; i < n; i++) {
      probability += weights[i] * neighbors[i].value;
      variance += weights[i] * M[i];
    }
    
    probability = Math.max(0, Math.min(1, probability));
    
    return {
      probability,
      variance: Math.max(0, variance),
      indicator: probability >= 0.5 ? 1 : 0
    };
  } catch (e) {
    const avgIndicator = neighbors.reduce((sum, n) => sum + n.value, 0) / n;
    return { probability: avgIndicator, variance: 1.0, indicator: avgIndicator >= 0.5 ? 1 : 0 };
  }
}

export function faultConstrainedKriging(
  interpolationPoint: Point3D,
  controlPoints: Point3D[],
  values: number[],
  params: KrigingParams,
  faults: Fault[] = []
): { value: number; variance: number; indicatorProbability: number } {
  let localParams = { ...params };
  
  if (params.localRangeAdjustment && faults.length > 0) {
    localParams.range = calculateLocalRange(interpolationPoint, faults, params.range);
  }
  
  const filteredPoints: Point3D[] = [];
  const filteredValues: number[] = [];
  
  if (faults.length > 0) {
    const { nearestFault, side } = distanceToNearestFault(interpolationPoint, faults);
    
    for (let i = 0; i < controlPoints.length; i++) {
      const pointInfo = distanceToNearestFault(controlPoints[i], faults);
      if (pointInfo.side === side || pointInfo.distance > params.searchRadius) {
        filteredPoints.push(controlPoints[i]);
        filteredValues.push(values[i]);
      }
    }
  }
  
  const usePoints = filteredPoints.length > 0 ? filteredPoints : controlPoints;
  const useValues = filteredValues.length > 0 ? filteredValues : values;
  
  const indicatorResult = params.useIndicatorKriging
    ? indicatorKriging(
        interpolationPoint, 
        controlPoints, 
        values, 
        localParams, 
        params.indicatorThreshold || 4.0
      )
    : { probability: 1.0, variance: 0, indicator: 1 };
  
  const { searchRadius, maxNeighbors } = localParams;
  const kdTree = new KDTree(usePoints, useValues);
  const neighbors = kdTree.searchNeighbors(interpolationPoint, searchRadius, maxNeighbors);
  
  if (neighbors.length === 0) {
    return { value: 0, variance: params.sill, indicatorProbability: indicatorResult.probability };
  }
  
  if (neighbors.length === 1) {
    return { 
      value: neighbors[0].value, 
      variance: params.sill,
      indicatorProbability: indicatorResult.probability 
    };
  }
  
  const n = neighbors.length;
  const matrixSize = n + 1;
  
  const K: number[][] = [];
  for (let i = 0; i < n; i++) {
    K[i] = [];
    for (let j = 0; j < n; j++) {
      const dist = distance3D(neighbors[i].point, neighbors[j].point);
      K[i][j] = variogram(dist, localParams);
    }
    K[i][n] = 1;
  }
  K[n] = new Array(n + 1).fill(1);
  K[n][n] = 0;
  
  const M: number[] = [];
  for (let i = 0; i < n; i++) {
    M[i] = variogram(neighbors[i].distance, localParams);
  }
  M[n] = 1;
  
  try {
    const weights = solveLinearSystem(K, M);
    
    let estimatedValue = 0;
    let estimationVariance = M[n] * weights[n];
    
    for (let i = 0; i < n; i++) {
      estimatedValue += weights[i] * neighbors[i].value;
      estimationVariance += weights[i] * M[i];
    }
    
    if (params.useIndicatorKriging && indicatorResult.probability < 0.3) {
      const meanValue = neighbors.reduce((sum, n) => sum + n.value, 0) / n;
      estimatedValue = estimatedValue * indicatorResult.probability + meanValue * (1 - indicatorResult.probability);
      estimationVariance *= 1.5;
    }
    
    return {
      value: estimatedValue,
      variance: Math.max(0, estimationVariance),
      indicatorProbability: indicatorResult.probability
    };
  } catch (e) {
    const meanValue = neighbors.reduce((sum, n) => sum + n.value, 0) / n;
    return { 
      value: meanValue, 
      variance: params.sill,
      indicatorProbability: indicatorResult.probability 
    };
  }
}

export function detectFaults(
  controlPoints: Point3D[],
  values: number[],
  threshold: number = 2.0,
  minClusterSize: number = 5
): Fault[] {
  const gradients: { point: Point3D; gradient: number; direction: Point3D }[] = [];
  const kdTree = new KDTree(controlPoints, values);
  
  for (let i = 0; i < controlPoints.length; i++) {
    const point = controlPoints[i];
    const neighbors = kdTree.searchNeighbors(point, 30, 8);
    
    if (neighbors.length >= 3) {
      const dx = neighbors.reduce((sum, n) => 
        sum + (n.value - values[i]) * (n.point.x - point.x) / (n.distance + 1e-6), 0
      ) / neighbors.length;
      const dy = neighbors.reduce((sum, n) => 
        sum + (n.value - values[i]) * (n.point.y - point.y) / (n.distance + 1e-6), 0
      ) / neighbors.length;
      const dz = neighbors.reduce((sum, n) => 
        sum + (n.value - values[i]) * (n.point.z - point.z) / (n.distance + 1e-6), 0
      ) / neighbors.length;
      
      const gradientMagnitude = Math.sqrt(dx * dx + dy * dy + dz * dz);
      
      if (gradientMagnitude > threshold) {
        gradients.push({
          point,
          gradient: gradientMagnitude,
          direction: {
            x: dx / gradientMagnitude,
            y: dy / gradientMagnitude,
            z: dz / gradientMagnitude
          }
        });
      }
    }
  }
  
  if (gradients.length < minClusterSize) {
    return [];
  }
  
  const clusters: { points: FaultPoint[]; directions: Point3D[] }[] = [];
  const used = new Set<number>();
  
  for (let i = 0; i < gradients.length; i++) {
    if (used.has(i)) continue;
    
    const cluster = { points: [] as FaultPoint[], directions: [] as Point3D[] };
    const seed = gradients[i];
    const queue = [i];
    used.add(i);
    
    while (queue.length > 0) {
      const idx = queue.shift()!;
      const g = gradients[idx];
      
      cluster.points.push({
        x: g.point.x,
        y: g.point.y,
        z: g.point.z,
        throw: g.gradient,
        confidence: Math.min(1, g.gradient / threshold / 2)
      });
      cluster.directions.push(g.direction);
      
      for (let j = 0; j < gradients.length; j++) {
        if (used.has(j)) continue;
        
        const dist = distance3D(g.point, gradients[j].point);
        const dotProduct = 
          g.direction.x * gradients[j].direction.x +
          g.direction.y * gradients[j].direction.y +
          g.direction.z * gradients[j].direction.z;
        
        if (dist < 50 && Math.abs(dotProduct) > 0.7) {
          used.add(j);
          queue.push(j);
        }
      }
    }
    
    if (cluster.points.length >= minClusterSize) {
      clusters.push(cluster);
    }
  }
  
  const colors = ['#ff4757', '#ff6348', '#ff7f50', '#ff9f43', '#fa983a'];
  
  return clusters.map((cluster, idx) => {
    const avgDirection = {
      x: cluster.directions.reduce((s, d) => s + d.x, 0) / cluster.directions.length,
      y: cluster.directions.reduce((s, d) => s + d.y, 0) / cluster.directions.length,
      z: cluster.directions.reduce((s, d) => s + d.z, 0) / cluster.directions.length
    };
    
    const strike = Math.atan2(avgDirection.y, avgDirection.x) * 180 / Math.PI;
    const dip = Math.acos(Math.min(1, Math.max(-1, avgDirection.z))) * 180 / Math.PI;
    
    return {
      id: `fault_${idx}`,
      name: `断层 F${idx + 1}`,
      points: cluster.points,
      strike: strike,
      dip: dip,
      color: colors[idx % colors.length]
    };
  });
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
        
        const faultOffset = x > 20 && x < 40 ? 1.5 : 0;
        
        const value = baseValue + faultOffset +
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
