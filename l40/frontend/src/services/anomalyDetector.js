import { fftWithWindow, hanning, findPeakFrequencies, bandEnergy } from './fft';
import { runDemoInference, extractFeaturesForOnnx } from './demoAnomalyModel';

const WINDOW_SIZE = 1024;
const SAMPLE_RATE = 1000;
const DETECTION_INTERVAL = 2000;
const MAX_BUFFER_SIZE = 2048;

let onnxSession = null;
let isDemoMode = true;
let isInitialized = false;
let detectionTimers = {};
let anomalyStates = {};
let windowBuffers = {};
let anomalyCallbacks = [];
let latestSpectra = {};

async function loadOnnxRuntime() {
  try {
    const ort = await import('onnxruntime-web');
    if (ort && ort.InferenceSession) {
      const session = await ort.InferenceSession.create('/models/anomaly_detector.onnx', {
        executionProviders: ['wasm'],
      });
      onnxSession = session;
      isDemoMode = false;
      console.log('[AnomalyDetector] ONNX model loaded successfully');
      return true;
    }
  } catch (err) {
    console.warn('[AnomalyDetector] ONNX Runtime not available, using demo mode:', err.message);
  }
  isDemoMode = true;
  onnxSession = null;
  return false;
}

async function runOnnxInference(featureVector) {
  if (!onnxSession) return null;

  try {
    const ort = await import('onnxruntime-web');
    const inputTensor = new ort.Tensor('float32', new Float32Array(featureVector), [1, featureVector.length]);
    const results = await onnxSession.run({ input: inputTensor });
    const score = results.output?.data?.[0] ?? results[Object.keys(results)[0]]?.data?.[0];
    if (typeof score === 'number') {
      const clampedScore = Math.max(0, Math.min(1, score));
      return {
        anomalyScore: Math.round(clampedScore * 1000) / 1000,
        anomalyLevel: clampedScore <= 0.3 ? 'normal' : clampedScore <= 0.7 ? 'warning' : 'critical',
        signals: [],
        modelType: 'onnx',
      };
    }
  } catch (err) {
    console.warn('[AnomalyDetector] ONNX inference failed, falling back to demo:', err.message);
  }
  return null;
}

function addToBuffer(equipmentId, value) {
  if (!windowBuffers[equipmentId]) {
    windowBuffers[equipmentId] = new Float64Array(MAX_BUFFER_SIZE);
    windowBuffers[equipmentId]._count = 0;
    windowBuffers[equipmentId]._writeIdx = 0;
  }

  const buf = windowBuffers[equipmentId];
  buf[buf._writeIdx] = value;
  buf._writeIdx = (buf._writeIdx + 1) % MAX_BUFFER_SIZE;
  buf._count = Math.min(buf._count + 1, MAX_BUFFER_SIZE);
}

function getBufferSlice(equipmentId, length = WINDOW_SIZE) {
  const buf = windowBuffers[equipmentId];
  if (!buf || buf._count === 0) return null;

  const count = Math.min(buf._count, length);
  const slice = new Float64Array(count);

  if (buf._count < MAX_BUFFER_SIZE) {
    const start = Math.max(0, buf._count - count);
    for (let i = 0; i < count; i++) {
      slice[i] = buf[start + i];
    }
  } else {
    const start = (buf._writeIdx - count + MAX_BUFFER_SIZE) % MAX_BUFFER_SIZE;
    for (let i = 0; i < count; i++) {
      slice[i] = buf[(start + i) % MAX_BUFFER_SIZE];
    }
  }

  return slice;
}

function computeSpectrum(vibrationData) {
  if (!vibrationData || vibrationData.length < 16) return null;
  return fftWithWindow(vibrationData, SAMPLE_RATE, hanning);
}

