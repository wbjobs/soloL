import { useState, useMemo } from 'react';
import { Search, BarChart2, AlertCircle, ChevronDown, Info } from 'lucide-react';
import PlotlyChart from '@/components/PlotlyChart';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import type { SHAPResult } from '../../shared/types';

export default function RootCause() {
  const { anomalyResult, timeSeriesData, shapResult, setShapResult, hmmModel, setLoading } = useAppStore();
  const [selectedInterval, setSelectedInterval] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const anomalyIntervals = useMemo(() => {
    if (!anomalyResult) return [];
    const intervals: { start: number; end: number; startDate: string; endDate: string }[] = [];
    let inAnomaly = false, start = 0;
    for (let i = 0; i < anomalyResult.anomalies.length; i++) {
      if (anomalyResult.anomalies[i] && !inAnomaly) { inAnomaly = true; start = i; }
      else if (!anomalyResult.anomalies[i] && inAnomaly) {
        inAnomaly = false;
        intervals.push({ start, end: i - 1, startDate: anomalyResult.timestamps[start], endDate: anomalyResult.timestamps[i - 1] });
      }
    }
    if (inAnomaly) intervals.push({
      start, end: anomalyResult.anomalies.length - 1,
      startDate: anomalyResult.timestamps[start], endDate: anomalyResult.timestamps[anomalyResult.anomalies.length - 1],
    });
    return intervals;
  }, [anomalyResult]);

  const runSHAPAnalysis = async () => {
    if (!anomalyResult || !timeSeriesData || !hmmModel) return;
    setError(null);
    try {
      setLoading(true, '计算SHAP值...');
      const intervals = anomalyIntervals.map(({ start, end }) => ({ start, end }));
      const response = await fetch('/api/shap/compute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: hmmModel.id, dataId: timeSeriesData.id, anomalyResultId: anomalyResult.id, anomalyIntervals: intervals, featureNames: timeSeriesData.selectedFeatures, options: {} }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || 'SHAP计算失败');
      setShapResult(result.data as SHAPResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SHAP计算失败');
    } finally {
      setLoading(false);
    }
  };

  const sortedFeatures = useMemo(() => {
    if (!shapResult) return [];
    return Object.entries(shapResult.meanAbsShap)
      .sort((a, b) => (b[1] as number) - (a[1] as number))
      .map(([name, value]) => ({ name, value: value as number }));
  }, [shapResult]);

  const shapBarData = useMemo(() => {
    if (!sortedFeatures.length) return [];
    return [{
      x: sortedFeatures.map((f) => f.value),
      y: sortedFeatures.map((f) => f.name),
      type: 'bar', orientation: 'h',
      marker: { color: sortedFeatures.map((f) => f.value > 0 ? '#00f5d4' : '#f59e0b') },
      name: 'SHAP重要性',
    }];
  }, [sortedFeatures]);

  const waterfallData = useMemo(() => {
    if (!shapResult || !sortedFeatures.length) return [];
    const interval = shapResult.anomalyIntervals[selectedInterval];
    if (!interval) return [];
    const mid = Math.floor((interval.start + interval.end) / 2);
    const values = sortedFeatures.map((f) => shapResult.shapValues[f.name][mid]);
    const measure: string[] = ['absolute'];
    const y: number[] = [shapResult.baseValue];
    const x: string[] = ['基准值'];
    sortedFeatures.forEach((f, i) => { measure.push('relative'); y.push(values[i]); x.push(f.name); });
    measure.push('total');
    y.push(values.reduce((a, b) => a + b, 0) + shapResult.baseValue);
    x.push('最终预测');
    return [{
      x, y, measure, type: 'waterfall',
      decreasing: { marker: { color: '#f59e0b' } },
      increasing: { marker: { color: '#00f5d4' } },
      totals: { marker: { color: '#8b5cf6' } },
      name: 'SHAP贡献',
    }];
  }, [shapResult, selectedInterval, sortedFeatures]);

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-text-primary mb-6 flex items-center gap-3">
        <Search className="w-8 h-8 text-accent" /> <span className="gradient-text">根因分析</span>
      </h1>

      {error && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}
      {!anomalyResult && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertCircle className="w-5 h-5 shrink-0" /> 请先在异常检测页面运行检测
        </div>
      )}

      {anomalyResult && (
        <>
          <div className="card p-6 mb-6">
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex-1 min-w-64">
                <label className="block text-sm font-medium text-text-secondary mb-2">选择异常区间</label>
                <div className="relative">
                  <select value={selectedInterval} onChange={(e) => setSelectedInterval(parseInt(e.target.value))} className="input appearance-none cursor-pointer pr-10">
                    {anomalyIntervals.map((interval, i) => (
                      <option key={i} value={i}>区间 {i + 1}: {interval.startDate} ~ {interval.endDate} ({interval.end - interval.start + 1} 个点)</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted pointer-events-none" />
                </div>
              </div>
              <button onClick={runSHAPAnalysis} className="flex items-center gap-2 btn-primary mt-5">
                <Search className="w-4 h-4" /> 计算SHAP值
              </button>
            </div>
          </div>

          {shapResult && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
                <div className="card p-6">
                  <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <BarChart2 className="w-5 h-5 text-accent" /> SHAP特征重要性
                  </h3>
                  <PlotlyChart data={shapBarData} layout={{ title: '特征平均SHAP绝对值排序', xaxis: { title: '平均|SHAP值|' }, yaxis: { title: '特征' } }} height={350} />
                </div>
                <div className="card p-6">
                  <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                    <BarChart2 className="w-5 h-5 text-anomaly" /> 特征贡献瀑布图
                  </h3>
                  <PlotlyChart data={waterfallData} layout={{ title: `区间 ${selectedInterval + 1} 的特征贡献分解`, xaxis: { title: '特征' }, yaxis: { title: 'SHAP值' } }} height={350} />
                </div>
              </div>

              <div className="card p-6">
                <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <Info className="w-5 h-5 text-accent" /> 根因详情面板
                </h3>
                <div className="space-y-3">
                  {sortedFeatures.map((f, i) => (
                    <div key={f.name} className="p-4 bg-background-dark rounded-lg border border-border/50">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-3">
                          <span className={cn(
                            'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold',
                            i === 0 ? 'bg-accent/20 text-accent glow-text' : 'bg-anomaly/20 text-anomaly'
                          )}>{i + 1}</span>
                          <span className="font-medium text-text-primary data-text">{f.name}</span>
                        </div>
                        <span className="text-sm data-text" style={{ color: f.value > 0 ? '#00f5d4' : '#f59e0b' }}>
                          SHAP: {f.value.toFixed(4)}
                        </span>
                      </div>
                      <p className="text-sm text-text-muted mb-2">
                        {i === 0 ? '主要根因：该特征SHAP值贡献最大，建议重点关注变化趋势'
                          : i === 1 ? '次要因素：结合主要特征分析可更全面理解异常原因'
                          : '辅助因素：对本次异常有一定贡献，可作为辅助判断依据'}
                      </p>
                      <div className="w-full bg-border rounded-full h-1.5">
                        <div className={cn('h-1.5 rounded-full transition-all', i === 0 ? 'bg-accent' : 'bg-anomaly')} style={{ width: `${(f.value / (sortedFeatures[0]?.value || 1)) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
