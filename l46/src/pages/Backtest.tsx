import { useState, useMemo } from 'react';
import { BarChart3, Play, Settings, Target, TrendingUp, AlertCircle, Activity } from 'lucide-react';
import PlotlyChart from '@/components/PlotlyChart';
import { useAppStore } from '@/store/useAppStore';
import type { BacktestResult, BacktestWindowResult } from '../../shared/types';

export default function Backtest() {
  const { timeSeriesData, backtestConfig, setBacktestConfig, backtestResult, setBacktestResult, setLoading } = useAppStore();
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runBacktest = async () => {
    if (!timeSeriesData) return;
    setError(null);
    setIsRunning(true);
    try {
      setLoading(true, '执行回测...');
      const response = await fetch('/api/backtest/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataId: timeSeriesData.id, config: backtestConfig, featureNames: timeSeriesData.selectedFeatures }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '回测失败');
      setBacktestResult(result.data as BacktestResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : '回测失败');
    } finally {
      setIsRunning(false);
      setLoading(false);
    }
  };

  const metricsTrendData = useMemo(() => {
    if (!backtestResult) return [];
    const items: { key: keyof BacktestWindowResult; color: string; name: string }[] = [
      { key: 'accuracy', color: '#00f5d4', name: '准确率' },
      { key: 'precision', color: '#8b5cf6', name: '精确率' },
      { key: 'recall', color: '#f59e0b', name: '召回率' },
      { key: 'f1', color: '#ef4444', name: 'F1分数' },
    ];
    return items.map(({ key, color, name }) => ({
      x: backtestResult.windows.map((w) => w.windowIndex),
      y: backtestResult.windows.map((w) => w[key] as number),
      type: 'scatter', mode: 'lines+markers', name, line: { color, width: 2 },
    }));
  }, [backtestResult]);

  const gaugeItems = useMemo(() => {
    if (!backtestResult) return [];
    const m = backtestResult.overallMetrics;
    return [
      { label: '平均准确率', value: m.avgAccuracy, color: '#00f5d4' },
      { label: '精确率', value: m.avgPrecision, color: '#8b5cf6' },
      { label: '召回率', value: m.avgRecall, color: '#f59e0b' },
      { label: 'F1', value: m.avgF1, color: '#ef4444' },
    ];
  }, [backtestResult]);

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-text-primary mb-6 flex items-center gap-3">
        <BarChart3 className="w-8 h-8 text-accent" /> <span className="gradient-text">回测验证</span>
      </h1>

      {error && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}
      {!timeSeriesData && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertCircle className="w-5 h-5 shrink-0" /> 请先在数据管理页面加载数据
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-1 card p-6">
          <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-accent" /> 滑动窗口参数
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">窗口大小: <span className="data-text text-accent">{backtestConfig.windowSize}</span></label>
              <input type="range" min="50" max="500" step="10" value={backtestConfig.windowSize} onChange={(e) => setBacktestConfig({ windowSize: parseInt(e.target.value) })} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">步长: <span className="data-text text-accent">{backtestConfig.stepSize}</span></label>
              <input type="range" min="10" max="200" step="5" value={backtestConfig.stepSize} onChange={(e) => setBacktestConfig({ stepSize: parseInt(e.target.value) })} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">训练比例: <span className="data-text text-accent">{(backtestConfig.trainRatio * 100).toFixed(0)}%</span></label>
              <input type="range" min="0.5" max="0.9" step="0.05" value={backtestConfig.trainRatio} onChange={(e) => setBacktestConfig({ trainRatio: parseFloat(e.target.value) })} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent" />
            </div>
            <button onClick={runBacktest} disabled={!timeSeriesData || isRunning} className="w-full flex items-center justify-center gap-2 px-4 py-3 btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              {isRunning ? (
                <><div className="w-4 h-4 border-2 border-background border-t-transparent rounded-full animate-spin" /> 回测中...</>
              ) : (
                <><Play className="w-5 h-5" /> 执行回测</>
              )}
            </button>
          </div>
        </div>

        <div className="lg:col-span-2">
          {isRunning && (
            <div className="card p-6 mb-6">
              <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-accent animate-pulse-slow" /> 回测进度
              </h3>
              <div className="w-full h-3 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-accent-dark to-accent animate-pulse shadow-glow-cyan" style={{ width: '100%' }} />
              </div>
            </div>
          )}
          {backtestResult && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {gaugeItems.map((item) => (
                <div key={item.label} className="card p-6 text-center">
                  <p className="text-3xl font-bold data-text" style={{ color: item.color }}>
                    {(item.value * 100).toFixed(1)}%
                  </p>
                  <p className="text-text-muted text-sm mt-2">{item.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {backtestResult && (
        <>
          <div className="card p-6 mb-6">
            <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-accent" /> 各窗口指标趋势
            </h3>
            <PlotlyChart data={metricsTrendData} layout={{ title: '滑动窗口回测指标变化', xaxis: { title: '窗口索引' }, yaxis: { title: '分数', range: [0, 1] }, showlegend: true }} height={400} />
          </div>

          <div className="card p-6">
            <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Target className="w-5 h-5 text-accent" /> 详细结果表格
            </h3>
            <div className="overflow-x-auto max-h-96 overflow-y-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background-dark">
                  <tr>
                    {['窗口', '训练区间', '测试区间', '准确率', '精确率', '召回率', 'F1', '误报率'].map((h) => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-text-secondary border-b border-border whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>{backtestResult.windows.map((w) => (
                  <tr key={w.windowIndex} className="border-b border-border/50 hover:bg-background-dark/50">
                    <td className="px-3 py-2 text-text-secondary data-text">#{w.windowIndex + 1}</td>
                    <td className="px-3 py-2 text-text-muted data-text text-xs">{w.trainStart}-{w.trainEnd}</td>
                    <td className="px-3 py-2 text-text-muted data-text text-xs">{w.testStart}-{w.testEnd}</td>
                    <td className="px-3 py-2 text-accent data-text">{(w.accuracy * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 data-text" style={{ color: '#8b5cf6' }}>{(w.precision * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-anomaly data-text">{(w.recall * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 data-text" style={{ color: '#ef4444' }}>{(w.f1 * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2 text-text-muted data-text">{(w.falseAlarmRate * 100).toFixed(1)}%</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