async function processDetection(equipmentId) {
  const buffer = getBufferSlice(equipmentId, WINDOW_SIZE);
  if (!buffer || buffer.length < 64) return;

  let result;

  if (!isDemoMode && onnxSession) {
    const { featureVector, spectrum, rawFeatures } = extractFeaturesForOnnx(buffer, SAMPLE_RATE);
    const onnxResult = await runOnnxInference(featureVector);
    if (onnxResult) {
      result = {
        ...onnxResult,
        features: rawFeatures ? {
          rms: rawFeatures.rms,
          crestFactor: rawFeatures.crestFactor,
          kurtosis: rawFeatures.kurtosis,
          bandEnergies: rawFeatures.bandEnergies,
        } : {},
        spectrum,
        timestamp: Date.now(),
        equipmentId,
      };
    }
  }

  if (!result) {
    result = {
      ...runDemoInference(buffer, SAMPLE_RATE),
      equipmentId,
    };
  }

  latestSpectra[equipmentId] = result.spectrum;

  const prevState = anomalyStates[equipmentId];
  const newState = {
    score: result.anomalyScore,
    level: result.anomalyLevel,
    details: {
      signals: result.signals || [],
      features: result.features || {},
    },
    timestamp: result.timestamp,
    equipmentId,
  };

  anomalyStates[equipmentId] = newState;

  if (newState.level !== 'normal') {
    emitAnomaly(newState, prevState);
  }

  return newState;
}

function emitAnomaly(newState, prevState) {
  const event = {
    equipmentId: newState.equipmentId,
    score: newState.score,
    level: newState.level,
    details: newState.details,
    timestamp: newState.timestamp,
    isEscalation: prevState && prevState.level !== newState.level && (
      (newState.level === 'warning' && prevState.level === 'normal') ||
      (newState.level === 'critical')
    ),
  };

  for (const cb of anomalyCallbacks) {
    try {
      cb(event);
    } catch (err) {
      console.error('[AnomalyDetector] Callback error:', err);
    }
  }
}

export async function initDetector() {
  if (isInitialized) return;
  isInitialized = true;

  await loadOnnxRuntime();
  console.log(`[AnomalyDetector] Initialized in ${isDemoMode ? 'demo' : 'ONNX'} mode`);
}

export async function runDetection(vibrationData, equipmentId = 'default') {
  if (!isInitialized) {
    await initDetector();
  }

  if (Array.isArray(vibrationData)) {
    for (const val of vibrationData) {
      addToBuffer(equipmentId, val);
    }
  } else if (typeof vibrationData === 'number') {
    addToBuffer(equipmentId, vibrationData);
  }

  return processDetection(equipmentId);
}

export function onAnomaly(callback) {
  anomalyCallbacks.push(callback);
  return () => {
    anomalyCallbacks = anomalyCallbacks.filter(cb => cb !== callback);
  };
}

export function getAnomalyState(equipmentId) {
  if (equipmentId) {
    return anomalyStates[equipmentId] || null;
  }
  return { ...anomalyStates };
}

export function getSpectrumData(equipmentId) {
  return latestSpectra[equipmentId] || null;
}

export function startDetectionLoop(equipmentId, dataProvider) {
  stopDetectionLoop(equipmentId);

  const timer = setInterval(async () => {
    const buffer = getBufferSlice(equipmentId);
    if (buffer && buffer.length >= 64) {
      await processDetection(equipmentId);
    }
  }, DETECTION_INTERVAL);

  detectionTimers[equipmentId] = { timer, dataProvider };
  console.log(`[AnomalyDetector] Detection loop started for ${equipmentId}`);
}

export function stopDetectionLoop(equipmentId) {
  if (detectionTimers[equipmentId]) {
    clearInterval(detectionTimers[equipmentId].timer);
    delete detectionTimers[equipmentId];
    console.log(`[AnomalyDetector] Detection loop stopped for ${equipmentId}`);
  }
}

export function feedVibrationSample(equipmentId, value) {
  addToBuffer(equipmentId, value);
}

export function destroyDetector() {
  for (const id of Object.keys(detectionTimers)) {
    stopDetectionLoop(id);
  }
  for (const id of Object.keys(windowBuffers)) {
    delete windowBuffers[id];
  }
  anomalyStates = {};
  latestSpectra = {};
  anomalyCallbacks = [];
  if (onnxSession) {
    onnxSession.release().catch(() => {});
    onnxSession = null;
  }
  isInitialized = false;
  isDemoMode = true;
  console.log('[AnomalyDetector] Destroyed');
}

export function isDemoModeActive() {
  return isDemoMode;
}
