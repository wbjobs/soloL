import { v4 as uuidv4 } from 'uuid'
import { HMM, trainHMM, detectAnomalies } from './hmm.js'
import {
  mean,
  stdDev,
  mean2D,
  covarianceMatrix,
  determinant,
  invert,
  matVecMul,
  EPS,
  LOG_EPS,
  clip
} from './utils.js'
import type {
  MultiAssetConfig,
  MultiAssetModel,
  MultiAssetAnomalyResult,
  CopulaParameters,
  HMMConfig,
  HMMModel,
  TimeSeriesData
} from '../../shared/types.js'

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

function erfc(x: number): number {
  const z = Math.abs(x)
  const t = 1 / (1 + z / 2)
  const r = t * Math.exp(-z * z - 1.26551223 +
    t * (1.00002368 +
      t * (0.37409196 +
        t * (0.09678418 +
          t * (-0.18628806 +
            t * (0.27886807 +
              t * (-1.13520398 +
                t * (1.48851587 +
                  t * (-0.82215223 +
                    t * 0.17087277)))))))))
  return x >= 0 ? r : 2 - r
}

function normalCDF(x: number): number {
  return 0.5 * erfc(-x / Math.sqrt(2))
}

function inverseNormalCDF(p: number): number {
  const a = [2.50662823884, -18.61500062529, 41.39119773534, -25.44106049637]
  const b = [-8.47351093090, 23.08336743743, -21.06224101826, 3.13082909833]
  const c = [0.3374754822726147, 0.9761690190917186, 0.1607979714918209,
    0.0276438810333863, 0.0038405729373609, 0.0003951896511919,
    0.0000321767881768, 0.0000002888167364, 0.0000003960315187]

  const pp = p < 0.5 ? p : 1 - p
  if (pp < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(pp))
    let x = c[8]
    for (let i = 7; i >= 0; i--) {
      x = x * q + c[i]
    }
    return p < 0.5 ? -x : x
  } else {
    const q = pp - 0.5
    const r = q * q
    const x = q * (((a[3] * r + a[2]) * r + a[1]) * r + a[0]) /
      ((((b[3] * r + b[2]) * r + b[1]) * r + b[0]) * r + 1)
    return p < 0.5 ? -x : x
  }
}

function tCDF(x: number, df: number): number {
  if (df <= 0) return normalCDF(x)
  const beta = (x + Math.sqrt(x * x + df)) / (2 * Math.sqrt(x * x + df))
  const a = df / 2
  const b = df / 2
  return regularizedIncompleteBeta(beta, a, b)
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1

  const bt = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) +
    a * Math.log(x) + b * Math.log(1 - x))

  if (x < (a + 1) / (a + b + 2)) {
    return bt * betaCF(x, a, b) / a
  } else {
    return 1 - bt * betaCF(1 - x, b, a) / b
  }
}

function betaCF(x: number, a: number, b: number): number {
  const maxIter = 200
  const eps = 3e-7
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - qab * x / qap
  if (Math.abs(d) < eps) d = eps
  d = 1 / d
  let h = d

  for (let m = 1; m <= maxIter; m++) {
    const m2 = 2 * m
    let aa = m * (b - m) * x / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < eps) d = eps
    c = 1 + aa / c
    if (Math.abs(c) < eps) c = eps
    d = 1 / d
    h *= d * c

    aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < eps) d = eps
    c = 1 + aa / c
    if (Math.abs(c) < eps) c = eps
    d = 1 / d
    const del = d * c
    h *= del

    if (Math.abs(del - 1) < eps) break
  }

  return h
}

function logGamma(x: number): number {
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) ser += cof[j] / ++y
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}

function gammaFunction(x: number): number {
  return safeExp(logGamma(x))
}

export function gaussianCopulaCDF(u: number[], rho: number): number {
  const d = u.length
  if (d === 1) return u[0]

  const z = u.map(ui => inverseNormalCDF(clip(ui, 1e-10, 1 - 1e-10)))

  if (d === 2) {
    return bivariateNormalCDF(z[0], z[1], rho)
  }

  return multivariateNormalCDF(z, createCorrelationMatrix(d, rho))
}

