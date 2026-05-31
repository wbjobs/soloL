import type { HMMModel, SHAPResult } from '../../shared/types.js'
import { dataStore } from './datastore.js'
import { logGaussianPDF, logSumExp, EPS, mean, stdDev } from './utils.js'

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

function calculateLogLikelihood(
  model: HMMModel,
  observations: number[][],
): number {
  const T = observations.length
  const N = model.pi.length

  const logPi = model.pi.map((p) => safeLog(p))
  const logA = model.A.map((row) => row.map((p) => safeLog(p)))

  const logAlpha: number[][] = new Array(T)
  const scalingFactors: number[] = new Array(T)

  logAlpha[0] = new Array(N)
  for (let i = 0; i < N; i++) {
    const logB = logGaussianPDF(observations[0], model.mu[i], model.sigma[i])
    logAlpha[0][i] = logPi[i] + (isFinite(logB) ? logB : LOG_ZERO)
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
      const logB = logGaussianPDF(observations[t], model.mu[j], model.sigma[j])
      logAlpha[t][j] = logSumExp(logProbs) + (isFinite(logB) ? logB : LOG_ZERO)
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

  let logLikelihood = 0
  for (let t = 0; t < T; t++) {
    logLikelihood += scalingFactors[t]
  }
  return logLikelihood
}

function reservoirSample<T>(population: T[], nSamples: number): T[] {
  if (nSamples >= population.length) return [...population]
  const result: T[] = population.slice(0, nSamples)
  for (let i = nSamples; i < population.length; i++) {
    const j = Math.floor(Math.random() * (i + 1))
    if (j < nSamples) {
      result[j] = population[i]
    }
  }
  return result
}

function computeMarginalContribions(
  model: HMMModel,
  instance: number[],
  backgroundSample: number[][],
  featureIndex: number,
  nPermutations: number,
): number {
  const nFeatures = instance.length
  let totalContribution = 0

  for (let p = 0; p < nPermutations; p++) {
    const permOrder: number[] = Array.from({ length: nFeatures }, (_, i) => i)
    for (let i = nFeatures - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [permOrder[i], permOrder[j]] = [permOrder[j], permOrder[i]]
    }

    const featurePosInPerm = permOrder.indexOf(featureIndex)

    const beforeFeatures: number[] = new Array(nFeatures)
    const afterFeatures: number[] = new Array(nFeatures)

    const bgIdx = Math.floor(Math.random() * backgroundSample.length)
    const bgSample = backgroundSample[bgIdx]

    for (let f = 0; f < nFeatures; f++) {
      const posInPerm = permOrder.indexOf(f)
      if (posInPerm < featurePosInPerm) {
        beforeFeatures[f] = instance[f]
        afterFeatures[f] = instance[f]
      } else {
        beforeFeatures[f] = bgSample[f]
        afterFeatures[f] = bgSample[f]
      }
    }
    afterFeatures[featureIndex] = instance[featureIndex]

    const llAfter = calculateLogLikelihood(model, [afterFeatures])
    const llBefore = calculateLogLikelihood(model, [beforeFeatures])

    totalContribution += llAfter - llBefore
  }

  return totalContribution / nPermutations
}

export interface SHAPOptions {
  nSamples?: number
  nBackgroundSamples?: number
  nPermutations?: number
}

export function computeSHAP(
  model: HMMModel,
  observations: number[][],
  anomalyIntervals: { start: number; end: number }[],
  featureNames: string[],
  options: SHAPOptions = {},
): Omit<SHAPResult, 'id' | 'dataId' | 'modelId' | 'anomalyResultId'> {
  const {
    nSamples = 1000,
    nBackgroundSamples = 200,
    nPermutations = 50,
  } = options

  const nFeatures = featureNames.length

  const backgroundSample = reservoirSample(observations, nBackgroundSamples)

  const allAnomalyPoints: number[][] = []
  for (const interval of anomalyIntervals) {
    for (let t = interval.start; t <= interval.end; t++) {
      if (t < observations.length) {
        allAnomalyPoints.push(observations[t])
      }
    }
  }

  const sampledAnomalyPoints = reservoirSample(allAnomalyPoints, Math.min(nSamples, allAnomalyPoints.length))

  const allShapValues: Record<string, number[]> = {}
  featureNames.forEach((name) => {
    allShapValues[name] = []
  })

  for (const instance of sampledAnomalyPoints) {
    for (let f = 0; f < nFeatures; f++) {
      const contribution = computeMarginalContribions(
        model,
        instance,
        backgroundSample,
        f,
        nPermutations,
      )
      allShapValues[featureNames[f]].push(contribution)
    }
  }

  const baseLL = calculateLogLikelihood(model, backgroundSample.slice(0, 1))
  const baseValue = baseLL

  const meanAbsShap: Record<string, number> = {}
  for (const name of featureNames) {
    const values = allShapValues[name]
    meanAbsShap[name] =
      values.reduce((sum, v) => sum + Math.abs(v), 0) /
      (values.length || 1)
  }

  const sortedFeatures = [...featureNames].sort(
    (a, b) => meanAbsShap[b] - meanAbsShap[a],
  )

  return {
    featureNames: sortedFeatures,
    shapValues: allShapValues,
    meanAbsShap,
    baseValue,
    anomalyIntervals,
    intervalIndex: 0,
  }
}

export function saveSHAPResult(
  result: Omit<SHAPResult, 'id'>,
): SHAPResult {
  const fullResult: SHAPResult = {
    ...result,
    id: dataStore.generateId(),
  }
  dataStore.saveSHAPResult(fullResult)
  return fullResult
}

export function getFeatureImportanceRanking(
  shapResult: SHAPResult,
): { feature: string; meanAbsShap: number; rank: number }[] {
  return shapResult.featureNames.map((feature, index) => ({
    feature,
    meanAbsShap: shapResult.meanAbsShap[feature],
    rank: index + 1,
  }))
}

export { calculateLogLikelihood }
