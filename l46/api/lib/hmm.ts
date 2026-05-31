import { v4 as uuidv4 } from 'uuid'
import { kmeans, getClusterStatistics } from './kmeans.js'
import {
  logGaussianPDF,
  logSumExp,
  normalize,
  mean,
  stdDev,
  mean2D,
  covarianceMatrix,
  EPS,
  LOG_EPS,
  clip
} from './utils.js'
import type { HMMConfig, HMMModel, AnomalyResult } from '../../shared/types.js'

interface ForwardBackwardResult {
  logAlpha: number[][]
  logBeta: number[][]
  logGamma: number[][]
  logXi: number[][][]
  logLikelihood: number
  scalingFactors: number[]
}

interface IncrementalStats {
  n: number
  sumPi: number[]
  sumA: number[][]
  sumMu: number[][]
  sumSigma: number[][][]
}

const LOG_ZERO = -1e20
const EXP_CLIP_MIN = -700
const EXP_CLIP_MAX = 700

function safeLog(x: number): number {
  return x > EPS ? Math.log(x) : LOG_ZERO
}

function safeExp(x: number): number {
  if (x < EXP_CLIP_MIN) return 0
  if (x > EXP_CLIP_MAX) return Number.MAX_VALUE
  return Math.exp(x)
}

export class HMM {
  private nStates: number
  private nFeatures: number
  private pi: number[]
  private A: number[][]
  private mu: number[][]
  private sigma: number[][][]
  private logLikelihoodHistory: number[]
  private isIncremental: boolean
  private incrementalStats: IncrementalStats | null
  private dataLength: number

  constructor(nStates: number, nFeatures: number) {
    this.nStates = nStates
    this.nFeatures = nFeatures
    this.pi = new Array(nStates).fill(1 / nStates)
    this.A = this.createTransitionMatrix(nStates)
    this.mu = new Array(nStates)
    this.sigma = new Array(nStates)
    this.logLikelihoodHistory = []
    this.isIncremental = false
    this.incrementalStats = null
    this.dataLength = 0

    for (let i = 0; i < nStates; i++) {
      this.mu[i] = new Array(nFeatures).fill(0)
      this.sigma[i] = this.createIdentityMatrix(nFeatures)
    }
  }

  private createTransitionMatrix(n: number): number[][] {
    const A: number[][] = new Array(n)
    for (let i = 0; i < n; i++) {
      A[i] = new Array(n)
      const diagVal = 0.9
      const offDiagVal = (1 - diagVal) / (n - 1)
      for (let j = 0; j < n; j++) {
        A[i][j] = i === j ? diagVal : offDiagVal
      }
    }
    return A
  }

  private createIdentityMatrix(n: number): number[][] {
    const mat: number[][] = new Array(n)
    for (let i = 0; i < n; i++) {
      mat[i] = new Array(n).fill(0)
      mat[i][i] = 1
    }
    return mat
  }

  public initializeWithKMeans(data: number[][]): void {
    if (data.length < this.nStates) {
      throw new Error(`Data length ${data.length} must be >= nStates ${this.nStates}`)
    }

    const kmeansResult = kmeans(data, this.nStates, 100, 1e-4, 5)
    const stats = getClusterStatistics(data, kmeansResult.labels, this.nStates)

    const total = stats.sizes.reduce((a, b) => a + b, 0)
    this.pi = stats.sizes.map(s => Math.max(s / total, EPS))
    this.pi = normalize(this.pi)

    const labels = kmeansResult.labels
    const transitionCounts: number[][] = new Array(this.nStates)
    for (let i = 0; i < this.nStates; i++) {
      transitionCounts[i] = new Array(this.nStates).fill(EPS)
    }

    for (let t = 0; t < labels.length - 1; t++) {
      transitionCounts[labels[t]][labels[t + 1]] += 1
    }

    for (let i = 0; i < this.nStates; i++) {
      const rowSum = transitionCounts[i].reduce((a, b) => a + b, 0)
      this.A[i] = transitionCounts[i].map(c => c / rowSum)
    }

    this.mu = stats.means
    this.sigma = stats.covariances

    for (let i = 0; i < this.nStates; i++) {
      this.ensurePositiveDefinite(i)
    }
  }

