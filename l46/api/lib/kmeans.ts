import { euclideanDistance, mean2D, EPS } from './utils.js';

export interface KMeansResult {
  labels: number[];
  centroids: number[][];
  inertia: number;
  iterations: number;
}

function kmeansPlusPlusInit(data: number[][], k: number): number[][] {
  const n = data.length;
  const centroids: number[][] = new Array(k);
  const firstIdx = Math.floor(Math.random() * n);
  centroids[0] = [...data[firstIdx]];
  
  for (let i = 1; i < k; i++) {
    const minDistSq: number[] = new Array(n).fill(Infinity);
    
    for (let j = 0; j < n; j++) {
      for (let c = 0; c < i; c++) {
        const dist = euclideanDistance(data[j], centroids[c]);
        const distSq = dist * dist;
        if (distSq < minDistSq[j]) {
          minDistSq[j] = distSq;
        }
      }
    }
    
    const totalDist = minDistSq.reduce((sum, d) => sum + d, 0);
    let r = Math.random() * totalDist;
    
    for (let j = 0; j < n; j++) {
      r -= minDistSq[j];
      if (r <= 0) {
        centroids[i] = [...data[j]];
        break;
      }
    }
    
    if (!centroids[i]) {
      centroids[i] = [...data[n - 1]];
    }
  }
  
  return centroids;
}

function assignLabels(data: number[][], centroids: number[][]): { labels: number[]; inertia: number } {
  const n = data.length;
  const k = centroids.length;
  const labels: number[] = new Array(n);
  let inertia = 0;
  
  for (let i = 0; i < n; i++) {
    let minDist = Infinity;
    let bestLabel = 0;
    
    for (let c = 0; c < k; c++) {
      const dist = euclideanDistance(data[i], centroids[c]);
      if (dist < minDist) {
        minDist = dist;
        bestLabel = c;
      }
    }
    
    labels[i] = bestLabel;
    inertia += minDist * minDist;
  }
  
  return { labels, inertia };
}

function updateCentroids(data: number[][], labels: number[], k: number): number[][] {
  const n = data.length;
  const d = data[0].length;
  const clusters: number[][][] = new Array(k);
  
  for (let c = 0; c < k; c++) {
    clusters[c] = [];
  }
  
  for (let i = 0; i < n; i++) {
    clusters[labels[i]].push(data[i]);
  }
  
  const centroids: number[][] = new Array(k);
  for (let c = 0; c < k; c++) {
    if (clusters[c].length === 0) {
      const randomIdx = Math.floor(Math.random() * n);
      centroids[c] = [...data[randomIdx]];
    } else {
      centroids[c] = mean2D(clusters[c]);
    }
  }
  
  return centroids;
}

export function kmeans(
  data: number[][],
  k: number,
  maxIterations: number = 100,
  tolerance: number = 1e-4,
  nInit: number = 10
): KMeansResult {
  if (!data || data.length === 0) {
    throw new Error('Data cannot be empty');
  }
  
  if (k <= 0 || k > data.length) {
    throw new Error(`Invalid number of clusters: ${k}`);
  }
  
  let bestResult: KMeansResult | null = null;
  
  for (let init = 0; init < nInit; init++) {
    let centroids = kmeansPlusPlusInit(data, k);
    let labels: number[] = [];
    let inertia = Infinity;
    let prevInertia = Infinity;
    let iterations = 0;
    
    for (let iter = 0; iter < maxIterations; iter++) {
      iterations = iter + 1;
      const assignment = assignLabels(data, centroids);
      labels = assignment.labels;
      prevInertia = inertia;
      inertia = assignment.inertia;
      
      if (Math.abs(prevInertia - inertia) / (prevInertia + EPS) < tolerance) {
        break;
      }
      
      centroids = updateCentroids(data, labels, k);
    }
    
    if (!bestResult || inertia < bestResult.inertia) {
      bestResult = {
        labels,
        centroids,
        inertia,
        iterations
      };
    }
  }
  
  return bestResult!;
}

export function getClusterStatistics(
  data: number[][],
  labels: number[],
  k: number
): { means: number[][]; covariances: number[][][]; sizes: number[] } {
  const d = data[0].length;
  const clusters: number[][][] = new Array(k);
  
  for (let c = 0; c < k; c++) {
    clusters[c] = [];
  }
  
  for (let i = 0; i < data.length; i++) {
    clusters[labels[i]].push(data[i]);
  }
  
  const means: number[][] = new Array(k);
  const covariances: number[][][] = new Array(k);
  const sizes: number[] = new Array(k);
  
  for (let c = 0; c < k; c++) {
    sizes[c] = clusters[c].length;
    
    if (sizes[c] === 0) {
      means[c] = new Array(d).fill(0);
      covariances[c] = new Array(d);
      for (let i = 0; i < d; i++) {
        covariances[c][i] = new Array(d).fill(0);
        if (i === i) covariances[c][i][i] = 1;
      }
      continue;
    }
    
    means[c] = mean2D(clusters[c]);
    
    const cov: number[][] = new Array(d);
    for (let i = 0; i < d; i++) {
      cov[i] = new Array(d).fill(0);
    }
    
    for (let p = 0; p < clusters[c].length; p++) {
      const point = clusters[c][p];
      for (let i = 0; i < d; i++) {
        for (let j = 0; j < d; j++) {
          const diffI = point[i] - means[c][i];
          const diffJ = point[j] - means[c][j];
          cov[i][j] += diffI * diffJ;
        }
      }
    }
    
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        cov[i][j] /= sizes[c];
        if (i === j && cov[i][j] < EPS) {
          cov[i][j] = EPS;
        }
      }
    }
    
    covariances[c] = cov;
  }
  
  return { means, covariances, sizes };
}
