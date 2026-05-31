import { v4 as uuidv4 } from 'uuid';
import type { TimeSeriesData } from '../../shared/types';
import { mean, stdDev } from './utils';

function generateDates(length: number, startDate: Date = new Date()): string[] {
  const dates: string[] = new Array(length);
  const current = new Date(startDate);
  current.setDate(current.getDate() - length);

  for (let i = 0; i < length; i++) {
    current.setDate(current.getDate() + 1);
    dates[i] = current.toISOString().split('T')[0];
  }

  return dates;
}

function generateGARCHVolatility(length: number, omega: number = 0.1, alpha: number = 0.1, beta: number = 0.8): number[] {
  const volatility: number[] = new Array(length);
  volatility[0] = Math.sqrt(omega / (1 - alpha - beta));

  for (let t = 1; t < length; t++) {
    const epsilon = (Math.random() - 0.5) * 2 * volatility[t - 1];
    volatility[t] = Math.sqrt(omega + alpha * epsilon * epsilon + beta * volatility[t - 1] * volatility[t - 1]);
  }

  return volatility;
}

function calculateSMA(values: number[], period: number): number[] {
  const sma: number[] = new Array(values.length);
  let sum = 0;

  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) {
      sum -= values[i - period];
    }
    sma[i] = sum / Math.min(i + 1, period);
  }

  return sma;
}

function calculateRSI(prices: number[], period: number = 14): number[] {
  const rsi: number[] = new Array(prices.length);
  const gains: number[] = new Array(prices.length).fill(0);
  const losses: number[] = new Array(prices.length).fill(0);

  for (let i = 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff > 0) {
      gains[i] = diff;
    } else {
      losses[i] = -diff;
    }
  }

  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period && i < prices.length; i++) {
    avgGain += gains[i];
    avgLoss += losses[i];
  }

  avgGain /= period;
  avgLoss /= period;

  for (let i = period; i < prices.length; i++) {
    if (i > period) {
      avgGain = (avgGain * (period - 1) + gains[i]) / period;
      avgLoss = (avgLoss * (period - 1) + losses[i]) / period;
    }

    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi[i] = 100 - (100 / (1 + rs));
  }

  for (let i = 0; i < Math.min(period, prices.length); i++) {
    rsi[i] = 50;
  }

  return rsi;
}

function injectAnomalies(values: number[], anomalyRate: number = 0.02, anomalyStrength: number = 3): { values: number[]; anomalyIndices: number[] } {
  const result = [...values];
  const anomalyIndices: number[] = [];
  const sd = stdDev(values);

  for (let i = 0; i < values.length; i++) {
    if (Math.random() < anomalyRate) {
      const direction = Math.random() > 0.5 ? 1 : -1;
      result[i] = values[i] + direction * anomalyStrength * sd * (1 + Math.random());
      anomalyIndices.push(i);
    }
  }

  return { values: result, anomalyIndices };
}

export interface StockDataConfig {
  length?: number;
  startPrice?: number;
  drift?: number;
  volatilityBase?: number;
  anomalyRate?: number;
  seed?: number;
}

export function generateStockData(config: StockDataConfig = {}): TimeSeriesData {
  const {
    length = 1000,
    startPrice = 100,
    drift = 0.0005,
    volatilityBase = 0.02,
    anomalyRate = 0.02
  } = config;

  if (length > 100000) {
    throw new Error('Data length exceeds maximum of 100,000 time points');
  }

  const dates = generateDates(length);
  const garchVol = generateGARCHVolatility(length, volatilityBase * 0.1, 0.1, 0.8);

  const logReturns: number[] = new Array(length);
  logReturns[0] = 0;
  for (let t = 1; t < length; t++) {
    const sigma = volatilityBase * garchVol[t];
    logReturns[t] = drift + (Math.random() - 0.5) * 2 * sigma;
  }

  const closePrices: number[] = new Array(length);
  closePrices[0] = startPrice;
  for (let t = 1; t < length; t++) {
    closePrices[t] = closePrices[t - 1] * Math.exp(logReturns[t]);
  }

  const anomalyResult = injectAnomalies(closePrices, anomalyRate, 2.5);
  const closeWithAnomalies = anomalyResult.values;

  const openPrices: number[] = new Array(length);
  const highPrices: number[] = new Array(length);
  const lowPrices: number[] = new Array(length);
  const volume: number[] = new Array(length);

  for (let t = 0; t < length; t++) {
    const overnightGap = (Math.random() - 0.5) * 0.01 * closeWithAnomalies[t];
    openPrices[t] = t === 0 ? closeWithAnomalies[t] : closeWithAnomalies[t - 1] + overnightGap;

    const dailyRange = Math.abs(logReturns[t]) * closeWithAnomalies[t] * (1 + Math.random());
    highPrices[t] = Math.max(openPrices[t], closeWithAnomalies[t]) + dailyRange * Math.random();
    lowPrices[t] = Math.min(openPrices[t], closeWithAnomalies[t]) - dailyRange * Math.random();

    const baseVolume = 1000000;
    const volMultiplier = 1 + Math.abs(logReturns[t]) * 10 + Math.random() * 0.5;
    volume[t] = Math.round(baseVolume * volMultiplier);
  }

  const returns: number[] = new Array(length);
  returns[0] = 0;
  for (let t = 1; t < length; t++) {
    returns[t] = (closeWithAnomalies[t] - closeWithAnomalies[t - 1]) / closeWithAnomalies[t - 1];
  }

  const rollingVol: number[] = new Array(length);
  const volWindow = 20;
  for (let t = 0; t < length; t++) {
    const start = Math.max(0, t - volWindow + 1);
    const slice = returns.slice(start, t + 1);
    rollingVol[t] = stdDev(slice) * Math.sqrt(252);
  }

  const sma20 = calculateSMA(closeWithAnomalies, 20);
  const sma50 = calculateSMA(closeWithAnomalies, 50);
  const rsi = calculateRSI(closeWithAnomalies, 14);

  const features: Record<string, number[]> = {
    open: openPrices,
    high: highPrices,
    low: lowPrices,
    close: closeWithAnomalies,
    volume: volume,
    return: returns,
    volatility: rollingVol,
    sma20: sma20,
    sma50: sma50,
    rsi: rsi
  };

  const selectedFeatures = ['close', 'return', 'volatility', 'rsi'];

  return {
    id: uuidv4(),
    name: '模拟股票数据',
    dates,
    features,
    selectedFeatures,
    length
  };
}

