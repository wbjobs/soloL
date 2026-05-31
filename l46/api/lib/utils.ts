const EPS = 1e-10;
const LOG_EPS = Math.log(EPS);

export function transpose(matrix: number[][]): number[][] {
  const rows = matrix.length;
  const cols = matrix[0].length;
  const result: number[][] = new Array(cols);
  for (let j = 0; j < cols; j++) {
    result[j] = new Array(rows);
    for (let i = 0; i < rows; i++) {
      result[j][i] = matrix[i][j];
    }
  }
  return result;
}

export function matMul(A: number[][], B: number[][]): number[][] {
  const m = A.length;
  const n = A[0].length;
  const p = B[0].length;
  const result: number[][] = new Array(m);
  for (let i = 0; i < m; i++) {
    result[i] = new Array(p).fill(0);
    for (let k = 0; k < n; k++) {
      const a = A[i][k];
      if (Math.abs(a) < EPS) continue;
      for (let j = 0; j < p; j++) {
        result[i][j] += a * B[k][j];
      }
    }
  }
  return result;
}

export function matVecMul(A: number[][], v: number[]): number[] {
  const m = A.length;
  const n = A[0].length;
  const result: number[] = new Array(m).fill(0);
  for (let i = 0; i < m; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += A[i][j] * v[j];
    }
    result[i] = sum;
  }
  return result;
}

export function vecMatMul(v: number[], A: number[][]): number[] {
  const n = A.length;
  const m = A[0].length;
  const result: number[] = new Array(m).fill(0);
  for (let j = 0; j < m; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += v[i] * A[i][j];
    }
    result[j] = sum;
  }
  return result;
}

export function determinant(matrix: number[][]): number {
  const n = matrix.length;
  if (n === 1) return matrix[0][0];
  if (n === 2) return matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  
  let det = 0;
  for (let j = 0; j < n; j++) {
    const subMatrix: number[][] = [];
    for (let i = 1; i < n; i++) {
      const row: number[] = [];
      for (let k = 0; k < n; k++) {
        if (k !== j) row.push(matrix[i][k]);
      }
      subMatrix.push(row);
    }
    det += matrix[0][j] * (j % 2 === 0 ? 1 : -1) * determinant(subMatrix);
  }
  return det;
}

export function invert(matrix: number[][]): number[][] {
  const n = matrix.length;
  const augmented: number[][] = new Array(n);
  
  for (let i = 0; i < n; i++) {
    augmented[i] = new Array(2 * n);
    for (let j = 0; j < n; j++) {
      augmented[i][j] = matrix[i][j];
      augmented[i][j + n] = i === j ? 1 : 0;
    }
  }
  
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(augmented[col][col]);
    for (let row = col + 1; row < n; row++) {
      const val = Math.abs(augmented[row][col]);
      if (val > maxVal) {
        maxVal = val;
        maxRow = row;
      }
    }
    
    if (maxVal < EPS) {
      throw new Error('Matrix is singular');
    }
    
    if (maxRow !== col) {
      [augmented[col], augmented[maxRow]] = [augmented[maxRow], augmented[col]];
    }
    
    const pivot = augmented[col][col];
    for (let j = col; j < 2 * n; j++) {
      augmented[col][j] /= pivot;
    }
    
    for (let row = 0; row < n; row++) {
      if (row !== col && Math.abs(augmented[row][col]) > EPS) {
        const factor = augmented[row][col];
        for (let j = col; j < 2 * n; j++) {
          augmented[row][j] -= factor * augmented[col][j];
        }
      }
    }
  }
  
  const inverse: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    inverse[i] = augmented[i].slice(n);
  }
  return inverse;
}

export function gaussianPDF(x: number[], mu: number[], sigma: number[][]): number {
  const d = x.length;
  const diff: number[] = new Array(d);
  for (let i = 0; i < d; i++) {
    diff[i] = x[i] - mu[i];
  }
  
  const detSigma = determinant(sigma);
  if (detSigma <= 0) return EPS;
  
  const invSigma = invert(sigma);
  const temp = matVecMul(invSigma, diff);
  
  let exponent = 0;
  for (let i = 0; i < d; i++) {
    exponent += diff[i] * temp[i];
  }
  exponent *= -0.5;
  
  const norm = Math.pow(2 * Math.PI, d / 2) * Math.sqrt(detSigma);
  const result = Math.exp(exponent) / norm;
  
  return Math.max(result, EPS);
}

