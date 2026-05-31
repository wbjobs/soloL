import { v4 as uuidv4 } from 'uuid';
import type {
  TimeSeriesData,
  HMMModel,
  AnomalyResult,
  SHAPResult,
  BacktestResult,
  TrainingStatus,
  MultiAssetModel,
  MultiAssetAnomalyResult,
  ReportResult,
  SQLRuleResult
} from '../../shared/types.js';

interface CacheEntry<T> {
  value: T;
  lastAccessed: number;
}

class LRUCache<T> {
  private cache: Map<string, CacheEntry<T>>;
  private maxSize: number;

  constructor(maxSize: number = 100) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }

  private evictIfNeeded(): void {
    if (this.cache.size > this.maxSize) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;

      const entries = Array.from(this.cache.entries());
      for (let i = 0; i < entries.length; i++) {
        const [key, entry] = entries[i];
        if (entry.lastAccessed < oldestTime) {
          oldestTime = entry.lastAccessed;
          oldestKey = key;
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
  }

  set(id: string, value: T): void {
    this.cache.set(id, {
      value,
      lastAccessed: Date.now()
    });
    this.evictIfNeeded();
  }

  get(id: string): T | null {
    const entry = this.cache.get(id);
    if (!entry) return null;

    entry.lastAccessed = Date.now();
    return entry.value;
  }

  has(id: string): boolean {
    return this.cache.has(id);
  }

  delete(id: string): boolean {
    return this.cache.delete(id);
  }

  getAll(): T[] {
    const values: T[] = [];
    const entries = Array.from(this.cache.values());
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      entry.lastAccessed = Date.now();
      values.push(entry.value);
    }
    return values;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  getIds(): string[] {
    return Array.from(this.cache.keys());
  }

  update(id: string, updater: (value: T) => T): boolean {
    const entry = this.cache.get(id);
    if (!entry) return false;

    entry.value = updater(entry.value);
    entry.lastAccessed = Date.now();
    return true;
  }
}

class DataStore {
  private static instance: DataStore;
  private timeSeriesData: LRUCache<TimeSeriesData>;
  private hmmModels: LRUCache<HMMModel>;
  private anomalyResults: LRUCache<AnomalyResult>;
  private shapResults: LRUCache<SHAPResult>;
  private backtestResults: LRUCache<BacktestResult>;
  private trainingStatuses: LRUCache<TrainingStatus>;
  private multiAssetModels: LRUCache<MultiAssetModel>;
  private multiAssetAnomalyResults: LRUCache<MultiAssetAnomalyResult>;
  private reportResults: LRUCache<ReportResult>;
  private sqlRuleResults: LRUCache<SQLRuleResult>;

  private constructor() {
    this.timeSeriesData = new LRUCache<TimeSeriesData>(50);
    this.hmmModels = new LRUCache<HMMModel>(50);
    this.anomalyResults = new LRUCache<AnomalyResult>(100);
    this.shapResults = new LRUCache<SHAPResult>(50);
    this.backtestResults = new LRUCache<BacktestResult>(30);
    this.trainingStatuses = new LRUCache<TrainingStatus>(50);
    this.multiAssetModels = new LRUCache<MultiAssetModel>(30);
    this.multiAssetAnomalyResults = new LRUCache<MultiAssetAnomalyResult>(50);
    this.reportResults = new LRUCache<ReportResult>(50);
    this.sqlRuleResults = new LRUCache<SQLRuleResult>(50);
  }

  public static getInstance(): DataStore {
    if (!DataStore.instance) {
      DataStore.instance = new DataStore();
    }
    return DataStore.instance;
  }

  generateId(): string {
    return uuidv4();
  }

  public saveTimeSeriesData(data: TimeSeriesData): TimeSeriesData {
    this.timeSeriesData.set(data.id, data);
    return data;
  }

  public getTimeSeriesData(id: string): TimeSeriesData | null {
    return this.timeSeriesData.get(id);
  }

  public updateTimeSeriesData(id: string, data: Partial<TimeSeriesData>): boolean {
    return this.timeSeriesData.update(id, (existing) => ({ ...existing, ...data }));
  }

  public deleteTimeSeriesData(id: string): boolean {
    return this.timeSeriesData.delete(id);
  }

  public getAllTimeSeriesData(): TimeSeriesData[] {
    return this.timeSeriesData.getAll();
  }

  public hasTimeSeriesData(id: string): boolean {
    return this.timeSeriesData.has(id);
  }

  public saveHMMModel(model: HMMModel): HMMModel {
    this.hmmModels.set(model.id, model);
    return model;
  }

  public getHMMModel(id: string): HMMModel | null {
    return this.hmmModels.get(id);
  }

  public updateHMMModel(id: string, model: Partial<HMMModel>): boolean {
    return this.hmmModels.update(id, (existing) => ({ ...existing, ...model }));
  }

  public deleteHMMModel(id: string): boolean {
    return this.hmmModels.delete(id);
  }

  public getAllHMMModels(): HMMModel[] {
    return this.hmmModels.getAll();
  }

  public hasHMMModel(id: string): boolean {
    return this.hmmModels.has(id);
  }

  public saveAnomalyResult(result: AnomalyResult): AnomalyResult {
    this.anomalyResults.set(result.id, result);
    return result;
  }

  public getAnomalyResult(id: string): AnomalyResult | null {
    return this.anomalyResults.get(id);
  }

  public updateAnomalyResult(id: string, result: Partial<AnomalyResult>): boolean {
    return this.anomalyResults.update(id, (existing) => ({ ...existing, ...result }));
  }

  public deleteAnomalyResult(id: string): boolean {
    return this.anomalyResults.delete(id);
  }

  public getAllAnomalyResults(): AnomalyResult[] {
    return this.anomalyResults.getAll();
  }

  public hasAnomalyResult(id: string): boolean {
    return this.anomalyResults.has(id);
  }

  public getAnomalyResultsByDataId(dataId: string): AnomalyResult[] {
    return this.anomalyResults.getAll().filter(r => r.dataId === dataId);
  }

  public getAnomalyResultsByModelId(modelId: string): AnomalyResult[] {
    return this.anomalyResults.getAll().filter(r => r.modelId === modelId);
  }

  public saveSHAPResult(result: SHAPResult): SHAPResult {
    this.shapResults.set(result.id, result);
    return result;
  }

  public getSHAPResult(id: string): SHAPResult | null {
    return this.shapResults.get(id);
  }

  public updateSHAPResult(id: string, result: Partial<SHAPResult>): boolean {
    return this.shapResults.update(id, (existing) => ({ ...existing, ...result }));
  }

  public deleteSHAPResult(id: string): boolean {
    return this.shapResults.delete(id);
  }

  public getAllSHAPResults(): SHAPResult[] {
    return this.shapResults.getAll();
  }

  public hasSHAPResult(id: string): boolean {
    return this.shapResults.has(id);
  }

  public getSHAPResultsByAnomalyResultId(anomalyResultId: string): SHAPResult[] {
    return this.shapResults.getAll().filter(r => r.anomalyResultId === anomalyResultId);
  }

  public saveBacktestResult(result: BacktestResult): BacktestResult {
    this.backtestResults.set(result.id, result);
    return result;
  }

  public getBacktestResult(id: string): BacktestResult | null {
    return this.backtestResults.get(id);
  }

  public updateBacktestResult(id: string, result: Partial<BacktestResult>): boolean {
    return this.backtestResults.update(id, (existing) => ({ ...existing, ...result }));
  }

  public deleteBacktestResult(id: string): boolean {
    return this.backtestResults.delete(id);
  }

  public getAllBacktestResults(): BacktestResult[] {
    return this.backtestResults.getAll();
  }

  public hasBacktestResult(id: string): boolean {
    return this.backtestResults.has(id);
  }

  public getBacktestResultsByDataId(dataId: string): BacktestResult[] {
    return this.backtestResults.getAll().filter(r => r.dataId === dataId);
  }

  public saveMultiAssetModel(model: MultiAssetModel): MultiAssetModel {
    this.multiAssetModels.set(model.id, model);
    return model;
  }

  public getMultiAssetModel(id: string): MultiAssetModel | null {
    return this.multiAssetModels.get(id);
  }

  public updateMultiAssetModel(id: string, model: Partial<MultiAssetModel>): boolean {
    return this.multiAssetModels.update(id, (existing) => ({ ...existing, ...model }));
  }

  public deleteMultiAssetModel(id: string): boolean {
    return this.multiAssetModels.delete(id);
  }

  public getAllMultiAssetModels(): MultiAssetModel[] {
    return this.multiAssetModels.getAll();
  }

  public saveMultiAssetAnomalyResult(result: MultiAssetAnomalyResult): MultiAssetAnomalyResult {
    this.multiAssetAnomalyResults.set(result.id, result);
    return result;
  }

  public getMultiAssetAnomalyResult(id: string): MultiAssetAnomalyResult | null {
    return this.multiAssetAnomalyResults.get(id);
  }

  public updateMultiAssetAnomalyResult(id: string, result: Partial<MultiAssetAnomalyResult>): boolean {
    return this.multiAssetAnomalyResults.update(id, (existing) => ({ ...existing, ...result }));
  }

  public deleteMultiAssetAnomalyResult(id: string): boolean {
    return this.multiAssetAnomalyResults.delete(id);
  }

  public getAllMultiAssetAnomalyResults(): MultiAssetAnomalyResult[] {
    return this.multiAssetAnomalyResults.getAll();
  }

  public saveReportResult(result: ReportResult): ReportResult {
    this.reportResults.set(result.id, result);
    return result;
  }

  public getReportResult(id: string): ReportResult | null {
    return this.reportResults.get(id);
  }

  public updateReportResult(id: string, result: Partial<ReportResult>): boolean {
    return this.reportResults.update(id, (existing) => ({ ...existing, ...result }));
  }

  public deleteReportResult(id: string): boolean {
    return this.reportResults.delete(id);
  }

  public getAllReportResults(): ReportResult[] {
    return this.reportResults.getAll();
  }

  public saveSQLRuleResult(result: SQLRuleResult): SQLRuleResult {
    this.sqlRuleResults.set(result.id, result);
    return result;
  }

  public getSQLRuleResult(id: string): SQLRuleResult | null {
    return this.sqlRuleResults.get(id);
  }

  public updateSQLRuleResult(id: string, result: Partial<SQLRuleResult>): boolean {
    return this.sqlRuleResults.update(id, (existing) => ({ ...existing, ...result }));
  }

  public deleteSQLRuleResult(id: string): boolean {
    return this.sqlRuleResults.delete(id);
  }

  public getAllSQLRuleResults(): SQLRuleResult[] {
    return this.sqlRuleResults.getAll();
  }

  public getStats(): {
    timeSeriesData: number;
    hmmModels: number;
    anomalyResults: number;
    shapResults: number;
    backtestResults: number;
    multiAssetModels: number;
    multiAssetAnomalyResults: number;
    reportResults: number;
    sqlRuleResults: number;
  } {
    return {
      timeSeriesData: this.timeSeriesData.size(),
      hmmModels: this.hmmModels.size(),
      anomalyResults: this.anomalyResults.size(),
      shapResults: this.shapResults.size(),
      backtestResults: this.backtestResults.size(),
      multiAssetModels: this.multiAssetModels.size(),
      multiAssetAnomalyResults: this.multiAssetAnomalyResults.size(),
      reportResults: this.reportResults.size(),
      sqlRuleResults: this.sqlRuleResults.size()
    };
  }

  public saveTrainingStatus(status: TrainingStatus): TrainingStatus {
    this.trainingStatuses.set(status.id, status);
    return status;
  }

  public getTrainingStatus(id: string): TrainingStatus | null {
    return this.trainingStatuses.get(id);
  }

  public updateTrainingStatus(id: string, updates: Partial<TrainingStatus>): boolean {
    return this.trainingStatuses.update(id, (existing) => ({ ...existing, ...updates }));
  }

  public getAllTrainingStatuses(): TrainingStatus[] {
    return this.trainingStatuses.getAll();
  }

  public deleteTrainingStatus(id: string): boolean {
    return this.trainingStatuses.delete(id);
  }

  public clearAll(): void {
    this.timeSeriesData.clear();
    this.hmmModels.clear();
    this.anomalyResults.clear();
    this.shapResults.clear();
    this.backtestResults.clear();
    this.trainingStatuses.clear();
    this.multiAssetModels.clear();
    this.multiAssetAnomalyResults.clear();
    this.reportResults.clear();
    this.sqlRuleResults.clear();
  }
}

export const dataStore = DataStore.getInstance();

export { LRUCache };
export default dataStore;
