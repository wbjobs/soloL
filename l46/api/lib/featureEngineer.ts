import type { TimeSeriesData } from '../../shared/types.js'
import { dataStore } from './datastore.js'

export function pctChange(series: number[]): number[] {
  const result: number[] = [0]
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] === 0) {
      result.push(0)
    } else {
      result.push((series[i] - series[i - 1]) / series[i - 1])
    }
  }
  return result
}

export function logReturns(series: number[]): number[] {
  const result: number[] = [0]
  for (let i = 1; i < series.length; i++) {
    if (series[i - 1] <= 0 || series[i] <= 0) {
      result.push(0)
    } else {
      result.push(Math.log(series[i] / series[i - 1]))
    }
  }
  return result
}

export function rollingStd(series: number[], window: number = 20): number[] {
  const result: number[] = []
  for (let i = 0; i < series.length; i++) {
    if (i < window - 1) {
      result.push(0)
    } else {
      const windowData = series.slice(i - window + 1, i + 1)
      const mean = windowData.reduce((a, b) => a + b, 0) / window
      const variance =
        windowData.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
        window
      result.push(Math.sqrt(variance))
    }
  }
  return result
}

export function sma(series: number[], window: number = 20): number[] {
  const result: number[] = []
  for (let i = 0; i < series.length; i++) {
    if (i < window - 1) {
      result.push(0)
    } else {
      const windowData = series.slice(i - window + 1, i + 1)
      result.push(windowData.reduce((a, b) => a + b, 0) / window)
    }
  }
  return result
}

export function rsi(series: number[], window: number = 14): number[] {
  const result: number[] = []
  const deltas: number[] = []

  for (let i = 1; i < series.length; i++) {
    deltas.push(series[i] - series[i - 1])
  }

  for (let i = 0; i < series.length; i++) {
    if (i < window) {
      result.push(50)
    } else {
      const windowDeltas = deltas.slice(i - window, i)
      let gains = 0
      let losses = 0
      for (const d of windowDeltas) {
        if (d > 0) gains += d
        else losses += Math.abs(d)
      }
      const avgGain = gains / window
      const avgLoss = losses / window
      if (avgLoss === 0) {
        result.push(100)
      } else {
        const rs = avgGain / avgLoss
        result.push(100 - 100 / (1 + rs))
      }
    }
  }

  return result
}

export function macd(
  series: number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9,
): {
  macd: number[]
  signal: number[]
  histogram: number[]
} {
  const fastEMA = ema(series, fastPeriod)
  const slowEMA = ema(series, slowPeriod)

  const macdLine: number[] = []
  for (let i = 0; i < series.length; i++) {
    macdLine.push(fastEMA[i] - slowEMA[i])
  }

  const signalLine = ema(macdLine, signalPeriod)

  const histogram: number[] = []
  for (let i = 0; i < series.length; i++) {
    histogram.push(macdLine[i] - signalLine[i])
  }

  return {
    macd: macdLine,
    signal: signalLine,
    histogram,
  }
}

export function ema(series: number[], window: number): number[] {
  const result: number[] = []
  const multiplier = 2 / (window + 1)
  let smaValue = 0

  for (let i = 0; i < series.length; i++) {
    if (i < window - 1) {
      result.push(0)
      smaValue += series[i] / window
    } else if (i === window - 1) {
      smaValue += series[i] / window
      result.push(smaValue)
    } else {
      result.push(
        series[i] * multiplier + result[i - 1] * (1 - multiplier),
      )
    }
  }

  return result
}

export function volumeChangeRate(volume: number[]): number[] {
  return pctChange(volume)
}

export function normalize(series: number[]): number[] {
  const min = Math.min(...series)
  const max = Math.max(...series)
  const range = max - min
  if (range === 0) return Array(series.length).fill(0)
  return series.map((v) => (v - min) / range)
}