function bivariateNormalCDF(x: number, y: number, rho: number): number {
  const a = x
  const b = y
  const r = rho

  const p = normalCDF(a) * normalCDF(b)

  if (Math.abs(r) < 1e-10) return p

  let sum = 0
  const n = 40
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    const w = Math.asin(r) * t
    sum += Math.exp((a * a + b * b - 2 * a * b * Math.sin(w)) / (-2 * (1 - Math.sin(w) * Math.sin(w))))
  }

  return p + sum / n * Math.sqrt(1 - r * r) / (2 * Math.PI)
}

function multivariateNormalCDF(z: number[], cov: number[][]): number {
  const d = z.length
  let result = 1
  for (let i = 0; i < d; i++) {
    result *= normalCDF(z[i])
  }
  return result
}

function createCorrelationMatrix(d: number, rho: number): number[][] {
  const mat: number[][] = new Array(d)
  for (let i = 0; i < d; i++) {
    mat[i] = new Array(d)
    for (let j = 0; j < d; j++) {
      mat[i][j] = i === j ? 1 : rho
    }
  }
  return mat
}

export function gaussianCopulaPDF(u: number[], rho: number): number {
  const d = u.length
  const z = u.map(ui => inverseNormalCDF(clip(ui, 1e-10, 1 - 1e-10)))

  const R = createCorrelationMatrix(d, rho)
  const detR = determinant(R)
  const invR = invert(R)

  const zTerm = matVecMul(invR, z)
  let zQuadratic = 0
  for (let i = 0; i < d; i++) {
    zQuadratic += z[i] * zTerm[i]
  }
  const zNorm2 = z.reduce((s, zi) => s + zi * zi, 0)

  const exponent = -0.5 * (zQuadratic - zNorm2)
  const norm = 1 / Math.sqrt(Math.max(detR, EPS))

  return Math.exp(exponent) * norm
}

export function gaussianCopulaLogLikelihood(u: number[][], rho: number): number {
  const T = u.length
  let logL = 0
  for (let t = 0; t < T; t++) {
    const pdf = gaussianCopulaPDF(u[t], rho)
    logL += safeLog(pdf)
  }
  return logL
}

export function tCopulaCDF(u: number[], rho: number, df: number): number {
  const d = u.length
  const t = u.map(ui => inverseTCDF(clip(ui, 1e-10, 1 - 1e-10), df))
  return multivariateTCDF(t, createCorrelationMatrix(d, rho), df)
}

function inverseTCDF(p: number, df: number): number {
  if (df <= 0) return inverseNormalCDF(p)

  let low = -10
  let high = 10

  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    const cdf = tCDF(mid, df)
    if (cdf < p) {
      low = mid
    } else {
      high = mid
    }
  }

  return (low + high) / 2
}

function multivariateTCDF(t: number[], cov: number[][], df: number): number {
  const d = t.length
  let result = 1
  for (let i = 0; i < d; i++) {
    result *= tCDF(t[i], df)
  }
  return result
}

export function tCopulaPDF(u: number[], rho: number, df: number): number {
  const d = u.length
  const t = u.map(ui => inverseTCDF(clip(ui, 1e-10, 1 - 1e-10), df))

  const R = createCorrelationMatrix(d, rho)
  const detR = determinant(R)
  const invR = invert(R)

  const tTerm = matVecMul(invR, t)
  let tQuadratic = 0
  for (let i = 0; i < d; i++) {
    tQuadratic += t[i] * tTerm[i]
  }

  const gammaNumerator = gammaFunction((df + d) / 2)
  const gammaDenominator = gammaFunction(df / 2)
  const gammaRatio = gammaNumerator / gammaDenominator

  const term1 = gammaRatio / (Math.pow(df * Math.PI, d / 2) * Math.sqrt(Math.max(detR, EPS)))
  const term2 = Math.pow(1 + tQuadratic / df, -(df + d) / 2)
  const term3 = Math.pow(1 + tQuadratic / df, -(df + 1) / 2)

  let marginalProduct = 1
  for (let i = 0; i < d; i++) {
    marginalProduct *= tPDF(t[i], df)
  }

  return (term1 * term2) / marginalProduct
}

function tPDF(x: number, df: number): number {
  const gammaNumerator = gammaFunction((df + 1) / 2)
  const gammaDenominator = gammaFunction(df / 2)
  const gammaRatio = gammaNumerator / gammaDenominator
  const norm = gammaRatio / Math.sqrt(df * Math.PI)
  return norm * Math.pow(1 + x * x / df, -(df + 1) / 2)
}

