import { fftWithWindow, findPeakFrequencies, bandEnergy, hanning } from './fft';

function computeRMS(data) {
  if (!data || data.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < data.length; i++) {
    sumSq += data[i] * data[i];
  }
  return Math.sqrt(sumSq / data.length);
}

function computePeak(data) {
  if (!data || data.length === 0) return 0;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    if (data[i] > max) max = data[i];
  }
  return max;
}

function computeCrestFactor(data) {
  const rms = computeRMS(data);
  if (rms === 0) return 0;
  return computePeak(data) / rms;
}

function computeKurtosis(data) {
  if (!data || data.length < 4) return 0;
  const N = data.length;
  let mean = 0;
  for (let i = 0; i < N; i++) mean += data[i];
  mean /= N;

  let m2 = 0, m4 = 0;
  for (let i = 0; i < N; i++) {
    const d = data[i] - mean;
    m2 += d * d;
    m4 += d * d * d * d;
  }
  m2 /= N;
  m4 /= N;

  if (m2 === 0) return 0;
  const kurt = (m4 / (m2 * m2)) - 3;
  return kurt;
}

function extractFeatures(vibrationData, sampleRate = 1000) {
  const rms = computeRMS(vibrationData);
  const crestFactor = computeCrestFactor(vibrationData);
  const kurtosis = computeKurtosis(vibrationData);

  const spectrum = fftWithWindow(vibrationData, sampleRate, hanning);
  const peakFreqs = findPeakFrequencies(spectrum.magnitude, sampleRate, 5);

  const band0_50 = bandEnergy(spectrum.magnitude, sampleRate, 0, 50);
  const band50_200 = bandEnergy(spectrum.magnitude, sampleRate, 50, 200);
  const band200_500 = bandEnergy(spectrum.magnitude, sampleRate, 200, 500);
  const band500_1000 = bandEnergy(spectrum.magnitude, sampleRate, 500, 1000);

  return {
    rms,
    crestFactor,
    kurtosis,
    peakFrequencies: peakFreqs,
    bandEnergies: {
      '0-50Hz': band0_50,
      '50-200Hz': band50_200,
      '200-500Hz': band200_500,
      '500-1000Hz': band500_1000,
    },
    totalBandEnergy: band0_50 + band50_200 + band200_500 + band500_1000,
    spectrum,
  };
}

function classifyScore(score) {
  if (score <= 0.3) return 'normal';
  if (score <= 0.7) return 'warning';
  return 'critical';
}

function computeAnomalyScore(features) {
  const { rms, crestFactor, kurtosis, bandEnergies, totalBandEnergy } = features;
  const signals = [];
  let scoreAccum = 0;
  let weightSum = 0;

  if (rms > 9) {
    signals.push({ metric: 'rms', value: rms, threshold: 9, severity: 'critical' });
    const contribution = Math.min(1, (rms - 7) / 5) * 0.35;
    scoreAccum += contribution;
    weightSum += 0.35;
  } else if (rms > 7) {
    signals.push({ metric: 'rms', value: rms, threshold: 7, severity: 'warning' });
    const contribution = Math.min(1, (rms - 5) / 4) * 0.25;
    scoreAccum += contribution;
    weightSum += 0.25;
  } else {
    scoreAccum += Math.max(0, rms / 7) * 0.1;
    weightSum += 0.1;
  }

  if (kurtosis > 5) {
    signals.push({ metric: 'kurtosis', value: kurtosis, threshold: 5, severity: 'warning' });
    const contribution = Math.min(1, (kurtosis - 3) / 7) * 0.25;
    scoreAccum += contribution;
    weightSum += 0.25;
  } else if (kurtosis > 3) {
    const contribution = Math.min(1, (kurtosis - 3) / 2) * 0.1;
    scoreAccum += contribution;
    weightSum += 0.1;
  } else {
    scoreAccum += 0.02;
    weightSum += 0.1;
  }

  if (crestFactor > 6) {
    signals.push({ metric: 'crestFactor', value: crestFactor, threshold: 6, severity: 'warning' });
    const contribution = Math.min(1, (crestFactor - 4) / 6) * 0.2;
    scoreAccum += contribution;
    weightSum += 0.2;
  } else {
    scoreAccum += Math.max(0, crestFactor / 6) * 0.05;
    weightSum += 0.2;
  }

  const highFreqEnergy = (bandEnergies['200-500Hz'] || 0) + (bandEnergies['500-1000Hz'] || 0);
  const lowFreqEnergy = (bandEnergies['0-50Hz'] || 0) + (bandEnergies['50-200Hz'] || 0);
  const energyRatio = totalBandEnergy > 0 ? highFreqEnergy / totalBandEnergy : 0;

  if (energyRatio > 0.5) {
    signals.push({ metric: 'highFreqRatio', value: energyRatio, threshold: 0.5, severity: 'warning' });
    scoreAccum += 0.15;
    weightSum += 0.2;
  } else {
    scoreAccum += energyRatio * 0.05;
    weightSum += 0.2;
  }

  const score = weightSum > 0 ? Math.min(1, Math.max(0, scoreAccum / weightSum * 1.5)) : 0;

  return {
    score: Math.round(score * 1000) / 1000,
    level: classifyScore(score),
    signals,
    features: {
      rms: Math.round(rms * 1000) / 1000,
      crestFactor: Math.round(crestFactor * 1000) / 1000,
      kurtosis: Math.round(kurtosis * 1000) / 1000,
      bandEnergies: Object.fromEntries(
        Object.entries(bandEnergies).map(([k, v]) => [k, Math.round(v * 1000) / 1000])
      ),
    },
  };
}

export function runDemoInference(vibrationData, sampleRate = 1000) {
  const features = extractFeatures(vibrationData, sampleRate);
  const result = computeAnomalyScore(features);

  return {
    anomalyScore: result.score,
    anomalyLevel: result.level,
    signals: result.signals,
    features: result.features,
    spectrum: features.spectrum,
    timestamp: Date.now(),
    modelType: 'demo',
  };
}

export function extractFeaturesForOnnx(vibrationData, sampleRate = 1000) {
  const features = extractFeatures(vibrationData, sampleRate);
  const featureVector = [
    features.rms,
    features.crestFactor,
    features.kurtosis,
    features.bandEnergies['0-50Hz'],
    features.bandEnergies['50-200Hz'],
    features.bandEnergies['200-500Hz'],
    features.bandEnergies['500-1000Hz'],
  ];
  return { featureVector, spectrum: features.spectrum, rawFeatures: features };
}
