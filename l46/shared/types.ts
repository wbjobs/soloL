export interface TimeSeriesData {
  id: string;
  name: string;
  dates: string[];
  features: Record<string, number[]>;
  selectedFeatures: string[];
  length: number;
}

export interface HMMConfig {
  nStates: number;
  learningRate: number;
  anomalyThreshold: number;
  maxIterations: number;
  convergenceTolerance: number;
}

export interface HMMModel {
  id: string;
  pi: number[];
  A: number[][];
  mu: number[][];
  sigma: number[][][];
  nFeatures: number;
  trainedAt: string;
  dataLength: number;
  isIncremental: boolean;
  logLikelihoodHistory: number[];
}

export interface AnomalyResult {
  id: string;
  timestamps: string[];
  logLikelihoods: number[];
  anomalyScores: number[];
  anomalies: boolean[];
  states: number[];
  threshold: number;
  meanLogLikelihood: number;
  stdLogLikelihood: number;
  predictedScores: number[];
  predictedAnomalies: boolean[];
  dataId: string;
  modelId: string;
}

export interface SHAPResult {
  id: string;
  featureNames: string[];
  shapValues: Record<string, number[]>;
  meanAbsShap: Record<string, number>;
  baseValue: number;
  anomalyIntervals: { start: number; end: number }[];
  intervalIndex: number;
  dataId: string;
  modelId: string;
  anomalyResultId: string;
}

export interface BacktestConfig {
  windowSize: number;
  stepSize: number;
  trainRatio: number;
  hmmConfig: HMMConfig;
  anomalyThresholdK: number;
}

export interface BacktestWindowResult {
  windowIndex: number;
  trainStart: number;
  trainEnd: number;
  testStart: number;
  testEnd: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  falseAlarmRate: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
}

export interface BacktestResult {
  id: string;
  windows: BacktestWindowResult[];
  overallMetrics: {
    avgAccuracy: number;
    avgPrecision: number;
    avgRecall: number;
    avgF1: number;
    avgFalseAlarmRate: number;
    stdAccuracy: number;
    stdPrecision: number;
    stdRecall: number;
    stdF1: number;
  };
  config: BacktestConfig;
  dataId: string;
  completedAt: string;
}

export interface TrainingStatus {
  id: string;
  status: 'idle' | 'training' | 'completed' | 'error';
  progress: number;
  message: string;
  currentIteration: number;
  logLikelihood: number;
  result?: HMMModel;
  error?: string;
}

export interface DataUploadResponse {
  success: boolean;
  data: TimeSeriesData;
  message?: string;
}

export interface MultiAssetConfig {
  assets: string[];
  copulaType: 'gaussian' | 't' | 'clayton' | 'gumbel' | 'frank';
  hmmConfig: HMMConfig;
  correlationWindow: number;
}

export interface CopulaParameters {
  type: string;
  rho?: number;
  df?: number;
  theta?: number;
  correlationMatrix?: number[][];
}

export interface MultiAssetModel {
  id: string;
  assetNames: string[];
  copulaParams: CopulaParameters;
  marginalModels: Record<string, HMMModel>;
  jointModel: HMMModel | null;
  trainedAt: string;
  dataLength: number;
}

export interface MultiAssetAnomalyResult {
  id: string;
  timestamps: string[];
  jointLogLikelihoods: number[];
  marginalLogLikelihoods: Record<string, number[]>;
  anomalyScores: number[];
  anomalies: boolean[];
  correlationBreakdownScores: Record<string, number>;
  drivingAssets: string[];
  threshold: number;
  dataId: string;
  modelId: string;
}

export interface ReportConfig {
  format: 'word' | 'pdf';
  includeCharts: boolean;
  includeSHAP: boolean;
  includeRawData: boolean;
  language: 'zh' | 'en';
}

export interface ReportResult {
  id: string;
  fileName: string;
  fileSize: number;
  createdAt: string;
  downloadUrl: string;
}

export interface KafkaConfig {
  brokers: string;
  topic: string;
  groupId: string;
  clientId: string;
  ssl: boolean;
  saslMechanism?: string;
  saslUsername?: string;
  saslPassword?: string;
}

export interface StreamConfig {
  modelId: string;
  windowSize: number;
  slideInterval: number;
  anomalyThreshold: number;
}

export interface StreamMessage {
  timestamp: string;
  asset: string;
  values: Record<string, number>;
}

export interface StreamResult {
  id: string;
  timestamp: string;
  windowStart: string;
  windowEnd: string;
  isAnomaly: boolean;
  anomalyScore: number;
  assetScores: Record<string, number>;
}

export interface SQLRuleConfig {
  ruleName: string;
  ruleDescription: string;
  databaseType: 'postgres' | 'mysql' | 'bigquery' | 'snowflake';
  thresholdK: number;
  includeAssetFilter: boolean;
  timeColumn: string;
  valueColumn: string;
  assetColumn?: string;
}

export interface SQLRuleResult {
  id: string;
  ruleName: string;
  sql: string;
  databaseType: string;
  threshold: number;
  stateTransitions: string[];
  createdAt: string;
}