export function tCopulaLogLikelihood(u: number[][], rho: number, df: number): number {
  const T = u.length
  let logL = 0
  for (let t = 0; t < T; t++) {
    const pdf = tCopulaPDF(u[t], rho, df)
    logL += safeLog(pdf)
  }
  return logL
}

export function claytonCopulaCDF(u: number[], theta: number): number {
  const d = u.length
  if (Math.abs(theta) < 1e-10) {
    let product = 1
    for (let i = 0; i < d; i++) {
      product *= clip(u[i], 1e-10, 1)
    }
    return product
  }

  let sum = 0
  for (let i = 0; i < d; i++) {
    sum += Math.pow(clip(u[i], 1e-10, 1), -theta)
  }

  return Math.pow(Math.max(sum - d + 1, 1e-10), -1 / theta)
}

export function claytonCopulaPDF(u: number[], theta: number): number {
  const d = u.length
  if (Math.abs(theta) < 1e-10) {
    return 1
  }

  let sum = 0
  let product = 1
  for (let i = 0; i < d; i++) {
    const ui = clip(u[i], 1e-10, 1)
    sum += Math.pow(ui, -theta)
    product *= Math.pow(ui, -theta - 1)
  }

  const term1 = gammaFunction(d + 1 / theta) / gammaFunction(1 / theta)
  const term2 = product
  const term3 = Math.pow(Math.max(sum - d + 1, 1e-10), -d - 1 / theta)

  return Math.max(term1 * term2 * term3, EPS)
}

export function claytonCopulaLogLikelihood(u: number[][], theta: number): number {
  const T = u.length
  let logL = 0
  for (let t = 0; t < T; t++) {
    const pdf = claytonCopulaPDF(u[t], theta)
    logL += safeLog(pdf)
  }
  return logL
}

export function gumbelCopulaCDF(u: number[], theta: number): number {
  const d = u.length
  if (Math.abs(theta - 1) < 1e-10) {
    let product = 1
    for (let i = 0; i < d; i++) {
      product *= clip(u[i], 1e-10, 1)
    }
    return product
  }

  let sum = 0
  for (let i = 0; i < d; i++) {
    sum += Math.pow(-safeLog(clip(u[i], 1e-10, 1)), theta)
  }

  return Math.exp(-Math.pow(sum, 1 / theta))
}

export function gumbelCopulaPDF(u: number[], theta: number): number {
  const d = u.length
  if (Math.abs(theta - 1) < 1e-10) {
    return 1
  }

  const logU = u.map(ui => -safeLog(clip(ui, 1e-10, 1)))
  const poweredLogU = logU.map(liu => Math.pow(liu, theta))
  const sumPowered = poweredLogU.reduce((a, b) => a + b, 0)

  let product1 = 1
  let product2 = 1
  for (let i = 0; i < d; i++) {
    product1 *= Math.pow(logU[i], theta - 1) / clip(u[i], 1e-10, 1)
    product2 *= 1 + (theta - 1) * Math.pow(sumPowered, -1 / theta) * Math.pow(logU[i], theta - 1)
  }

  const cdf = gumbelCopulaCDF(u, theta)
  const term = Math.pow(sumPowered, d / theta - d) * Math.pow(sumPowered, -d)

  return Math.max(cdf * product1 * product2 * term, EPS)
}

export function gumbelCopulaLogLikelihood(u: number[][], theta: number): number {
  const T = u.length
  let logL = 0
  for (let t = 0; t < T; t++) {
    const pdf = gumbelCopulaPDF(u[t], theta)
    logL += safeLog(pdf)
  }
  return logL
}

export function frankCopulaCDF(u: number[], theta: number): number {
  const d = u.length
  if (Math.abs(theta) < 1e-10) {
    let product = 1
    for (let i = 0; i < d; i++) {
      product *= clip(u[i], 1e-10, 1)
    }
    return product
  }

  let product = 1
  for (let i = 0; i < d; i++) {
    product *= (1 - Math.exp(-theta * clip(u[i], 1e-10, 1)))
  }

  const numerator = product
  const denominator = Math.pow(1 - Math.exp(-theta), d - 1)

  return -1 / theta * safeLog(1 + numerator / denominator)
}

