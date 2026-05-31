import { create } from 'zustand';
import type {
  TimeSeriesData,
  HMMConfig,
  HMMModel,
  AnomalyResult,
  SHAPResult,
  BacktestConfig,
  BacktestResult,
  TrainingStatus,
  MultiAssetConfig,
  MultiAssetModel,
  MultiAssetAnomalyResult,
  ReportConfig,
  ReportResult,
  StreamConfig,
  KafkaConfig,
  SQLRuleConfig,
  SQLRuleResult,
} from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';

type PageType = 'dashboard' | 'data' | 'anomaly' | 'rootcause' | 'backtest' | 'multiasset' | 'report' | 'stream' | 'sql';

interface AppState {
  timeSeriesData: TimeSeriesData | null;
  dataList: TimeSeriesData[];
  hmmConfig: HMMConfig;
  hmmModel: HMMModel | null;
  anomalyResult: AnomalyResult | null;
  shapResult: SHAPResult | null;
  backtestConfig: BacktestConfig;
  backtestResult: BacktestResult | null;
  trainingStatus: TrainingStatus;
  multiAssetConfig: MultiAssetConfig;
  multiAssetModel: MultiAssetModel | null;
  multiAssetResult: MultiAssetAnomalyResult | null;
  reportConfig: ReportConfig;
  reportResult: ReportResult | null;
  reportList: ReportResult[];
  kafkaConfig: KafkaConfig;
  streamConfig: StreamConfig;
  activeStreams: string[];
  sqlRuleConfig: SQLRuleConfig;
  sqlRuleResult: SQLRuleResult | null;
  sqlRuleList: SQLRuleResult[];
  currentPage: PageType;
  isLoading: boolean;
  sidebarCollapsed: boolean;
  loadingMessage: string;
  setTimeSeriesData: (data: TimeSeriesData | null) => void;
  addDataToList: (data: TimeSeriesData) => void;
  removeDataFromList: (id: string) => void;
  clearDataList: () => void;
  setHmmConfig: (config: Partial<HMMConfig>) => void;
  setHmmModel: (model: HMMModel | null) => void;
  setAnomalyResult: (result: AnomalyResult | null) => void;
  setShapResult: (result: SHAPResult | null) => void;
  setBacktestConfig: (config: Partial<BacktestConfig>) => void;
  setBacktestResult: (result: BacktestResult | null) => void;
  setTrainingStatus: (status: Partial<TrainingStatus>) => void;
  setMultiAssetConfig: (config: Partial<MultiAssetConfig>) => void;
  setMultiAssetModel: (model: MultiAssetModel | null) => void;
  setMultiAssetResult: (result: MultiAssetAnomalyResult | null) => void;
  setReportConfig: (config: Partial<ReportConfig>) => void;
  setReportResult: (result: ReportResult | null) => void;
  setReportList: (list: ReportResult[]) => void;
  addReportToList: (report: ReportResult) => void;
  setKafkaConfig: (config: Partial<KafkaConfig>) => void;
  setStreamConfig: (config: Partial<StreamConfig>) => void;
  setActiveStreams: (streams: string[]) => void;
  addActiveStream: (streamId: string) => void;
  removeActiveStream: (streamId: string) => void;
  setSqlRuleConfig: (config: Partial<SQLRuleConfig>) => void;
  setSqlRuleResult: (result: SQLRuleResult | null) => void;
  setSqlRuleList: (list: SQLRuleResult[]) => void;
  addSqlRuleToList: (rule: SQLRuleResult) => void;
  setCurrentPage: (page: PageType) => void;
  setLoading: (loading: boolean, message?: string) => void;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  resetAll: () => void;
}

const defaultHmmConfig: HMMConfig = {
  nStates: 3,
  learningRate: 0.01,
  anomalyThreshold: 2.0,
  maxIterations: 100,
  convergenceTolerance: 1e-6,
};

const defaultBacktestConfig: BacktestConfig = {
  windowSize: 100,
  stepSize: 50,
  trainRatio: 0.7,
  hmmConfig: defaultHmmConfig,
  anomalyThresholdK: 2.0,
};

const defaultTrainingStatus: TrainingStatus = {
  id: uuidv4(),
  status: 'idle',
  progress: 0,
  message: '就绪',
  currentIteration: 0,
  logLikelihood: 0,
};

const defaultMultiAssetConfig: MultiAssetConfig = {
  assets: [],
  copulaType: 'gaussian',
  hmmConfig: defaultHmmConfig,
  correlationWindow: 30,
};

const defaultReportConfig: ReportConfig = {
  format: 'word',
  includeCharts: true,
  includeSHAP: true,
  includeRawData: false,
  language: 'zh',
};

const defaultKafkaConfig: KafkaConfig = {
  brokers: 'localhost:9092',
  topic: 'market-data',
  groupId: 'hmm-anomaly-detector',
  clientId: 'hmm-client',
  ssl: false,
};

const defaultStreamConfig: StreamConfig = {
  modelId: '',
  windowSize: 60,
  slideInterval: 10,
  anomalyThreshold: 2.0,
};