  private ensurePositiveDefinite(stateIdx: number): void {
    const d = this.nFeatures
    for (let i = 0; i < d; i++) {
      this.sigma[stateIdx][i][i] = Math.max(this.sigma[stateIdx][i][i], EPS)
    }
  }

  private computeLogB(data: number[][]): number[][] {
    const T = data.length
    const logB: number[][] = new Array(T)
    for (let t = 0; t < T; t++) {
      logB[t] = new Array(this.nStates)
      for (let i = 0; i < this.nStates; i++) {
        logB[t][i] = logGaussianPDF(data[t], this.mu[i], this.sigma[i])
        if (!isFinite(logB[t][i])) {
          logB[t][i] = LOG_ZERO
        }
      }
    }
    return logB
  }



  private logForward(logB: number[][]): { logAlpha: number[][]; logLikelihood: number; scalingFactors: number[] } {
    const T = logB.length
    const N = this.nStates
    const logAlpha: number[][] = new Array(T)
    const logPi = this.pi.map(p => safeLog(p))
    const logA = this.A.map(row => row.map(a => safeLog(a)))

    const scalingFactors: number[] = new Array(T)

    logAlpha[0] = new Array(N)
    let maxVal = -Infinity
    for (let i = 0; i < N; i++) {
      logAlpha[0][i] = logPi[i] + logB[0][i]
      if (logAlpha[0][i] > maxVal) maxVal = logAlpha[0][i]
    }
    if (maxVal === -Infinity) maxVal = 0
    let c0 = 0
    for (let i = 0; i < N; i++) {
      c0 += safeExp(logAlpha[0][i] - maxVal)
    }
    const logC0 = maxVal + Math.log(Math.max(c0, EPS))
    scalingFactors[0] = logC0
    for (let i = 0; i < N; i++) {
      logAlpha[0][i] -= logC0
    }

    for (let t = 1; t < T; t++) {
      logAlpha[t] = new Array(N)
      for (let j = 0; j < N; j++) {
        const logProbs: number[] = new Array(N)
        for (let i = 0; i < N; i++) {
          logProbs[i] = logAlpha[t - 1][i] + logA[i][j]
        }
        logAlpha[t][j] = logSumExp(logProbs) + logB[t][j]
      }

      let maxA = -Infinity
      for (let i = 0; i < N; i++) {
        if (logAlpha[t][i] > maxA) maxA = logAlpha[t][i]
      }
      if (maxA === -Infinity) maxA = 0
      let ct = 0
      for (let i = 0; i < N; i++) {
        ct += safeExp(logAlpha[t][i] - maxA)
      }
      const logCt = maxA + Math.log(Math.max(ct, EPS))
      scalingFactors[t] = logCt
      for (let i = 0; i < N; i++) {
        logAlpha[t][i] -= logCt
      }
    }

    let logLikelihood = 0
    for (let t = 0; t < T; t++) {
      logLikelihood += scalingFactors[t]
    }

    return { logAlpha, logLikelihood, scalingFactors }
  }

  private logBackward(logB: number[][], scalingFactors: number[]): number[][] {
    const T = logB.length
    const N = this.nStates
    const logBeta: number[][] = new Array(T)
    const logA = this.A.map(row => row.map(a => safeLog(a)))

    logBeta[T - 1] = new Array(N).fill(-scalingFactors[T - 1])

    for (let t = T - 2; t >= 0; t--) {
      logBeta[t] = new Array(N)
      for (let i = 0; i < N; i++) {
        const logProbs: number[] = new Array(N)
        for (let j = 0; j < N; j++) {
          logProbs[j] = logA[i][j] + logB[t + 1][j] + logBeta[t + 1][j]
        }
        logBeta[t][i] = logSumExp(logProbs) - scalingFactors[t]
      }
    }

    return logBeta
  }