export function frankCopulaPDF(u: number[], theta: number): number {
  const d = u.length
  if (Math.abs(theta) < 1e-10) {
    return 1
  }

  const expThetaU = u.map(ui => Math.exp(-theta * clip(ui, 1e-10, 1)))
  const expTheta = Math.exp(-theta)

  let product1 = 1
  let product2 = 1
  for (let i = 0; i < d; i++) {
    product1 *= theta * expThetaU[i]
    product2 *= (1 - expThetaU[i])
  }

  const sumTerm = (1 - expTheta) * (1 - expTheta) + product2 / (1 - expTheta)
  const term = Math.pow((1 - expTheta) + product2 / (1 - expTheta), -d - 1)

  return Math.max(product1 * term, EPS)
}

export function frankCopulaLogLikelihood(u: number[][], theta: number): number {
  const T = u.length
  let logL = 0
  for (let t = 0; t < T; t++) {
    const pdf = frankCopulaPDF(u[t], theta)
    logL += safeLog(pdf)
  }
  return logL
}

export function empiricalCDF(values: number[]): number[] {
  const n = values.length
  const sorted = [...values].sort((a, b) => a - b)
  const ranks = values.map(v => {
    let rank = 0
    for (let i = 0; i < n; i++) {
      if (sorted[i] <= v) rank = i + 1
    }
    return rank
  })
  return ranks.map(r => r / (n + 1))
}

export function kdePDF(values: number[], x: number, bandwidth?: number): number {
  const n = values.length
  if (n === 0) return 0

  const h = bandwidth || silvermanBandwidth(values)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += gaussianKernel((x - values[i]) / h)
  }
  return sum / (n * h)
}

function gaussianKernel(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI)
}

function silvermanBandwidth(values: number[]): number {
  const n = values.length
  const sigma = stdDev(values)
  const iqr = iqrValue(values)
  const sigmaHat = Math.min(sigma, iqr / 1.34)
  return 1.06 * sigmaHat * Math.pow(n, -1 / 5)
}

function iqrValue(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const n = sorted.length
  const q1 = sorted[Math.floor(n * 0.25)]
  const q3 = sorted[Math.floor(n * 0.75)]
  return q3 - q1
}

export function pitTransform(values: number[]): number[] {
  return empiricalCDF(values)
}

export function spearmanRankCorrelation(x: number[], y: number[]): number {
  const n = x.length
  const rankX = getRanks(x)
  const rankY = getRanks(y)

  let sumD2 = 0
  for (let i = 0; i < n; i++) {
    const d = rankX[i] - rankY[i]
    sumD2 += d * d
  }

  return 1 - 6 * sumD2 / (n * (n * n - 1))
}

function getRanks(values: number[]): number[] {
  const n = values.length
  const indexed = values.map((v, i) => ({ value: v, index: i }))
  indexed.sort((a, b) => a.value - b.value)

  const ranks: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    ranks[indexed[i].index] = i + 1
  }
  return ranks
}

export function kendallTau(x: number[], y: number[]): number {
  const n = x.length
  let concordant = 0
  let discordant = 0

  for (let i = 0; i < n - 1; i++) {
    for (let j = i + 1; j < n; j++) {
      const dx = x[i] - x[j]
      const dy = y[i] - y[j]
      if (dx * dy > 0) {
        concordant++
      } else if (dx * dy < 0) {
        discordant++
      }
    }
  }

  return (concordant - discordant) / (concordant + discordant)
}

export function spearmanToRho(spearman: number): number {
  return 2 * Math.sin(Math.PI * spearman / 6)
}

export function kendallToClaytonTheta(tau: number): number {
  return 2 * tau / (1 - tau)
}

export function kendallToGumbelTheta(tau: number): number {
  return 1 / (1 - tau)
}

export function kendallToFrankTheta(tau: number): number {
  if (Math.abs(tau) < 1e-10) return 0

  let low = -30
  let high = 30

  for (let i = 0; i < 50; i++) {
    const mid = (low + high) / 2
    const debye = debye1(mid)
    const tauEst = 1 - 4 * (1 - debye) / mid
    if (tauEst < tau) {
      high = mid
    } else {
      low = mid
    }
  }

  return (low + high) / 2
}

function debye1(x: number): number {
  if (Math.abs(x) < 1e-10) return 1

  let sum = 0
  const n = 100
  for (let k = 1; k <= n; k++) {
    sum += x / (k * k * Math.PI * Math.PI + x * x)
  }
  return 1 - 2 * sum
}

