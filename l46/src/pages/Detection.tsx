import { useState, useMemo, useRef, useEffect } from 'react';
import { AlertTriangle, Play, Settings, Activity, TrendingDown, AlertCircle } from 'lucide-react';
import PlotlyChart from '@/components/PlotlyChart';
import { useAppStore } from '@/store/useAppStore';
import type { HMMModel, AnomalyResult, TrainingStatus } from '../../shared/types';

export default function Detection() {
  const {
    timeSeriesData, hmmConfig, setHmmConfig,
    hmmModel, setHmmModel, anomalyResult, setAnomalyResult,
    trainingStatus, setTrainingStatus, setLoading,
  } = useAppStore();

  const [selectedRange, setSelectedRange] = useState<[number, number] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current); }, []);

  const pollTrainingStatus = async (trainingId: string) => {
    pollTimerRef.current = setInterval(async () => {
      try {
        const response = await fetch(`/api/hmm/training/${trainingId}`);
        const result = await response.json();
        if (result.success && result.data) {
          const status = result.data as TrainingStatus;
          setTrainingStatus(status);
          if (status.status === 'completed' && status.result) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setHmmModel(status.result);
            await runDetection(status.result);
          } else if (status.status === 'error') {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
            setError(status.error || '训练失败');
            setTrainingStatus({ status: 'idle', message: '就绪', progress: 0 });
          }
        }
      } catch (err) {
        console.error('轮询训练状态失败:', err);
      }
    }, 1000);
  };

  const trainModel = async () => {
    if (!timeSeriesData) return;
    setError(null);
    try {
      setLoading(true, '开始训练HMM模型...');
      setTrainingStatus({ status: 'training', progress: 0, message: '初始化训练...' });
      const response = await fetch('/api/hmm/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dataId: timeSeriesData.id, config: hmmConfig, features: timeSeriesData.selectedFeatures }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '训练启动失败');
      setLoading(false);
      await pollTrainingStatus(result.trainingId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '训练失败');
      setTrainingStatus({ status: 'idle', message: '就绪', progress: 0 });
      setLoading(false);
    }
  };

  const runDetection = async (model: HMMModel) => {
    if (!timeSeriesData) return;
    try {
      setLoading(true, '执行异常检测...');
      const response = await fetch('/api/hmm/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ modelId: model.id, dataId: timeSeriesData.id, thresholdK: hmmConfig.anomalyThreshold, features: timeSeriesData.selectedFeatures }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '检测失败');
      setAnomalyResult(result.data as AnomalyResult);
      setTrainingStatus({ status: 'completed', message: '训练完成', progress: 100 });
    } catch (err) {
      setError(err instanceof Error ? err.message : '检测失败');
    } finally {
      setLoading(false);
    }
  };

  const handleSelected = (event: any) => {
    if (event?.points?.length > 1) {
      const indices = event.points.map((p: any) => p.pointIndex).sort((a: number, b: number) => a - b);
      setSelectedRange([indices[0], indices[indices.length - 1]]);
    }
  };

  const lossChartData = useMemo(() => {
    if (!hmmModel) return [];
    return [{ x: hmmModel.logLikelihoodHistory.map((_, i) => i), y: hmmModel.logLikelihoodHistory, type: 'scatter', mode: 'lines', name: 'Log Likelihood', line: { color: '#00f5d4', width: 2 } }];
  }, [hmmModel]);

  const detectionChartData = useMemo<{ traces: any[]; shapes: any[] } | null>(() => {
    if (!anomalyResult || !timeSeriesData) return null;
    const feature = timeSeriesData.features['close'] ? 'close' : timeSeriesData.selectedFeatures[0];
    const values = timeSeriesData.features[feature];
    const thresholdLine = anomalyResult.meanLogLikelihood - anomalyResult.threshold * anomalyResult.stdLogLikelihood;
    const anomalyShapes = anomalyResult.anomalies.reduce((acc: any[], a, i) => {
      if (a) {
        const last = acc[acc.length - 1];
        if (last && last.x1 === timeSeriesData.dates[i - 1]) last.x1 = timeSeriesData.dates[i];
        else acc.push({ type: 'rect', x0: timeSeriesData.dates[i], x1: timeSeriesData.dates[i], y0: 0, y1: 1, xref: 'x', yref: 'paper', fillcolor: 'rgba(245, 158, 11, 0.15)', line: { width: 0 } });
      }
      return acc;
    }, []);

    const predictionTraces: any[] = [];
    if (anomalyResult.predictedScores && anomalyResult.predictedScores.length > 0) {
      const lastIdx = timeSeriesData.dates.length - 1;
      const predDates = anomalyResult.predictedScores.map((_, i) =>
        `预测 +${i + 1}`
      );
      predictionTraces.push({
        x: predDates,
        y: anomalyResult.predictedScores,
        type: 'bar',
        name: '提前预测异常得分',
        marker: {
          color: anomalyResult.predictedAnomalies.map(p => p ? '#f59e0b' : '#00f5d4'),
          opacity: 0.7,
        },
      });
    }

    return {
      traces: [
        { x: timeSeriesData.dates, y: values, type: 'scatter', mode: 'lines', name: feature, line: { color: '#00f5d4', width: 1.5 } },
        { x: timeSeriesData.dates, y: anomalyResult.anomalies.map((a, i) => a ? values[i] : null), type: 'scatter', mode: 'markers', name: '异常点', marker: { color: '#f59e0b', size: 8, symbol: 'diamond' } },
        { x: timeSeriesData.dates, y: anomalyResult.logLikelihoods, type: 'scatter', mode: 'lines', name: '对数似然', line: { color: '#8b5cf6', width: 1.5 }, yaxis: 'y2' },
        { x: timeSeriesData.dates, y: Array(timeSeriesData.dates.length).fill(thresholdLine), type: 'scatter', mode: 'lines', name: '阈值线', line: { color: '#f59e0b', width: 1, dash: 'dash' }, yaxis: 'y2' },
        ...predictionTraces,
      ],
      shapes: anomalyShapes,
    };
  }, [anomalyResult, timeSeriesData]);

  const anomalyStats = useMemo(() => {
    if (!anomalyResult) return null;
    const count = anomalyResult.anomalies.filter((a) => a).length;
    return { count, ratio: (count / anomalyResult.anomalies.length) * 100, maxScore: Math.max(...anomalyResult.anomalyScores) };
  }, [anomalyResult]);

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-text-primary mb-6 flex items-center gap-3">
        <AlertTriangle className="w-8 h-8 text-anomaly" /> <span className="gradient-text">模型训练与异常检测</span>
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
            <Settings className="w-5 h-5 text-accent" /> HMM参数配置
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">隐藏状态数: <span className="data-text text-accent">{hmmConfig.nStates}</span></label>
              <input type="range" min="2" max="10" value={hmmConfig.nStates} onChange={(e) => setHmmConfig({ nStates: parseInt(e.target.value) })} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">学习率</label>
              <input type="number" step="0.001" min="0.001" max="0.1" value={hmmConfig.learningRate} onChange={(e) => setHmmConfig({ learningRate: parseFloat(e.target.value) })} className="input data-text" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">最大迭代次数</label>
              <input type="number" min="10" max="500" value={hmmConfig.maxIterations} onChange={(e) => setHmmConfig({ maxIterations: parseInt(e.target.value) })} className="input data-text" />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">收敛容差</label>
              <input type="number" step="1e-7" min="1e-8" value={hmmConfig.convergenceTolerance} onChange={(e) => setHmmConfig({ convergenceTolerance: parseFloat(e.target.value) })} className="input data-text" />
            </div>
            <button onClick={trainModel} disabled={!timeSeriesData || trainingStatus.status === 'training'} className="w-full flex items-center justify-center gap-2 px-4 py-3 btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              <Play className="w-5 h-5" />
              {trainingStatus.status === 'training' ? '训练中...' : '开始训练'}
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {trainingStatus.status !== 'idle' && (
            <div className="card p-6">
              <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-accent" /> 训练进度
              </h3>
              <div className="mb-2 flex justify-between text-sm">
                <span className="text-text-secondary">{trainingStatus.message}</span>
                <span className="data-text text-accent">{trainingStatus.progress.toFixed(0)}%</span>
              </div>
              <div className="w-full h-3 bg-border rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-accent-dark to-accent transition-all duration-300 shadow-glow-cyan" style={{ width: `${trainingStatus.progress}%` }} />
              </div>
            </div>
          )}
          {hmmModel && (
            <div className="card p-6">
              <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                <TrendingDown className="w-5 h-5 text-accent" /> 损失收敛曲线
              </h3>
              <PlotlyChart data={lossChartData} layout={{ title: 'Log Likelihood 收敛过程', xaxis: { title: '迭代次数' }, yaxis: { title: 'Log Likelihood' } }} height={300} />
            </div>
          )}
        </div>
      </div>

      {anomalyResult && anomalyStats && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="card p-6 text-center">
              <p className="text-3xl font-bold text-anomaly data-text">{anomalyStats.count}</p>
              <p className="text-text-muted text-sm mt-1">异常数量</p>
            </div>
            <div className="card p-6 text-center">
              <p className="text-3xl font-bold text-anomaly data-text">{anomalyStats.ratio.toFixed(2)}%</p>
              <p className="text-text-muted text-sm mt-1">异常占比</p>
            </div>
            <div className="card p-6 text-center">
              <p className="text-3xl font-bold text-accent data-text">{anomalyStats.maxScore.toFixed(2)}</p>
              <p className="text-text-muted text-sm mt-1">最大异常得分</p>
            </div>
            <div className="card p-6 text-center">
              <p className="text-3xl font-bold data-text" style={{ color: anomalyResult.predictedAnomalies?.some(p => p) ? '#f59e0b' : '#00f5d4' }}>
                {anomalyResult.predictedAnomalies?.filter(p => p).length || 0}/3
              </p>
              <p className="text-text-muted text-sm mt-1">提前3步预测异常</p>
            </div>
          </div>

          {selectedRange && (
            <div className="mb-6 p-3 bg-accent-glow text-accent rounded-lg text-sm data-text border border-accent/20">
              选中区间 [{selectedRange[0]}, {selectedRange[1]}]
            </div>
          )}

          {detectionChartData && (
          <div className="card p-6">
            <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-anomaly" /> 检测结果
            </h3>
            <PlotlyChart data={detectionChartData.traces} layout={{ title: '异常检测结果', xaxis: { title: '时间' }, yaxis: { title: '值' }, yaxis2: { title: '对数似然', overlaying: 'y', side: 'right' }, showlegend: true, dragmode: 'select', shapes: detectionChartData.shapes }} config={{ modeBarButtonsToAdd: ['select2d'] }} onSelected={handleSelected} height={400} />
          </div>
          )}
        </>
      )}
    </div>
  );
}