export function standardize(series: number[]): number[] {
  const mean = series.reduce((a, b) => a + b, 0) / series.length
  const variance =
    series.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    series.length
  const std = Math.sqrt(variance)
  if (std === 0) return Array(series.length).fill(0)
  return series.map((v) => (v - mean) / std)
}

export interface FeatureConfig {
  pctChange?: boolean | string[]
  logReturns?: boolean | string[]
  volatility?: boolean | { window: number; features: string[] }
  sma?: boolean | { window: number; features: string[] }
  rsi?: boolean | { window: number; features: string[] }
  macd?: boolean | { fastPeriod: number; slowPeriod: number; signalPeriod: number; features: string[] }
  volumeChange?: boolean | string
}

export function engineerFeatures(
  data: TimeSeriesData,
  config: FeatureConfig = {},
): TimeSeriesData {
  const newFeatures: Record<string, number[]> = { ...data.features }
  const newSelectedFeatures: string[] = [...data.selectedFeatures]

  const priceFeatures = Object.keys(data.features).filter(
    (k) => k.toLowerCase().includes('price') || k === 'close' || k === 'open' || k === 'high' || k === 'low',
  )
  const defaultFeatures = priceFeatures.length > 0 ? priceFeatures : [Object.keys(data.features)[0]]

  if (config.pctChange) {
    const features =
      Array.isArray(config.pctChange) && config.pctChange.length > 0
        ? config.pctChange
        : defaultFeatures
    for (const feature of features) {
      if (data.features[feature]) {
        const name = `${feature}_pctChange`
        newFeatures[name] = pctChange(data.features[feature])
        if (!newSelectedFeatures.includes(name)) {
          newSelectedFeatures.push(name)
        }
      }
    }
  }

  if (config.logReturns) {
    const features =
      Array.isArray(config.logReturns) && config.logReturns.length > 0
        ? config.logReturns
        : defaultFeatures
    for (const feature of features) {
      if (data.features[feature]) {
        const name = `${feature}_logReturn`
        newFeatures[name] = logReturns(data.features[feature])
        if (!newSelectedFeatures.includes(name)) {
          newSelectedFeatures.push(name)
        }
      }
    }
  }

  if (config.volatility) {
    const window =
      typeof config.volatility === 'object' && config.volatility.window
        ? config.volatility.window
        : 20
    const features =
      typeof config.volatility === 'object' && config.volatility.features
        ? config.volatility.features
        : defaultFeatures
    for (const feature of features) {
      if (data.features[feature]) {
        const name = `${feature}_volatility_${window}`
        newFeatures[name] = rollingStd(data.features[feature], window)
        if (!newSelectedFeatures.includes(name)) {
          newSelectedFeatures.push(name)
        }
      }
    }
  }

  if (config.sma) {
    const window =
      typeof config.sma === 'object' && config.sma.window
        ? config.sma.window
        : 20
    const features =
      typeof config.sma === 'object' && config.sma.features
        ? config.sma.features
        : defaultFeatures
    for (const feature of features) {
      if (data.features[feature]) {
        const name = `${feature}_sma_${window}`
        newFeatures[name] = sma(data.features[feature], window)
        if (!newSelectedFeatures.includes(name)) {
          newSelectedFeatures.push(name)
        }
      }
    }
  }

  if (config.rsi) {
    const window =
      typeof config.rsi === 'object' && config.rsi.window
        ? config.rsi.window
        : 14
    const features =
      typeof config.rsi === 'object' && config.rsi.features
        ? config.rsi.features
        : defaultFeatures
    for (const feature of features) {
      if (data.features[feature]) {
        const name = `${feature}_rsi_${window}`
        newFeatures[name] = rsi(data.features[feature], window)
        if (!newSelectedFeatures.includes(name)) {
          newSelectedFeatures.push(name)
        }
      }
    }
  }

  if (config.macd) {
    const fastPeriod =
      typeof config.macd === 'object' && config.macd.fastPeriod
        ? config.macd.fastPeriod
        : 12
    const slowPeriod =
      typeof config.macd === 'object' && config.macd.slowPeriod
        ? config.macd.slowPeriod
        : 26
    const signalPeriod =
      typeof config.macd === 'object' && config.macd.signalPeriod
        ? config.macd.signalPeriod
        : 9
    const features =
      typeof config.macd === 'object' && config.macd.features
        ? config.macd.features
        : defaultFeatures
    for (const feature of features) {
      if (data.features[feature]) {
        const macdResult = macd(
          data.features[feature],
          fastPeriod,
          slowPeriod,
          signalPeriod,
        )
        const macdName = `${feature}_macd_${fastPeriod}_${slowPeriod}`
        const signalName = `${feature}_macd_signal_${signalPeriod}`
        const histName = `${feature}_macd_histogram`
        newFeatures[macdName] = macdResult.macd
        newFeatures[signalName] = macdResult.signal
        newFeatures[histName] = macdResult.histogram
        if (!newSelectedFeatures.includes(macdName)) {
          newSelectedFeatures.push(macdName)
        }
        if (!newSelectedFeatures.includes(signalName)) {
          newSelectedFeatures.push(signalName)
        }
        if (!newSelectedFeatures.includes(histName)) {
          newSelectedFeatures.push(histName)
        }
      }
    }
  }

  if (config.volumeChange) {
    const volumeFeature =
      typeof config.volumeChange === 'string'
        ? config.volumeChange
        : Object.keys(data.features).find(
            (k) => k.toLowerCase().includes('volume') || k === 'volume',
          ) || 'volume'
    if (data.features[volumeFeature]) {
      const name = `${volumeFeature}_changeRate`
      newFeatures[name] = volumeChangeRate(data.features[volumeFeature])
      if (!newSelectedFeatures.includes(name)) {
        newSelectedFeatures.push(name)
      }
    }
  }

  return {
    ...data,
    features: newFeatures,
    selectedFeatures: newSelectedFeatures,
  }
}