  private computeGammaXi(
    logAlpha: number[][],
    logBeta: number[][],
    logB: number[][],
    logLikelihood: number
  ): { logGamma: number[][]; logXi: number[][][] } {
    const T = logAlpha.length
    const N = this.nStates
    const logA = this.A.map(row => row.map(a => safeLog(a)))
    const logGamma: number[][] = new Array(T)
    const logXi: number[][][] = new Array(T - 1)

    for (let t = 0; t < T; t++) {
      logGamma[t] = new Array(N)
      for (let i = 0; i < N; i++) {
        logGamma[t][i] = clip(logAlpha[t][i] + logBeta[t][i], EXP_CLIP_MIN, EXP_CLIP_MAX)
      }
      const logNorm = logSumExp(logGamma[t])
      for (let i = 0; i < N; i++) {
        logGamma[t][i] -= logNorm
      }
    }

    for (let t = 0; t < T - 1; t++) {
      logXi[t] = new Array(N)
      const logXiFlat: number[] = []
      for (let i = 0; i < N; i++) {
        logXi[t][i] = new Array(N)
        for (let j = 0; j < N; j++) {
          logXi[t][i][j] = clip(
            logAlpha[t][i] + logA[i][j] + logB[t + 1][j] + logBeta[t + 1][j],
            EXP_CLIP_MIN,
            EXP_CLIP_MAX
          )
          logXiFlat.push(logXi[t][i][j])
        }
      }
      const logNorm = logSumExp(logXiFlat)
      for (let i = 0; i < N; i++) {
        for (let j = 0; j < N; j++) {
          logXi[t][i][j] -= logNorm
        }
      }
    }

    return { logGamma, logXi }
  }

  private estimateParameters(
    data: number[][],
    logGamma: number[][],
    logXi: number[][][]
  ): { pi: number[]; A: number[][]; mu: number[][]; sigma: number[][][] } {
    const T = data.length
    const d = this.nFeatures

    const gamma: number[][] = logGamma.map(row => row.map(lg => safeExp(lg)))
    const xi: number[][][] = logXi.map(mat => mat.map(row => row.map(lx => safeExp(lx))))

    for (let t = 0; t < T; t++) {
      let gSum = 0
      for (let i = 0; i < this.nStates; i++) gSum += gamma[t][i]
      if (gSum > EPS) {
        for (let i = 0; i < this.nStates; i++) gamma[t][i] /= gSum
      }
    }

    const pi: number[] = new Array(this.nStates)
    for (let i = 0; i < this.nStates; i++) {
      pi[i] = Math.max(gamma[0][i], EPS)
    }
    const piNorm = pi.reduce((a, b) => a + b, 0)
    for (let i = 0; i < this.nStates; i++) pi[i] /= piNorm

    const A: number[][] = new Array(this.nStates)
    for (let i = 0; i < this.nStates; i++) {
      A[i] = new Array(this.nStates)
      let denom = 0
      for (let t = 0; t < T - 1; t++) {
        denom += gamma[t][i]
      }
      for (let j = 0; j < this.nStates; j++) {
        let num = 0
        for (let t = 0; t < T - 1; t++) {
          num += xi[t][i][j]
        }
        A[i][j] = denom > EPS ? Math.max(num / denom, EPS) : EPS
      }
      const rowSum = A[i].reduce((a, b) => a + b, 0)
      for (let j = 0; j < this.nStates; j++) A[i][j] /= rowSum
    }

    const mu: number[][] = new Array(this.nStates)
    const sigma: number[][][] = new Array(this.nStates)

    for (let i = 0; i < this.nStates; i++) {
      let denom = 0
      mu[i] = new Array(d).fill(0)

      for (let t = 0; t < T; t++) {
        denom += gamma[t][i]
        for (let f = 0; f < d; f++) {
          mu[i][f] += gamma[t][i] * data[t][f]
        }
      }

      if (denom > EPS) {
        for (let f = 0; f < d; f++) {
          mu[i][f] /= denom
        }
      }

      sigma[i] = new Array(d)
      for (let x = 0; x < d; x++) {
        sigma[i][x] = new Array(d).fill(0)
      }

      for (let t = 0; t < T; t++) {
        const diff: number[] = new Array(d)
        for (let f = 0; f < d; f++) {
          diff[f] = data[t][f] - mu[i][f]
        }
        for (let x = 0; x < d; x++) {
          for (let y = 0; y < d; y++) {
            sigma[i][x][y] += gamma[t][i] * diff[x] * diff[y]
          }
        }
      }

      if (denom > EPS) {
        for (let x = 0; x < d; x++) {
          for (let y = 0; y < d; y++) {
            sigma[i][x][y] /= denom
          }
        }
      }

      const regularization = 1e-4
      for (let x = 0; x < d; x++) {
        sigma[i][x][x] = Math.max(sigma[i][x][x], EPS) + regularization
        for (let y = 0; y < d; y++) {
          if (x !== y) {
            sigma[i][x][y] *= 0.95
          }
        }
      }
    }

    return { pi, A, mu, sigma }
  }

