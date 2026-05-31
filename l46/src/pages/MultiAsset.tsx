import { useState, useMemo } from 'react';
import { LineChart, BarChart3, Play, Search, Settings, TrendingUp, AlertCircle } from 'lucide-react';
import PlotlyChart from '@/components/PlotlyChart';
import { useAppStore } from '@/store/useAppStore';

export default function MultiAsset() {
  const {
    dataList, multiAssetConfig, setMultiAssetConfig,
    multiAssetModel, setMultiAssetModel, multiAssetResult, setMultiAssetResult,
    setLoading,
  } = useAppStore();

  const [selectedAssets, setSelectedAssets] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const copulaTypes = [
    { value: 'gaussian' as const, label: 'Gaussian' },
    { value: 't' as const, label: 'Student t' },
    { value: 'clayton' as const, label: 'Clayton' },
    { value: 'gumbel' as const, label: 'Gumbel' },
    { value: 'frank' as const, label: 'Frank' },
  ];

  const handleAssetToggle = (assetId: string) => {
    setSelectedAssets((prev) =>
      prev.includes(assetId) ? prev.filter((a) => a !== assetId) : [...prev, assetId]
    );
    setMultiAssetConfig({ assets: selectedAssets });
  };

  const handleTrain = async () => {
    if (selectedAssets.length < 2) {
      setError('请至少选择2个资产');
      return;
    }
    setError(null);
    try {
      setLoading(true, '训练多资产模型...');
      const response = await fetch('http://localhost:3001/api/multiasset/train', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assetIds: selectedAssets,
          copulaType: multiAssetConfig.copulaType,
          correlationWindow: multiAssetConfig.correlationWindow,
          hmmConfig: multiAssetConfig.hmmConfig,
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '训练失败');
      setMultiAssetModel(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '训练失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDetect = async () => {
    if (!multiAssetModel) {
      setError('请先训练模型');
      return;
    }
    setError(null);
    try {
      setLoading(true, '执行相关性异常检测...');
      const response = await fetch('http://localhost:3001/api/multiasset/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modelId: multiAssetModel.id,
          assetIds: selectedAssets,
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '检测失败');
      setMultiAssetResult(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '检测失败');
    } finally {
      setLoading(false);
    }
  };

  const logLikelihoodChart = useMemo(() => {
    if (multiAssetResult?.jointLogLikelihoods) {
      return [{
        x: multiAssetResult.jointLogLikelihoods.map((_, i) => i),
        y: multiAssetResult.jointLogLikelihoods,
        type: 'scatter',
        mode: 'lines',
        name: '联合对数似然',
        line: { color: '#00f5d4', width: 2 },
      }];
    }
    return [];
  }, [multiAssetResult]);

  const correlationBreakdownChart = useMemo(() => {
    if (multiAssetResult?.correlationBreakdownScores) {
      return [{
        x: Object.keys(multiAssetResult.correlationBreakdownScores),
        y: Object.values(multiAssetResult.correlationBreakdownScores),
        type: 'bar',
        name: '相关性崩解得分',
        marker: { color: '#f59e0b' },
      }];
    }
    return [];
  }, [multiAssetResult]);

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-text-primary mb-6 flex items-center gap-3">
        <TrendingUp className="w-8 h-8 text-accent" /> <span className="gradient-text">多资产相关性异常检测</span>
      </h1>

      {error && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-1 card p-6">
          <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-accent" /> 配置参数
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-2">资产选择</label>
              <div className="max-h-40 overflow-y-auto space-y-2 border border-border rounded-lg p-2">
                {dataList.length === 0 ? (
                  <p className="text-text-muted text-sm">暂无数据</p>
                ) : (
                  dataList.map((data) => (
                    <label key={data.id} className="flex items-center gap-2 p-1">
                      <input
                        type="checkbox"
                        checked={selectedAssets.includes(data.id)}
                        onChange={() => handleAssetToggle(data.id)}
                        className="accent-accent"
                      />
                      <span className="text-sm text-text-primary">{data.name}</span>
                    </label>
                  ))
                )}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Copula类型</label>
              <select
                value={multiAssetConfig.copulaType}
                onChange={(e) => setMultiAssetConfig({ copulaType: e.target.value as any })}
                className="input"
              >
                {copulaTypes.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                相关窗口大小: <span className="data-text text-accent">{multiAssetConfig.correlationWindow}</span>
              </label>
              <input
                type="number"
                min="5"
                max="365"
                value={multiAssetConfig.correlationWindow}
                onChange={(e) => setMultiAssetConfig({ correlationWindow: parseInt(e.target.value) })}
                className="input data-text"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                HMM状态数: <span className="data-text text-accent">{multiAssetConfig.hmmConfig.nStates}</span>
              </label>
              <input
                type="range"
                min="2"
                max="8"
                value={multiAssetConfig.hmmConfig.nStates}
                onChange={(e) => setMultiAssetConfig({ hmmConfig: { ...multiAssetConfig.hmmConfig, nStates: parseInt(e.target.value) } })}
                className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                学习率: <span className="data-text text-accent">{multiAssetConfig.hmmConfig.learningRate}</span>
              </label>
              <input
                type="range"
                min="0.001"
                max="0.1"
                step="0.001"
                value={multiAssetConfig.hmmConfig.learningRate}
                onChange={(e) => setMultiAssetConfig({ hmmConfig: { ...multiAssetConfig.hmmConfig, learningRate: parseFloat(e.target.value) } })}
                className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
              />
            </div>
            <div className="flex gap-2">
              <button onClick={handleTrain} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 btn-primary">
                <Play className="w-4 h-4" /> 训练
              </button>
              <button onClick={handleDetect} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 btn-secondary">
                <Search className="w-4 h-4" /> 检测
              </button>
            </div>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          {multiAssetResult && (
            <>
              <div className="card p-6">
                <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <LineChart className="w-5 h-5 text-accent" /> 联合对数似然
                </h3>
                <PlotlyChart data={logLikelihoodChart} layout={{ title: '联合对数似然曲线' }} height={250} />
              </div>
              <div className="card p-6">
                <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-anomaly" /> 相关性崩解得分
                </h3>
                <PlotlyChart data={correlationBreakdownChart} layout={{ title: '相关性崩解得分' }} height={250} />
              </div>
              <div className="card p-6">
                <h3 className="font-semibold text-text-primary mb-4">驱动资产排名</h3>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-text-secondary text-sm">
                        <th className="text-left p-2">排名</th>
                        <th className="text-left p-2">资产</th>
                        <th className="text-right p-2">影响得分</th>
                      </tr>
                    </thead>
                    <tbody>
                      {multiAssetResult?.drivingAssets?.map((asset: any, i: number) => (
                        <tr key={asset.id} className="border-t border-border">
                          <td className="p-2 data-text">{i + 1}</td>
                          <td className="p-2 text-text-primary">{asset.name}</td>
                          <td className="p-2 text-right data-text text-anomaly">{asset.score.toFixed(4)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
