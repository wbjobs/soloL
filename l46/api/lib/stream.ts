import { Kafka, Consumer, EachMessagePayload, Producer } from 'kafkajs';
import { v4 as uuidv4 } from 'uuid';
import { HMM, detectAnomalies } from './hmm.js';
import { dataStore } from './datastore.js';
import type {
  KafkaConfig,
  StreamConfig,
  StreamMessage,
  StreamResult,
  HMMModel,
} from '../../shared/types.js';

interface WindowDataPoint {
  timestamp: string;
  asset: string;
  values: Record<string, number>;
  uniqueKey: string;
}

interface StreamStatus {
  streamId: string;
  status: 'running' | 'stopped' | 'error';
  messageCount: number;
  resultCount: number;
  windowCount: number;
  lastMessageTime: string | null;
  lastDetectionTime: string | null;
  error: string | null;
  createdAt: string;
}

interface OutputConfig {
  kafkaTopic?: string;
  webhookUrl?: string;
  logToConsole?: boolean;
}

interface StreamInstance {
  detector: StreamDetector;
  consumer: Consumer;
  producer?: Producer;
  status: StreamStatus;
  kafkaConfig: KafkaConfig;
  streamConfig: StreamConfig;
  outputConfig: OutputConfig;
  timeoutTimer?: NodeJS.Timeout;
}

class SlidingWindow {
  private windowSize: number;
  private slideInterval: number;
  private isTimeBased: boolean;
  private dataPoints: WindowDataPoint[];
  private seenKeys: Set<string>;
  private windowStart: number | null;

  constructor(windowSize: number, slideInterval: number, isTimeBased: boolean = false) {
    this.windowSize = windowSize;
    this.slideInterval = slideInterval;
    this.isTimeBased = isTimeBased;
    this.dataPoints = [];
    this.seenKeys = new Set();
    this.windowStart = null;
  }

  private generateUniqueKey(timestamp: string, asset: string): string {
    return `${timestamp}-${asset}`;
  }

  add(point: StreamMessage): boolean {
    const uniqueKey = this.generateUniqueKey(point.timestamp, point.asset);
    
    if (this.seenKeys.has(uniqueKey)) {
      return false;
    }

    const windowPoint: WindowDataPoint = {
      ...point,
      uniqueKey,
    };

    this.dataPoints.push(windowPoint);
    this.seenKeys.add(uniqueKey);

    if (this.isTimeBased && this.windowStart === null) {
      this.windowStart = new Date(point.timestamp).getTime();
    }

    return true;
  }

  getWindow(): StreamMessage[] {
    if (this.isTimeBased) {
      return this.getTimeWindowData();
    }
    return this.getCountWindowData();
  }

  private getTimeWindowData(): StreamMessage[] {
    if (this.dataPoints.length === 0) return [];

    const now = new Date(this.dataPoints[this.dataPoints.length - 1].timestamp).getTime();
    const windowStartMs = now - this.windowSize * 1000;

    return this.dataPoints
      .filter((p) => new Date(p.timestamp).getTime() >= windowStartMs)
      .map((p) => ({
        timestamp: p.timestamp,
        asset: p.asset,
        values: p.values,
      }));
  }

  private getCountWindowData(): StreamMessage[] {
    const startIdx = Math.max(0, this.dataPoints.length - this.windowSize);
    return this.dataPoints.slice(startIdx).map((p) => ({
      timestamp: p.timestamp,
      asset: p.asset,
      values: p.values,
    }));
  }

  isReady(): boolean {
    if (this.isTimeBased) {
      if (this.dataPoints.length === 0 || this.windowStart === null) return false;
      const now = new Date(this.dataPoints[this.dataPoints.length - 1].timestamp).getTime();
      return now - this.windowStart >= this.windowSize * 1000;
    }
    return this.dataPoints.length >= this.windowSize;
  }

  slide(): StreamMessage[] {
    const overlappedData: StreamMessage[] = [];

    if (this.isTimeBased) {
      if (this.dataPoints.length === 0) return [];
      
      const now = new Date(this.dataPoints[this.dataPoints.length - 1].timestamp).getTime();
      const cutoffTime = now - (this.windowSize - this.slideInterval) * 1000;

      const remainingPoints: WindowDataPoint[] = [];
      const newSeenKeys = new Set<string>();

      for (const point of this.dataPoints) {
        const pointTime = new Date(point.timestamp).getTime();
        if (pointTime >= cutoffTime) {
          remainingPoints.push(point);
          newSeenKeys.add(point.uniqueKey);
          overlappedData.push({
            timestamp: point.timestamp,
            asset: point.asset,
            values: point.values,
          });
        }
      }

      this.dataPoints = remainingPoints;
      this.seenKeys = newSeenKeys;
      this.windowStart = cutoffTime;
    } else {
      const keepCount = Math.max(0, this.windowSize - this.slideInterval);
      const startIdx = Math.max(0, this.dataPoints.length - keepCount);

      const remainingPoints = this.dataPoints.slice(startIdx);
      this.dataPoints = remainingPoints;
      this.seenKeys = new Set(remainingPoints.map((p) => p.uniqueKey));

      overlappedData.push(
        ...remainingPoints.map((p) => ({
          timestamp: p.timestamp,
          asset: p.asset,
          values: p.values,
        }))
      );
    }

    return overlappedData;
  }