export function estimateCopulaParameters(
  uniformData: number[][],
  type: 'gaussian' | 't' | 'clayton' | 'gumbel' | 'frank'
): CopulaParameters {
  const T = uniformData.length
  const d = uniformData[0].length

  if (d === 1) {
    return { type }
  }

  const col0 = uniformData.map(row => row[0])
  const col1 = uniformData.map(row => row[1])
  const spearman = spearmanRankCorrelation(col0, col1)
  const tau = kendallTau(col0, col1)

  let rho = 0
  let theta = 0
  let df = 5

  switch (type) {
    case 'gaussian':
      rho = spearmanToRho(spearman)
      rho = maximumLikelihoodRho(uniformData, rho)
      return { type, rho, correlationMatrix: createCorrelationMatrix(d, rho) }

    case 't':
      rho = spearmanToRho(spearman)
      const result = maximumLikelihoodRhoDf(uniformData, rho, df)
      return { type, rho: result.rho, df: result.df, correlationMatrix: createCorrelationMatrix(d, result.rho) }

    case 'clayton':
      theta = kendallToClaytonTheta(tau)
      theta = maximumLikelihoodTheta(uniformData, theta, 'clayton')
      return { type, theta: Math.max(theta, 0.01) }

    case 'gumbel':
      theta = kendallToGumbelTheta(tau)
      theta = maximumLikelihoodTheta(uniformData, Math.max(theta, 1.01), 'gumbel')
      return { type, theta: Math.max(theta, 1.01) }

    case 'frank':
      theta = kendallToFrankTheta(tau)
      theta = maximumLikelihoodTheta(uniformData, theta, 'frank')
      return { type, theta }

    default:
      return { type }
  }
}

function maximumLikelihoodRho(u: number[][], initialRho: number): number {
  let bestRho = clip(initialRho, -0.99, 0.99)
  let bestLL = gaussianCopulaLogLikelihood(u, bestRho)

  const step = 0.01
  for (let r = -0.99; r <= 0.99; r += step) {
    const ll = gaussianCopulaLogLikelihood(u, r)
    if (ll > bestLL) {
      bestLL = ll
      bestRho = r
    }
  }

  return clip(bestRho, -0.99, 0.99)
}

function maximumLikelihoodRhoDf(u: number[][], initialRho: number, initialDf: number): { rho: number; df: number } {
  let bestRho = clip(initialRho, -0.99, 0.99)
  let bestDf = initialDf
  let bestLL = tCopulaLogLikelihood(u, bestRho, bestDf)

  for (let r = -0.9; r <= 0.9; r += 0.1) {
    for (let df = 2; df <= 20; df += 1) {
      const ll = tCopulaLogLikelihood(u, r, df)
      if (ll > bestLL) {
        bestLL = ll
        bestRho = r
        bestDf = df
      }
    }
  }

  return { rho: clip(bestRho, -0.99, 0.99), df: bestDf }
}

function maximumLikelihoodTheta(
  u: number[][],
  initialTheta: number,
  type: 'clayton' | 'gumbel' | 'frank'
): number {
  let bestTheta = initialTheta
  let bestLL = computeCopulaLogLikelihoodSingle(u, { type, theta: bestTheta })

  let start = type === 'gumbel' ? 1.01 : (type === 'clayton' ? 0.01 : -30)
  let end = type === 'frank' ? 30 : 30
  let step = 0.5

  for (let theta = start; theta <= end; theta += step) {
    const ll = computeCopulaLogLikelihoodSingle(u, { type, theta })
    if (ll > bestLL) {
      bestLL = ll
      bestTheta = theta
    }
  }

  return bestTheta
}

export function computeCopulaLogLikelihood(
  u: number[][],
  params: CopulaParameters
): number {
  return computeCopulaLogLikelihoodSingle(u, params)
}

function computeCopulaLogLikelihoodSingle(u: number[][], params: CopulaParameters): number {
  switch (params.type) {
    case 'gaussian':
      return gaussianCopulaLogLikelihood(u, params.rho || 0)
    case 't':
      return tCopulaLogLikelihood(u, params.rho || 0, params.df || 5)
    case 'clayton':
      return claytonCopulaLogLikelihood(u, params.theta || 1)
    case 'gumbel':
      return gumbelCopulaLogLikelihood(u, params.theta || 1)
    case 'frank':
      return frankCopulaLogLikelihood(u, params.theta || 1)
    default:
      return 0
  }
}

