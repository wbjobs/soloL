import type {
  HMMConfig,
  HMMModel,
  BacktestConfig,
  BacktestWindowResult,
  BacktestResult,
} from '../../shared/types.js'
import { dataStore } from './datastore.js'
import { calculateLogLikelihood } from './shap.js'
import { trainHMM, detectAnomalies } from './hmm.js'
import { stdDev } from './utils.js'

function injectSimulatedAnomalies(
  data: number[][],
  anomalyRatio: number = 0.05,
): { data: number[][]; labels: boolean[] } {
  const T = data.length
  const nFeatures = data[0].length
  const labels: boolean[] = Array(T).fill(false)

  const nAnomalies = Math.floor(T * anomalyRatio)
  const anomalyIndices: number[] = []

  while (anomalyIndices.length < nAnomalies) {
    const idx = Math.floor(Math.random() * (T - 10)) + 5
    if (!anomalyIndices.some((a) => Math.abs(a - idx) < 3)) {
      anomalyIndices.push(idx)
    }
  }

  const newData = data.map((row) => [...row])

  const stds: number[] = []
  for (let f = 0; f < nFeatures; f++) {
    const mean = data.reduce((sum, row) => sum + row[f], 0) / T
    const variance =
      data.reduce((sum, row) => sum + Math.pow(row[f] - mean, 2), 0) / T
    stds.push(Math.sqrt(variance))
  }

  for (const idx of anomalyIndices) {
    labels[idx] = true
    const featureIdx = Math.floor(Math.random() * nFeatures)
    const direction = Math.random() > 0.5 ? 1 : -1
    newData[idx][featureIdx] += direction * 3 * stds[featureIdx]
  }

  return { data: newData, labels }
}

function calculateMetrics(
  predicted: boolean[],
  actual: boolean[],
): {
  accuracy: number
  precision: number
  recall: number
  f1: number
  falseAlarmRate: number
  truePositives: number
  falsePositives: number
  trueNegatives: number
  falseNegatives: number
} {
  let tp = 0,
    fp = 0,
    tn = 0,
    fn = 0

  for (let i = 0; i < predicted.length; i++) {
    if (predicted[i] && actual[i]) tp++
    else if (predicted[i] && !actual[i]) fp++
    else if (!predicted[i] && !actual[i]) tn++
    else if (!predicted[i] && actual[i]) fn++
  }

  const accuracy = (tp + tn) / (tp + tn + fp + fn || 1)
  const precision = tp / (tp + fp || 1)
  const recall = tp / (tp + fn || 1)
  const f1 = (2 * precision * recall) / (precision + recall || 1e-10)
  const falseAlarmRate = fp / (fp + tn || 1)

  return {
    accuracy,
    precision,
    recall,
    f1,
    falseAlarmRate,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
  }
}

export function runBacktest(
  observations: number[][],
  config: BacktestConfig,
  featureNames: string[],
): Omit<BacktestResult, 'id' | 'dataId'> {
  const { windowSize, stepSize, trainRatio, hmmConfig, anomalyThresholdK } =
    config
  const T = observations.length

  const windowResults: BacktestWindowResult[] = []

  for (
    let startIdx = 0;
    startIdx + windowSize <= T;
    startIdx += stepSize
  ) {
    const windowData = observations.slice(startIdx, startIdx + windowSize)
    const windowIndex = Math.floor(startIdx / stepSize)

    const trainEnd = Math.floor(windowSize * trainRatio)
    const trainData = windowData.slice(0, trainEnd)
    const testData = windowData.slice(trainEnd)

    const { data: testDataWithAnomalies, labels: testLabels } =
      injectSimulatedAnomalies(testData)

    const model = trainHMM(trainData, hmmConfig)

    const detectionResult = detectAnomalies(
      model,
      testDataWithAnomalies,
      anomalyThresholdK,
    )

    const metrics = calculateMetrics(
      detectionResult.anomalies,
      testLabels,
    )

    windowResults.push({
      windowIndex,
      trainStart: startIdx,
      trainEnd: startIdx + trainEnd,
      testStart: startIdx + trainEnd,
      testEnd: startIdx + windowSize,
      ...metrics,
    })
  }

  const accuracies = windowResults.map((w) => w.accuracy)
  const precisions = windowResults.map((w) => w.precision)
  const recalls = windowResults.map((w) => w.recall)
  const f1s = windowResults.map((w) => w.f1)
  const falseAlarmRates = windowResults.map((w) => w.falseAlarmRate)

  const avgAccuracy = accuracies.reduce((a, b) => a + b, 0) / accuracies.length
  const avgPrecision = precisions.reduce((a, b) => a + b, 0) / precisions.length
  const avgRecall = recalls.reduce((a, b) => a + b, 0) / recalls.length
  const avgF1 = f1s.reduce((a, b) => a + b, 0) / f1s.length
  const avgFalseAlarmRate =
    falseAlarmRates.reduce((a, b) => a + b, 0) / falseAlarmRates.length

  const overallMetrics = {
    avgAccuracy,
    avgPrecision,
    avgRecall,
    avgF1,
    avgFalseAlarmRate,
    stdAccuracy: stdDev(accuracies, avgAccuracy),
    stdPrecision: stdDev(precisions, avgPrecision),
    stdRecall: stdDev(recalls, avgRecall),
    stdF1: stdDev(f1s, avgF1),
  }

  return {
    windows: windowResults,
    overallMetrics,
    config,
    completedAt: new Date().toISOString(),
  }
}

export function saveBacktestResult(
  result: Omit<BacktestResult, 'id'>,
): BacktestResult {
  const fullResult: BacktestResult = {
    ...result,
    id: dataStore.generateId(),
  }
  dataStore.saveBacktestResult(fullResult)
  return fullResult
}

export { injectSimulatedAnomalies }