  public fit(
    data: number[][],
    config: HMMConfig,
    onProgress?: (iteration: number, logLikelihood: number) => void
  ): number {
    const { maxIterations, convergenceTolerance } = config

    if (data.length > 100000) {
      throw new Error('Data length exceeds maximum of 100,000 time points')
    }

    this.dataLength = data.length
    this.isIncremental = false
    this.logLikelihoodHistory = []

    this.initializeWithKMeans(data)

    let prevLogLikelihood = -Infinity
    let finalLogLikelihood = -Infinity

    for (let iter = 0; iter < maxIterations; iter++) {
      const logB = this.computeLogB(data)
      const { logAlpha, logLikelihood, scalingFactors } = this.logForward(logB)
      const logBeta = this.logBackward(logB, scalingFactors)
      const { logGamma, logXi } = this.computeGammaXi(logAlpha, logBeta, logB, logLikelihood)

      const newParams = this.estimateParameters(data, logGamma, logXi)
      this.pi = newParams.pi
      this.A = newParams.A
      this.mu = newParams.mu
      this.sigma = newParams.sigma

      for (let i = 0; i < this.nStates; i++) {
        this.ensurePositiveDefinite(i)
      }

      this.logLikelihoodHistory.push(logLikelihood)
      finalLogLikelihood = logLikelihood

      if (onProgress) {
        onProgress(iter + 1, logLikelihood)
      }

      if (iter > 0 && Math.abs(logLikelihood - prevLogLikelihood) < convergenceTolerance) {
        break
      }

      prevLogLikelihood = logLikelihood
    }

    return finalLogLikelihood
  }

  public fitIncremental(
    data: number[][],
    config: HMMConfig,
    onProgress?: (iteration: number, logLikelihood: number) => void
  ): number {
    const { maxIterations, convergenceTolerance, learningRate } = config

    if (data.length > 100000) {
      throw new Error('Data length exceeds maximum of 100,000 time points')
    }

    this.dataLength += data.length

    if (!this.isIncremental) {
      this.initializeWithKMeans(data)
      this.isIncremental = true
    }

    let prevLogLikelihood = -Infinity
    let finalLogLikelihood = -Infinity

    for (let iter = 0; iter < maxIterations; iter++) {
      const logB = this.computeLogB(data)
      const { logAlpha, logLikelihood, scalingFactors } = this.logForward(logB)
      const logBeta = this.logBackward(logB, scalingFactors)
      const { logGamma, logXi } = this.computeGammaXi(logAlpha, logBeta, logB, logLikelihood)

      const newParams = this.estimateParameters(data, logGamma, logXi)

      const alpha = learningRate
      for (let i = 0; i < this.nStates; i++) {
        this.pi[i] = alpha * newParams.pi[i] + (1 - alpha) * this.pi[i]
        for (let j = 0; j < this.nStates; j++) {
          this.A[i][j] = alpha * newParams.A[i][j] + (1 - alpha) * this.A[i][j]
        }
        for (let f = 0; f < this.nFeatures; f++) {
          this.mu[i][f] = alpha * newParams.mu[i][f] + (1 - alpha) * this.mu[i][f]
        }
        for (let x = 0; x < this.nFeatures; x++) {
          for (let y = 0; y < this.nFeatures; y++) {
            this.sigma[i][x][y] = alpha * newParams.sigma[i][x][y] + (1 - alpha) * this.sigma[i][x][y]
          }
        }
      }

      this.pi = normalize(this.pi)
      for (let i = 0; i < this.nStates; i++) {
        this.A[i] = normalize(this.A[i])
      }
      for (let i = 0; i < this.nStates; i++) {
        this.ensurePositiveDefinite(i)
      }

      this.logLikelihoodHistory.push(logLikelihood)
      finalLogLikelihood = logLikelihood

      if (onProgress) {
        onProgress(iter + 1, logLikelihood)
      }

      if (iter > 0 && Math.abs(logLikelihood - prevLogLikelihood) < convergenceTolerance) {
        break
      }

      prevLogLikelihood = logLikelihood
    }

    return finalLogLikelihood
  }