export function computeMarginalLogLikelihoods(
  model: HMMModel,
  observations: number[][]
): number[] {
  const hmm = HMM.fromModel(model)
  return hmm.computeLogLikelihoods(observations)
}

export function buildJointStateSpace(
  marginalModels: Record<string, HMMModel>
): { nJointStates: number; stateMap: number[][] } {
  const assetNames = Object.keys(marginalModels)
  const nAssets = assetNames.length

  const stateCounts = assetNames.map(name => marginalModels[name].pi.length)
  let nJointStates = 1
  for (const count of stateCounts) {
    nJointStates *= count
  }

  const stateMap: number[][] = new Array(nJointStates)
  for (let i = 0; i < nJointStates; i++) {
    stateMap[i] = new Array(nAssets)
    let idx = i
    for (let a = nAssets - 1; a >= 0; a--) {
      stateMap[i][a] = idx % stateCounts[a]
      idx = Math.floor(idx / stateCounts[a])
    }
  }

  return { nJointStates, stateMap }
}

export function buildJointTransitionMatrix(
  marginalModels: Record<string, HMMModel>,
  stateMap: number[][]
): number[][] {
  const assetNames = Object.keys(marginalModels)
  const nJointStates = stateMap.length
  const nAssets = assetNames.length

  const jointA: number[][] = new Array(nJointStates)
  for (let i = 0; i < nJointStates; i++) {
    jointA[i] = new Array(nJointStates).fill(1)
    for (let j = 0; j < nJointStates; j++) {
      let product = 1
      for (let a = 0; a < nAssets; a++) {
        const s1 = stateMap[i][a]
        const s2 = stateMap[j][a]
        product *= marginalModels[assetNames[a]].A[s1][s2]
      }
      jointA[i][j] = product
    }
    const sum = jointA[i].reduce((a, b) => a + b, 0)
    if (sum > EPS) {
      for (let j = 0; j < nJointStates; j++) {
        jointA[i][j] /= sum
      }
    }
  }

  return jointA
}

export function rollingCorrelationMatrix(
  datasets: Record<string, number[]>,
  windowSize: number
): number[][][] {
  const assetNames = Object.keys(datasets)
  const nAssets = assetNames.length
  const T = datasets[assetNames[0]].length

  const correlations: number[][][] = new Array(T)

  for (let t = 0; t < T; t++) {
    const start = Math.max(0, t - windowSize + 1)
    const end = t + 1
    const windowLen = end - start

    correlations[t] = new Array(nAssets)
    for (let i = 0; i < nAssets; i++) {
      correlations[t][i] = new Array(nAssets)
      for (let j = 0; j < nAssets; j++) {
        if (i === j) {
          correlations[t][i][j] = 1
        } else {
          const seriesI = datasets[assetNames[i]].slice(start, end)
          const seriesJ = datasets[assetNames[j]].slice(start, end)
          correlations[t][i][j] = pearsonCorrelation(seriesI, seriesJ)
        }
      }
    }
  }

  return correlations
}

function pearsonCorrelation(x: number[], y: number[]): number {
  const n = x.length
  if (n === 0) return 0

  const meanX = mean(x)
  const meanY = mean(y)

  let numerator = 0
  let denomX = 0
  let denomY = 0

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    numerator += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }

  const denom = Math.sqrt(denomX * denomY)
  return denom > EPS ? numerator / denom : 0
}

export function computeCorrelationBreakdownScore(
  copulaLL: number[],
  marginalLL: number[],
  windowSize: number = 20
): { [pair: string]: number } {
  const T = copulaLL.length
  const scores: { [pair: string]: number } = {}

  const copulaMean = mean(copulaLL)
  const copulaStd = stdDev(copulaLL, copulaMean)
  const marginalMean = mean(marginalLL)
  const marginalStd = stdDev(marginalLL, marginalMean)

  const copulaAnomaly = copulaLL.map(ll => Math.max(0, (copulaMean - ll) / Math.max(copulaStd, EPS)))
  const marginalAnomaly = marginalLL.map(ll => Math.max(0, (marginalMean - ll) / Math.max(marginalStd, EPS)))

  for (let t = 0; t < T; t++) {
    const totalAnomaly = copulaAnomaly[t] + marginalAnomaly[t]
    if (totalAnomaly > EPS) {
      const score = copulaAnomaly[t] / totalAnomaly
      const pairKey = `t${t}`
      scores[pairKey] = score
    }
  }

  return scores
}