export function logGaussianPDF(x: number[], mu: number[], sigma: number[][]): number {
  const d = x.length;
  const diff: number[] = new Array(d);
  for (let i = 0; i < d; i++) {
    diff[i] = x[i] - mu[i];
  }
  
  let detSigma = determinant(sigma);
  if (detSigma <= EPS) detSigma = EPS;
  
  const invSigma = invert(sigma);
  const temp = matVecMul(invSigma, diff);
  
  let exponent = 0;
  for (let i = 0; i < d; i++) {
    exponent += diff[i] * temp[i];
  }
  exponent *= -0.5;
  
  const logNorm = (d / 2) * Math.log(2 * Math.PI) + 0.5 * Math.log(detSigma);
  const result = exponent - logNorm;
  
  return isFinite(result) ? result : LOG_EPS;
}

export function logSumExp(logProbs: number[]): number {
  if (logProbs.length === 0) return LOG_EPS;
  
  let maxLog = logProbs[0];
  for (let i = 1; i < logProbs.length; i++) {
    if (logProbs[i] > maxLog) maxLog = logProbs[i];
  }
  
  if (maxLog === -Infinity) return -Infinity;
  
  let sum = 0;
  for (let i = 0; i < logProbs.length; i++) {
    sum += Math.exp(logProbs[i] - maxLog);
  }
  
  return maxLog + Math.log(sum);
}

export function logSumExp2D(logProbs: number[][]): number[] {
  const T = logProbs.length;
  const result: number[] = new Array(T);
  for (let t = 0; t < T; t++) {
    result[t] = logSumExp(logProbs[t]);
  }
  return result;
}

export function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum / arr.length;
}

export function variance(arr: number[], meanVal?: number): number {
  if (arr.length === 0) return 0;
  const m = meanVal !== undefined ? meanVal : mean(arr);
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    const diff = arr[i] - m;
    sum += diff * diff;
  }
  return sum / arr.length;
}

export function stdDev(arr: number[], meanVal?: number): number {
  return Math.sqrt(variance(arr, meanVal));
}

export function mean2D(points: number[][]): number[] {
  const n = points.length;
  const d = points[0].length;
  const result: number[] = new Array(d).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      result[j] += points[i][j];
    }
  }
  for (let j = 0; j < d; j++) {
    result[j] /= n;
  }
  return result;
}

export function covarianceMatrix(points: number[][], mu: number[]): number[][] {
  const n = points.length;
  const d = mu.length;
  const sigma: number[][] = new Array(d);
  
  for (let i = 0; i < d; i++) {
    sigma[i] = new Array(d).fill(0);
  }
  
  for (let p = 0; p < n; p++) {
    const diff: number[] = new Array(d);
    for (let i = 0; i < d; i++) {
      diff[i] = points[p][i] - mu[i];
    }
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) {
        sigma[i][j] += diff[i] * diff[j];
      }
    }
  }
  
  for (let i = 0; i < d; i++) {
    for (let j = 0; j < d; j++) {
      sigma[i][j] /= n;
      if (i === j && sigma[i][j] < EPS) {
        sigma[i][j] = EPS;
      }
    }
  }
  
  return sigma;
}

export function normalize(arr: number[]): number[] {
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum < EPS) return new Array(arr.length).fill(1 / arr.length);
  return arr.map(x => x / sum);
}

export function logNormalize(logArr: number[]): number[] {
  const logSum = logSumExp(logArr);
  return logArr.map(x => x - logSum);
}

export function euclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

export function standardizeFeatures(data: number[][]): { standardized: number[][]; means: number[]; stds: number[] } {
  const n = data.length;
  const d = data[0].length;
  const means: number[] = new Array(d).fill(0);
  const stds: number[] = new Array(d).fill(0);
  
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < n; i++) {
      means[j] += data[i][j];
    }
    means[j] /= n;
  }
  
  for (let j = 0; j < d; j++) {
    for (let i = 0; i < n; i++) {
      const diff = data[i][j] - means[j];
      stds[j] += diff * diff;
    }
    stds[j] = Math.sqrt(stds[j] / n);
    if (stds[j] < EPS) stds[j] = 1;
  }
  
  const standardized: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    standardized[i] = new Array(d);
    for (let j = 0; j < d; j++) {
      standardized[i][j] = (data[i][j] - means[j]) / stds[j];
    }
  }
  
  return { standardized, means, stds };
}

export function clip(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export { EPS, LOG_EPS };