  size(): number {
    return this.dataPoints.length;
  }

  clear(): void {
    this.dataPoints = [];
    this.seenKeys.clear();
    this.windowStart = null;
  }

  getStartTime(): string | null {
    if (this.dataPoints.length === 0) return null;
    return this.dataPoints[0].timestamp;
  }

  getEndTime(): string | null {
    if (this.dataPoints.length === 0) return null;
    return this.dataPoints[this.dataPoints.length - 1].timestamp;
  }
}

class StreamDetector {
  private modelId: string;
  private window: SlidingWindow;
  private anomalyThreshold: number;
  private onResultCallback?: (result: StreamResult) => void;
  private model: HMM | null = null;
  private detectionCount: number;
  private incrementalUpdate: boolean;
  private updateInterval: number;

  constructor(
    modelId: string,
    windowSize: number,
    slideInterval: number,
    anomalyThreshold: number,
    isTimeBased: boolean = false,
    incrementalUpdate: boolean = false,
    updateInterval: number = 10
  ) {
    this.modelId = modelId;
    this.window = new SlidingWindow(windowSize, slideInterval, isTimeBased);
    this.anomalyThreshold = anomalyThreshold;
    this.detectionCount = 0;
    this.incrementalUpdate = incrementalUpdate;
    this.updateInterval = updateInterval;
  }

  async loadModel(): Promise<void> {
    const modelData = dataStore.getHMMModel(this.modelId);
    if (!modelData) {
      throw new Error(`Model not found: ${this.modelId}`);
    }
    this.model = HMM.fromModel(modelData);
  }

  setCallback(callback: (result: StreamResult) => void): void {
    this.onResultCallback = callback;
  }

  addDataPoint(point: StreamMessage): StreamResult | null {
    this.window.add(point);

    if (this.window.isReady()) {
      return this.performDetection();
    }

    return null;
  }

  private performDetection(): StreamResult | null {
    if (!this.model) {
      throw new Error('Model not loaded');
    }

    const windowData = this.window.getWindow();
    if (windowData.length === 0) return null;

    const windowStart = this.window.getStartTime() || windowData[0].timestamp;
    const windowEnd = this.window.getEndTime() || windowData[windowData.length - 1].timestamp;

    const assetScores: Record<string, number> = {};
    let maxAnomalyScore = 0;
    let isAnomaly = false;

    const assets = Array.from(new Set(windowData.map((p) => p.asset)));

    for (const asset of assets) {
      const assetData = windowData.filter((p) => p.asset === asset);
      if (assetData.length < 5) continue;

      const observations = this.prepareObservations(assetData);
      if (observations.length === 0) continue;

      const result = detectAnomalies(
        this.model.toModel(),
        observations,
        this.anomalyThreshold
      );

      const avgScore = result.anomalyScores.reduce((a, b) => a + b, 0) / result.anomalyScores.length;
      assetScores[asset] = avgScore;

      if (avgScore > maxAnomalyScore) {
        maxAnomalyScore = avgScore;
      }

      if (result.anomalies.some((a) => a)) {
        isAnomaly = true;
      }
    }

    const streamResult: StreamResult = {
      id: uuidv4(),
      timestamp: new Date().toISOString(),
      windowStart,
      windowEnd,
      isAnomaly,
      anomalyScore: maxAnomalyScore,
      assetScores,
    };

    this.detectionCount++;

    if (this.incrementalUpdate && this.detectionCount % this.updateInterval === 0) {
      this.updateModel(windowData);
    }

    this.window.slide();

    if (this.onResultCallback) {
      this.onResultCallback(streamResult);
    }

    return streamResult;
  }

  private prepareObservations(data: StreamMessage[]): number[][] {
    if (data.length === 0) return [];

    const featureKeys = Object.keys(data[0].values).sort();
    
    return data.map((point) => {
      const features: number[] = [];
      for (const key of featureKeys) {
        features.push(point.values[key] || 0);
      }
      return features;
    });
  }