export function identifyDrivingAssets(
  marginalAnomalyScores: Record<string, number[]>,
  topN: number = 2
): string[] {
  const assetNames = Object.keys(marginalAnomalyScores)

  const avgScores = assetNames.map(asset => ({
    asset,
    score: mean(marginalAnomalyScores[asset])
  }))

  avgScores.sort((a, b) => b.score - a.score)

  return avgScores.slice(0, topN).map(item => item.asset)
}

export function trainMultiAssetModel(
  datasets: Record<string, number[][]>,
  config: MultiAssetConfig
): MultiAssetModel {
  const assetNames = config.assets
  const nAssets = assetNames.length

  if (nAssets !== Object.keys(datasets).length) {
    throw new Error('Number of datasets must match number of assets in config')
  }

  const marginalModels: Record<string, HMMModel> = {}
  const marginalStates: Record<string, number[]> = {}
  const marginalLLs: Record<string, number[]> = {}

  for (const asset of assetNames) {
    const model = trainHMM(datasets[asset], config.hmmConfig)
    marginalModels[asset] = model

    const hmm = HMM.fromModel(model)
    const { states } = hmm.viterbi(datasets[asset])
    marginalStates[asset] = states
    marginalLLs[asset] = hmm.computeLogLikelihoods(datasets[asset])
  }

  const uniformData: number[][] = []
  const T = datasets[assetNames[0]].length

  for (let t = 0; t < T; t++) {
    const point: number[] = new Array(nAssets)
    for (let a = 0; a < nAssets; a++) {
      point[a] = (marginalStates[assetNames[a]][t] + 0.5) / marginalModels[assetNames[a]].pi.length
    }
    uniformData.push(point)
  }

  const copulaParams = estimateCopulaParameters(uniformData, config.copulaType)

  const { nJointStates, stateMap } = buildJointStateSpace(marginalModels)
  const jointTransition = buildJointTransitionMatrix(marginalModels, stateMap)

  const jointMu: number[][] = new Array(nJointStates)
  const jointSigma: number[][][] = new Array(nJointStates)

  for (let s = 0; s < nJointStates; s++) {
    const stateIndices = stateMap[s]
    jointMu[s] = []
    for (let a = 0; a < nAssets; a++) {
      jointMu[s] = jointMu[s].concat(marginalModels[assetNames[a]].mu[stateIndices[a]])
    }

    const nFeatures = marginalModels[assetNames[0]].nFeatures
    const totalFeatures = nAssets * nFeatures
    jointSigma[s] = new Array(totalFeatures)

    for (let i = 0; i < totalFeatures; i++) {
      jointSigma[s][i] = new Array(totalFeatures).fill(0)
      const assetI = Math.floor(i / nFeatures)
      const featureI = i % nFeatures
      jointSigma[s][i][i] = marginalModels[assetNames[assetI]].sigma[stateIndices[assetI]][featureI][featureI]
    }

    if (copulaParams.correlationMatrix) {
      for (let a1 = 0; a1 < nAssets; a1++) {
        for (let a2 = 0; a2 < nAssets; a2++) {
          if (a1 !== a2) {
            const corr = copulaParams.correlationMatrix[a1][a2]
            for (let f1 = 0; f1 < nFeatures; f1++) {
              for (let f2 = 0; f2 < nFeatures; f2++) {
                const i = a1 * nFeatures + f1
                const j = a2 * nFeatures + f2
                const sigmaI = Math.sqrt(jointSigma[s][i][i])
                const sigmaJ = Math.sqrt(jointSigma[s][j][j])
                jointSigma[s][i][j] = corr * sigmaI * sigmaJ * 0.5
              }
            }
          }
        }
      }
    }
  }

  const jointPi = new Array(nJointStates).fill(1 / nJointStates)

  const jointModel: HMMModel = {
    id: uuidv4(),
    pi: jointPi,
    A: jointTransition,
    mu: jointMu,
    sigma: jointSigma,
    nFeatures: jointMu[0].length,
    trainedAt: new Date().toISOString(),
    dataLength: T,
    isIncremental: false,
    logLikelihoodHistory: []
  }

  return {
    id: uuidv4(),
    assetNames,
    copulaParams,
    marginalModels,
    jointModel,
    trainedAt: new Date().toISOString(),
    dataLength: T
  }
}