  public viterbi(data: number[][]): { states: number[]; logLikelihood: number } {
    const T = data.length
    const logB = this.computeLogB(data)

    const logDelta: number[][] = new Array(T)
    const psi: number[][] = new Array(T)

    logDelta[0] = new Array(this.nStates)
    psi[0] = new Array(this.nStates).fill(0)
    for (let i = 0; i < this.nStates; i++) {
      logDelta[0][i] = safeLog(this.pi[i]) + logB[0][i]
    }

    for (let t = 1; t < T; t++) {
      logDelta[t] = new Array(this.nStates)
      psi[t] = new Array(this.nStates)

      for (let j = 0; j < this.nStates; j++) {
        let maxVal = -Infinity
        let maxIdx = 0

        for (let i = 0; i < this.nStates; i++) {
          const val = logDelta[t - 1][i] + safeLog(this.A[i][j])
          if (val > maxVal) {
            maxVal = val
            maxIdx = i
          }
        }

        logDelta[t][j] = maxVal + logB[t][j]
        psi[t][j] = maxIdx
      }
    }

    const states: number[] = new Array(T)
    let logLikelihood = -Infinity
    states[T - 1] = 0

    for (let i = 0; i < this.nStates; i++) {
      if (logDelta[T - 1][i] > logLikelihood) {
        logLikelihood = logDelta[T - 1][i]
        states[T - 1] = i
      }
    }

    for (let t = T - 2; t >= 0; t--) {
      states[t] = psi[t + 1][states[t + 1]]
    }

    return { states, logLikelihood }
  }

  public computeLogLikelihoods(data: number[][]): number[] {
    const T = data.length
    const N = this.nStates
    const logB = this.computeLogB(data)
    const logPi = this.pi.map(p => safeLog(p))
    const logA = this.A.map(row => row.map(a => safeLog(a)))

    const logAlpha: number[][] = new Array(T)
    const scalingFactors: number[] = new Array(T)

    logAlpha[0] = new Array(N)
    for (let i = 0; i < N; i++) {
      logAlpha[0][i] = logPi[i] + logB[0][i]
    }
    let maxVal = -Infinity
    for (let i = 0; i < N; i++) {
      if (logAlpha[0][i] > maxVal) maxVal = logAlpha[0][i]
    }
    if (maxVal === -Infinity) maxVal = 0
    let c0 = 0
    for (let i = 0; i < N; i++) {
      c0 += safeExp(logAlpha[0][i] - maxVal)
    }
    scalingFactors[0] = maxVal + Math.log(Math.max(c0, EPS))
    for (let i = 0; i < N; i++) {
      logAlpha[0][i] -= scalingFactors[0]
    }

    for (let t = 1; t < T; t++) {
      logAlpha[t] = new Array(N)
      for (let j = 0; j < N; j++) {
        const logProbs: number[] = new Array(N)
        for (let i = 0; i < N; i++) {
          logProbs[i] = logAlpha[t - 1][i] + logA[i][j]
        }
        logAlpha[t][j] = logSumExp(logProbs) + logB[t][j]
      }

      let maxA = -Infinity
      for (let i = 0; i < N; i++) {
        if (logAlpha[t][i] > maxA) maxA = logAlpha[t][i]
      }
      if (maxA === -Infinity) maxA = 0
      let ct = 0
      for (let i = 0; i < N; i++) {
        ct += safeExp(logAlpha[t][i] - maxA)
      }
      scalingFactors[t] = maxA + Math.log(Math.max(ct, EPS))
      for (let i = 0; i < N; i++) {
        logAlpha[t][i] -= scalingFactors[t]
      }
    }

    const logLikelihoods: number[] = new Array(T)
    let cumLogScale = 0
    for (let t = 0; t < T; t++) {
      cumLogScale += scalingFactors[t]
      logLikelihoods[t] = cumLogScale
    }

    return logLikelihoods
  }