  private updateModel(data: StreamMessage[]): void {
    if (!this.model || !this.incrementalUpdate) return;

    const observations = this.prepareObservations(data);
    if (observations.length < 10) return;

    const config = {
      nStates: (this.model as any).nStates || 3,
      learningRate: 0.01,
      anomalyThreshold: this.anomalyThreshold,
      maxIterations: 5,
      convergenceTolerance: 1e-3,
    };

    try {
      this.model.fitIncremental(observations, config);
      
      const updatedModel = this.model.toModel();
      updatedModel.id = this.modelId;
      dataStore.updateHMMModel(this.modelId, updatedModel);
    } catch (e) {
      console.error('Model update error:', e);
    }
  }

  getWindowData(): StreamMessage[] {
    return this.window.getWindow();
  }

  isReady(): boolean {
    return this.window.isReady();
  }

  getDetectionCount(): number {
    return this.detectionCount;
  }

  clearWindow(): void {
    this.window.clear();
  }
}

class ResultRingBuffer {
  private buffer: StreamResult[];
  private maxSize: number;
  private index: number;

  constructor(maxSize: number = 1000) {
    this.buffer = [];
    this.maxSize = maxSize;
    this.index = 0;
  }

  add(result: StreamResult): void {
    if (this.buffer.length < this.maxSize) {
      this.buffer.push(result);
    } else {
      this.buffer[this.index] = result;
      this.index = (this.index + 1) % this.maxSize;
    }
  }

  getRecent(n: number): StreamResult[] {
    const count = Math.min(n, this.buffer.length);
    const result: StreamResult[] = [];

    for (let i = 0; i < count; i++) {
      const idx = (this.index - i - 1 + this.buffer.length) % this.buffer.length;
      if (this.buffer[idx]) {
        result.push(this.buffer[idx]);
      }
    }

    return result;
  }

  getAll(): StreamResult[] {
    return this.getRecent(this.buffer.length);
  }

  size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
    this.index = 0;
  }
}

const activeStreams = new Map<string, StreamInstance>();
const streamResultBuffers = new Map<string, ResultRingBuffer>();
const STREAM_TIMEOUT_MS = 30 * 60 * 1000;

function createKafkaInstance(config: KafkaConfig): Kafka {
  const brokers = config.brokers.split(',').map((b) => b.trim());

  const kafkaConfig: any = {
    brokers,
    clientId: config.clientId || 'anomaly-detector',
  };

  if (config.ssl) {
    kafkaConfig.ssl = true;
  }

  if (config.saslMechanism && config.saslUsername && config.saslPassword) {
    kafkaConfig.sasl = {
      mechanism: config.saslMechanism as any,
      username: config.saslUsername,
      password: config.saslPassword,
    };
  }

  return new Kafka(kafkaConfig);
}

export function createKafkaConsumer(config: KafkaConfig): Consumer {
  const kafka = createKafkaInstance(config);
  
  return kafka.consumer({
    groupId: config.groupId || 'anomaly-detector-group',
  });
}

export function createKafkaProducer(config: KafkaConfig): Producer {
  const kafka = createKafkaInstance(config);
  return kafka.producer();
}

export async function subscribeToTopic(consumer: Consumer, topic: string): Promise<void> {
  await consumer.subscribe({ topic, fromBeginning: false });
}

async function sendToKafka(producer: Producer, topic: string, result: StreamResult): Promise<void> {
  try {
    await producer.send({
      topic,
      messages: [
        {
          key: result.id,
          value: JSON.stringify(result),
        },
      ],
    });
  } catch (e) {
    console.error('Failed to send to Kafka:', e);
  }
}

async function sendToWebhook(url: string, result: StreamResult): Promise<void> {
  try {
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(result),
    });
  } catch (e) {
    console.error('Failed to send to webhook:', e);
  }
}

function logResult(result: StreamResult): void {
  const level = result.isAnomaly ? 'WARN' : 'INFO';
  console.log(`[${level}] Stream result - ID: ${result.id}, Anomaly: ${result.isAnomaly}, Score: ${result.anomalyScore.toFixed(4)}`);
}

async function processStreamResult(
  result: StreamResult,
  streamId: string,
  instance: StreamInstance
): Promise<void> {
  const buffer = streamResultBuffers.get(streamId);
  if (buffer) {
    buffer.add(result);
  }

  instance.status.resultCount++;
  instance.status.lastDetectionTime = result.timestamp;

  const { outputConfig } = instance;

  if (outputConfig.kafkaTopic && instance.producer) {
    await sendToKafka(instance.producer, outputConfig.kafkaTopic, result);
  }

  if (outputConfig.webhookUrl) {
    await sendToWebhook(outputConfig.webhookUrl, result);
  }

  if (outputConfig.logToConsole) {
    logResult(result);
  }
}