export function detectMultiAssetAnomalies(
  model: MultiAssetModel,
  datasets: Record<string, number[][]>,
  dataId: string,
  timestamps: string[],
  thresholdK: number = 2
): MultiAssetAnomalyResult {
  const assetNames = model.assetNames
  const nAssets = assetNames.length
  const T = timestamps.length

  const marginalLogLikelihoods: Record<string, number[]> = {}
  const marginalAnomalyScores: Record<string, number[]> = {}

  for (const asset of assetNames) {
    const result = detectAnomalies(model.marginalModels[asset], datasets[asset], thresholdK)
    marginalLogLikelihoods[asset] = result.logLikelihoods
    marginalAnomalyScores[asset] = result.anomalyScores
  }

  const uniformData: number[][] = []
  for (let t = 0; t < T; t++) {
    const point: number[] = new Array(nAssets)
    for (let a = 0; a < nAssets; a++) {
      const hmm = HMM.fromModel(model.marginalModels[assetNames[a]])
      const { states } = hmm.viterbi(datasets[assetNames[a]].slice(0, t + 1))
      const state = states[states.length - 1]
      point[a] = (state + 0.5) / model.marginalModels[assetNames[a]].pi.length
    }
    uniformData.push(point)
  }

  const copulaLLs: number[] = new Array(T)
  for (let t = 0; t < T; t++) {
    copulaLLs[t] = computeCopulaLogLikelihood([uniformData[t]], model.copulaParams)
  }

  const jointLogLikelihoods: number[] = new Array(T)
  for (let t = 0; t < T; t++) {
    let sumMarginal = 0
    for (const asset of assetNames) {
      sumMarginal += marginalLogLikelihoods[asset][t]
    }
    jointLogLikelihoods[t] = sumMarginal + copulaLLs[t]
  }

  const meanLL = mean(jointLogLikelihoods)
  const stdLL = stdDev(jointLogLikelihoods, meanLL)
  const threshold = meanLL - thresholdK * stdLL

  const anomalies: boolean[] = new Array(T)
  const anomalyScores: number[] = new Array(T)

  for (let t = 0; t < T; t++) {
    anomalies[t] = jointLogLikelihoods[t] < threshold
    anomalyScores[t] = Math.max(0, (threshold - jointLogLikelihoods[t]) / Math.max(stdLL, EPS))
  }

  const flatMarginalLLs: number[] = []
  for (let t = 0; t < T; t++) {
    let sum = 0
    for (const asset of assetNames) {
      sum += marginalLogLikelihoods[asset][t]
    }
    flatMarginalLLs.push(sum)
  }

  const correlationBreakdownScores = computeCorrelationBreakdownScore(copulaLLs, flatMarginalLLs)

  const drivingAssets = identifyDrivingAssets(marginalAnomalyScores, Math.min(2, nAssets))

  return {
    id: uuidv4(),
    timestamps: [...timestamps],
    jointLogLikelihoods,
    marginalLogLikelihoods,
    anomalyScores,
    anomalies,
    correlationBreakdownScores,
    drivingAssets,
    threshold,
    dataId,
    modelId: model.id
  }
}

export function computeCopulaDensitySurface(
  params: CopulaParameters,
  resolution: number = 50
): { x: number[]; y: number[]; z: number[][] } {
  const x: number[] = []
  const y: number[] = []
  const z: number[][] = new Array(resolution)

  for (let i = 0; i < resolution; i++) {
    const u = (i + 0.5) / resolution
    x.push(u)
    y.push(u)
    z[i] = new Array(resolution)
  }

  for (let i = 0; i < resolution; i++) {
    for (let j = 0; j < resolution; j++) {
      const u = [x[i], y[j]]
      let pdf = 1
      switch (params.type) {
        case 'gaussian':
          pdf = gaussianCopulaPDF(u, params.rho || 0)
          break
        case 't':
          pdf = tCopulaPDF(u, params.rho || 0, params.df || 5)
          break
        case 'clayton':
          pdf = claytonCopulaPDF(u, params.theta || 1)
          break
        case 'gumbel':
          pdf = gumbelCopulaPDF(u, params.theta || 1)
          break
        case 'frank':
          pdf = frankCopulaPDF(u, params.theta || 1)
          break
      }
      z[i][j] = pdf
    }
  }

  return { x, y, z }
}