export function getObservationsMatrix(
  data: TimeSeriesData,
  features?: string[],
): number[][] {
  const featureList = features || data.selectedFeatures
  const T = data.length
  const observations: number[][] = []

  for (let t = 0; t < T; t++) {
    const row: number[] = []
    for (const feature of featureList) {
      if (data.features[feature]) {
        row.push(data.features[feature][t])
      }
    }
    if (row.length > 0) {
      observations.push(row)
    }
  }

  return observations
}

export function generateSampleData(
  nPoints: number = 500,
  nStates: number = 3,
): TimeSeriesData {
  const dates: string[] = []
  const startDate = new Date('2020-01-01')
  for (let i = 0; i < nPoints; i++) {
    const date = new Date(startDate)
    date.setDate(date.getDate() + i)
    dates.push(date.toISOString().split('T')[0])
  }

  const close: number[] = []
  const volume: number[] = []
  let price = 100

  const stateMeans = [0.001, 0.005, -0.003]
  const stateStds = [0.01, 0.02, 0.015]

  for (let i = 0; i < nPoints; i++) {
    const state = Math.floor(Math.random() * nStates)
    const mean = stateMeans[state]
    const std = stateStds[state]

    const dailyReturn = mean + (Math.random() - 0.5) * 2 * std
    price = price * (1 + dailyReturn)
    close.push(price)

    const baseVolume = 1000000
    const vol = baseVolume * (1 + (Math.random() - 0.5) * 0.5)
    volume.push(vol)
  }

  const high = close.map((c, i) => c * (1 + Math.abs(Math.random() * 0.02)))
  const low = close.map((c, i) => c * (1 - Math.abs(Math.random() * 0.02)))
  const open = close.map((c, i) => {
    if (i === 0) return c
    return close[i - 1] * (1 + (Math.random() - 0.5) * 0.01)
  })

  const features: Record<string, number[]> = {
    open,
    high,
    low,
    close,
    volume,
  }

  return {
    id: dataStore.generateId(),
    name: 'Sample Stock Data',
    dates,
    features,
    selectedFeatures: ['close', 'volume'],
    length: nPoints,
  }
}