export async function startStreamProcessing(
  kafkaConfig: KafkaConfig,
  streamConfig: StreamConfig,
  outputConfig: OutputConfig = { logToConsole: true }
): Promise<string> {
  const streamId = uuidv4();

  try {
    const detector = new StreamDetector(
      streamConfig.modelId,
      streamConfig.windowSize,
      Math.floor(streamConfig.windowSize / 2),
      streamConfig.anomalyThreshold,
      false,
      true,
      10
    );

    await detector.loadModel();

    const consumer = createKafkaConsumer(kafkaConfig);
    await subscribeToTopic(consumer, kafkaConfig.topic);

    let producer: Producer | undefined;
    if (outputConfig.kafkaTopic) {
      producer = createKafkaProducer(kafkaConfig);
      await producer.connect();
    }

    const instance: StreamInstance = {
      detector,
      consumer,
      producer,
      kafkaConfig,
      streamConfig,
      outputConfig,
      status: {
        streamId,
        status: 'running',
        messageCount: 0,
        resultCount: 0,
        windowCount: 0,
        lastMessageTime: null,
        lastDetectionTime: null,
        error: null,
        createdAt: new Date().toISOString(),
      },
    };

    activeStreams.set(streamId, instance);
    streamResultBuffers.set(streamId, new ResultRingBuffer(1000));

    detector.setCallback((result) => {
      processStreamResult(result, streamId, instance);
    });

    await consumer.run({
      eachMessage: async (payload: EachMessagePayload) => {
        try {
          if (!payload.message.value) return;

          const message = JSON.parse(payload.message.value.toString()) as StreamMessage;
          
          instance.status.messageCount++;
          instance.status.lastMessageTime = new Date().toISOString();

          detector.addDataPoint(message);

          resetStreamTimeout(streamId);
        } catch (e) {
          console.error('Message processing error:', e);
        }
      },
    });

    setStreamTimeout(streamId);

    return streamId;
  } catch (e) {
    const error = e as Error;
    console.error('Stream start error:', error);

    const instance = activeStreams.get(streamId);
    if (instance) {
      instance.status.status = 'error';
      instance.status.error = error.message;
    }

    throw e;
  }
}

function setStreamTimeout(streamId: string): void {
  const instance = activeStreams.get(streamId);
  if (!instance) return;

  instance.timeoutTimer = setTimeout(() => {
    console.log(`Stream ${streamId} timed out due to inactivity`);
    stopStreamProcessing(streamId);
  }, STREAM_TIMEOUT_MS);
}

function resetStreamTimeout(streamId: string): void {
  const instance = activeStreams.get(streamId);
  if (!instance || !instance.timeoutTimer) return;

  clearTimeout(instance.timeoutTimer);
  setStreamTimeout(streamId);
}

export async function stopStreamProcessing(streamId: string): Promise<boolean> {
  const instance = activeStreams.get(streamId);
  if (!instance) return false;

  try {
    if (instance.timeoutTimer) {
      clearTimeout(instance.timeoutTimer);
    }

    await instance.consumer.disconnect();
    
    if (instance.producer) {
      await instance.producer.disconnect();
    }

    instance.status.status = 'stopped';
    
    return true;
  } catch (e) {
    console.error('Stream stop error:', e);
    instance.status.status = 'error';
    instance.status.error = (e as Error).message;
    return false;
  } finally {
    activeStreams.delete(streamId);
  }
}

export function getStreamStatus(streamId: string): StreamStatus | null {
  const instance = activeStreams.get(streamId);
  if (!instance) return null;

  return { ...instance.status };
}

export function getRecentResults(streamId: string, n: number): StreamResult[] {
  const buffer = streamResultBuffers.get(streamId);
  if (!buffer) return [];

  return buffer.getRecent(n);
}

export function getAllStreamStatuses(): StreamStatus[] {
  const statuses: StreamStatus[] = [];
  const instances = Array.from(activeStreams.values());
  for (const instance of instances) {
    statuses.push({ ...instance.status });
  }
  return statuses;
}

export async function stopAllStreams(): Promise<void> {
  const streamIds = Array.from(activeStreams.keys());
  for (const streamId of streamIds) {
    await stopStreamProcessing(streamId);
  }
}

export { SlidingWindow, StreamDetector, ResultRingBuffer };
export type { StreamStatus, OutputConfig };