const defaultSqlRuleConfig: SQLRuleConfig = {
  ruleName: 'hmm_anomaly_detection',
  ruleDescription: 'HMM-based anomaly detection rule',
  databaseType: 'postgres',
  thresholdK: 2.0,
  includeAssetFilter: false,
  timeColumn: 'timestamp',
  valueColumn: 'value',
};

export const useAppStore = create<AppState>((set) => ({
  timeSeriesData: null,
  dataList: [],
  hmmConfig: defaultHmmConfig,
  hmmModel: null,
  anomalyResult: null,
  shapResult: null,
  backtestConfig: defaultBacktestConfig,
  backtestResult: null,
  trainingStatus: defaultTrainingStatus,
  multiAssetConfig: defaultMultiAssetConfig,
  multiAssetModel: null,
  multiAssetResult: null,
  reportConfig: defaultReportConfig,
  reportResult: null,
  reportList: [],
  kafkaConfig: defaultKafkaConfig,
  streamConfig: defaultStreamConfig,
  activeStreams: [],
  sqlRuleConfig: defaultSqlRuleConfig,
  sqlRuleResult: null,
  sqlRuleList: [],
  currentPage: 'dashboard',
  isLoading: false,
  sidebarCollapsed: false,
  loadingMessage: '',

  setTimeSeriesData: (data) => set({ timeSeriesData: data }),
  addDataToList: (data) =>
    set((state) => ({
      dataList: [...state.dataList.filter((d) => d.id !== data.id), data],
    })),
  removeDataFromList: (id) =>
    set((state) => ({
      dataList: state.dataList.filter((d) => d.id !== id),
      timeSeriesData: state.timeSeriesData?.id === id ? null : state.timeSeriesData,
    })),
  clearDataList: () => set({ dataList: [], timeSeriesData: null }),
  setHmmConfig: (config) =>
    set((state) => ({ hmmConfig: { ...state.hmmConfig, ...config } })),
  setHmmModel: (model) => set({ hmmModel: model }),
  setAnomalyResult: (result) => set({ anomalyResult: result }),
  setShapResult: (result) => set({ shapResult: result }),
  setBacktestConfig: (config) =>
    set((state) => ({
      backtestConfig: { ...state.backtestConfig, ...config },
    })),
  setBacktestResult: (result) => set({ backtestResult: result }),
  setTrainingStatus: (status) =>
    set((state) => ({
      trainingStatus: { ...state.trainingStatus, ...status },
    })),
  setMultiAssetConfig: (config) =>
    set((state) => ({
      multiAssetConfig: { ...state.multiAssetConfig, ...config },
    })),
  setMultiAssetModel: (model) => set({ multiAssetModel: model }),
  setMultiAssetResult: (result) => set({ multiAssetResult: result }),
  setReportConfig: (config) =>
    set((state) => ({
      reportConfig: { ...state.reportConfig, ...config },
    })),
  setReportResult: (result) => set({ reportResult: result }),
  setReportList: (list) => set({ reportList: list }),
  addReportToList: (report) =>
    set((state) => ({
      reportList: [...state.reportList.filter((r) => r.id !== report.id), report],
    })),
  setKafkaConfig: (config) =>
    set((state) => ({
      kafkaConfig: { ...state.kafkaConfig, ...config },
    })),
  setStreamConfig: (config) =>
    set((state) => ({
      streamConfig: { ...state.streamConfig, ...config },
    })),
  setActiveStreams: (streams) => set({ activeStreams: streams }),
  addActiveStream: (streamId) =>
    set((state) => ({
      activeStreams: state.activeStreams.includes(streamId)
        ? state.activeStreams
        : [...state.activeStreams, streamId],
    })),
  removeActiveStream: (streamId) =>
    set((state) => ({
      activeStreams: state.activeStreams.filter((s) => s !== streamId),
    })),
  setSqlRuleConfig: (config) =>
    set((state) => ({
      sqlRuleConfig: { ...state.sqlRuleConfig, ...config },
    })),
  setSqlRuleResult: (result) => set({ sqlRuleResult: result }),
  setSqlRuleList: (list) => set({ sqlRuleList: list }),
  addSqlRuleToList: (rule) =>
    set((state) => ({
      sqlRuleList: [...state.sqlRuleList.filter((r) => r.id !== rule.id), rule],
    })),
  setCurrentPage: (page) => set({ currentPage: page }),
  setLoading: (loading, message = '') =>
    set({ isLoading: loading, loadingMessage: message }),
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  resetAll: () =>
    set({
      timeSeriesData: null,
      dataList: [],
      hmmModel: null,
      anomalyResult: null,
      shapResult: null,
      backtestResult: null,
      trainingStatus: defaultTrainingStatus,
      multiAssetModel: null,
      multiAssetResult: null,
      reportResult: null,
      activeStreams: [],
      sqlRuleResult: null,
      currentPage: 'dashboard',
    }),
}));

export type { PageType };