  public predictFutureLogLikelihoods(
    data: number[][],
    steps: number = 3
  ): { predictedScores: number[]; predictedAnomalies: boolean[] } {
    const T = data.length
    if (T < 2) return { predictedScores: new Array(steps).fill(0), predictedAnomalies: new Array(steps).fill(false) }

    const { states } = this.viterbi(data)
    const logLikelihoods = this.computeLogLikelihoods(data)
    const meanLL = mean(logLikelihoods)
    const stdLL = stdDev(logLikelihoods, meanLL)
    const threshold = meanLL - 2 * stdLL

    const lastState = states[T - 1]
    const lastObs = data[T - 1]

    const predictedScores: number[] = new Array(steps)
    const predictedAnomalies: boolean[] = new Array(steps)

    let currentState = lastState
    for (let s = 0; s < steps; s++) {
      let nextState = 0
      let maxProb = this.A[currentState][0]
      for (let j = 1; j < this.nStates; j++) {
        if (this.A[currentState][j] > maxProb) {
          maxProb = this.A[currentState][j]
          nextState = j
        }
      }

      const predictedLL = safeLog(this.pi[nextState] + EPS) +
        logGaussianPDF(lastObs, this.mu[nextState], this.sigma[nextState])

      predictedScores[s] = (threshold - predictedLL) / Math.max(stdLL, EPS)
      predictedAnomalies[s] = predictedLL < threshold

      currentState = nextState
    }

    return { predictedScores, predictedAnomalies }
  }

  public detectAnomalies(
    data: number[][],
    timestamps: string[],
    thresholdK: number,
    dataId: string,
    modelId: string
  ): AnomalyResult {
    if (data.length !== timestamps.length) {
      throw new Error('Data and timestamps length mismatch')
    }

    const { states } = this.viterbi(data)
    const logLikelihoods = this.computeLogLikelihoods(data)
    const { predictedScores, predictedAnomalies } = this.predictFutureLogLikelihoods(data, 3)

    const meanLL = mean(logLikelihoods)
    const stdLL = stdDev(logLikelihoods, meanLL)
    const threshold = meanLL - thresholdK * stdLL

    const anomalies: boolean[] = new Array(data.length)
    const anomalyScores: number[] = new Array(data.length)

    for (let t = 0; t < data.length; t++) {
      anomalies[t] = logLikelihoods[t] < threshold
      anomalyScores[t] = Math.max(0, (threshold - logLikelihoods[t]) / (stdLL + EPS))
    }

    for (let t = 0; t < data.length - 3; t++) {
      if (!anomalies[t] && predictedAnomalies.some(p => p)) {
        const futureLL = logLikelihoods.slice(t + 1, Math.min(t + 4, data.length))
        const avgFutureLL = futureLL.length > 0 ? futureLL.reduce((a, b) => a + b, 0) / futureLL.length : 0
        if (avgFutureLL < threshold) {
          anomalyScores[t] = Math.max(anomalyScores[t], 0.5)
        }
      }
    }

    return {
      id: uuidv4(),
      timestamps: [...timestamps],
      logLikelihoods: [...logLikelihoods],
      anomalyScores,
      anomalies,
      states,
      threshold,
      meanLogLikelihood: meanLL,
      stdLogLikelihood: stdLL,
      predictedScores,
      predictedAnomalies,
      dataId,
      modelId
    }
  }