export interface ForexDataConfig {
  length?: number;
  startRate?: number;
  baseCurrency?: string;
  quoteCurrency?: string;
  volatility?: number;
  anomalyRate?: number;
}

export function generateForexData(config: ForexDataConfig = {}): TimeSeriesData {
  const {
    length = 1000,
    startRate = 1.15,
    baseCurrency = 'EUR',
    quoteCurrency = 'USD',
    volatility = 0.005,
    anomalyRate = 0.015
  } = config;

  if (length > 100000) {
    throw new Error('Data length exceeds maximum of 100,000 time points');
  }

  const dates = generateDates(length);
  const garchVol = generateGARCHVolatility(length, volatility * 0.05, 0.05, 0.9);

  const closeRates: number[] = new Array(length);
  closeRates[0] = startRate;

  for (let t = 1; t < length; t++) {
    const sigma = volatility * garchVol[t];
    const change = (Math.random() - 0.5) * 2 * sigma * closeRates[t - 1];
    closeRates[t] = closeRates[t - 1] + change;
  }

  const anomalyResult = injectAnomalies(closeRates, anomalyRate, 3);
  const closeWithAnomalies = anomalyResult.values;

  const openRates: number[] = new Array(length);
  const highRates: number[] = new Array(length);
  const lowRates: number[] = new Array(length);
  const tickVolume: number[] = new Array(length);

  for (let t = 0; t < length; t++) {
    const gap = (Math.random() - 0.5) * 0.002 * closeWithAnomalies[t];
    openRates[t] = t === 0 ? closeWithAnomalies[t] : closeWithAnomalies[t - 1] + gap;

    const dailyRange = Math.abs(closeWithAnomalies[t] - openRates[t]) * (1.5 + Math.random());
    highRates[t] = Math.max(openRates[t], closeWithAnomalies[t]) + dailyRange * Math.random();
    lowRates[t] = Math.min(openRates[t], closeWithAnomalies[t]) - dailyRange * Math.random();

    tickVolume[t] = Math.round(1000 + Math.random() * 5000);
  }

  const returns: number[] = new Array(length);
  returns[0] = 0;
  for (let t = 1; t < length; t++) {
    returns[t] = (closeWithAnomalies[t] - closeWithAnomalies[t - 1]) / closeWithAnomalies[t - 1];
  }

  const rollingVol: number[] = new Array(length);
  const volWindow = 20;
  for (let t = 0; t < length; t++) {
    const start = Math.max(0, t - volWindow + 1);
    const slice = returns.slice(start, t + 1);
    rollingVol[t] = stdDev(slice) * Math.sqrt(252);
  }

  const sma10 = calculateSMA(closeWithAnomalies, 10);
  const sma50 = calculateSMA(closeWithAnomalies, 50);
  const rsi = calculateRSI(closeWithAnomalies, 14);

  const features: Record<string, number[]> = {
    open: openRates,
    high: highRates,
    low: lowRates,
    close: closeWithAnomalies,
    volume: tickVolume,
    return: returns,
    volatility: rollingVol,
    sma10: sma10,
    sma50: sma50,
    rsi: rsi
  };

  const selectedFeatures = ['close', 'return', 'volatility', 'rsi'];

  return {
    id: uuidv4(),
    name: `${baseCurrency}/${quoteCurrency} 模拟外汇数据`,
    dates,
    features,
    selectedFeatures,
    length
  };
}

export function getFeaturesMatrix(data: TimeSeriesData, featureNames: string[]): number[][] {
  const T = data.length;
  const matrix: number[][] = new Array(T);

  for (let t = 0; t < T; t++) {
    matrix[t] = featureNames.map(name => data.features[name][t]);
  }

  return matrix;
}

export function generateLargeDataset(length: number = 100000): TimeSeriesData {
  if (length > 100000) {
    throw new Error('Maximum length is 100,000 time points');
  }
  return generateStockData({ length });
}