  public emissionProbability(x: number[], state: number): number {
    return safeExp(logGaussianPDF(x, this.mu[state], this.sigma[state]))
  }

  public logEmissionProbability(x: number[], state: number): number {
    return logGaussianPDF(x, this.mu[state], this.sigma[state])
  }

  public toModel(): HMMModel {
    return {
      id: uuidv4(),
      pi: [...this.pi],
      A: this.A.map(row => [...row]),
      mu: this.mu.map(row => [...row]),
      sigma: this.sigma.map(mat => mat.map(row => [...row])),
      nFeatures: this.nFeatures,
      trainedAt: new Date().toISOString(),
      dataLength: this.dataLength,
      isIncremental: this.isIncremental,
      logLikelihoodHistory: [...this.logLikelihoodHistory]
    }
  }

  public static fromModel(model: HMMModel): HMM {
    const hmm = new HMM(model.pi.length, model.nFeatures)
    hmm.pi = [...model.pi]
    hmm.A = model.A.map(row => [...row])
    hmm.mu = model.mu.map(row => [...row])
    hmm.sigma = model.sigma.map(mat => mat.map(row => [...row]))
    hmm.dataLength = model.dataLength
    hmm.isIncremental = model.isIncremental
    hmm.logLikelihoodHistory = [...model.logLikelihoodHistory]
    return hmm
  }

  public getPi(): number[] { return [...this.pi] }
  public getA(): number[][] { return this.A.map(row => [...row]) }
  public getMu(): number[][] { return this.mu.map(row => [...row]) }
  public getSigma(): number[][][] { return this.sigma.map(mat => mat.map(row => [...row])) }
  public getLogLikelihoodHistory(): number[] { return [...this.logLikelihoodHistory] }
}

export function trainHMM(
  observations: number[][],
  config: HMMConfig,
  existingModel?: HMMModel,
  onProgress?: (iteration: number, logLikelihood: number) => void
): HMMModel {
  const { nStates } = config
  const nFeatures = observations[0].length

  let hmm: HMM
  if (existingModel) {
    hmm = HMM.fromModel(existingModel)
    hmm.fitIncremental(observations, config, onProgress)
  } else {
    hmm = new HMM(nStates, nFeatures)
    hmm.fit(observations, config, onProgress)
  }

  return hmm.toModel()
}

export function detectAnomalies(
  model: HMMModel,
  observations: number[][],
  thresholdK: number = 2
): {
  logLikelihoods: number[]
  anomalyScores: number[]
  anomalies: boolean[]
  states: number[]
  threshold: number
  meanLogLikelihood: number
  stdLogLikelihood: number
  predictedScores: number[]
  predictedAnomalies: boolean[]
} {
  const hmm = HMM.fromModel(model)
  const { states } = hmm.viterbi(observations)
  const logLikelihoods = hmm.computeLogLikelihoods(observations)
  const { predictedScores, predictedAnomalies } = hmm.predictFutureLogLikelihoods(observations, 3)

  const meanLogLikelihood = mean(logLikelihoods)
  const stdLogLikelihood = stdDev(logLikelihoods, meanLogLikelihood)
  const threshold = meanLogLikelihood - thresholdK * stdLogLikelihood

  const anomalyScores = logLikelihoods.map(
    (ll) => Math.max(0, (threshold - ll) / Math.max(stdLogLikelihood, 1e-10))
  )
  const anomalies = logLikelihoods.map((ll) => ll < threshold)

  for (let t = 0; t < anomalies.length - 3; t++) {
    if (!anomalies[t] && predictedAnomalies.some(p => p)) {
      const futureLL = logLikelihoods.slice(t + 1, Math.min(t + 4, logLikelihoods.length))
      const avgFutureLL = futureLL.reduce((a, b) => a + b, 0) / futureLL.length
      if (avgFutureLL < threshold) {
        anomalyScores[t] = Math.max(anomalyScores[t], 0.5)
      }
    }
  }

  return {
    logLikelihoods,
    anomalyScores,
    anomalies,
    states,
    threshold,
    meanLogLikelihood,
    stdLogLikelihood,
    predictedScores,
    predictedAnomalies,
  }
}
