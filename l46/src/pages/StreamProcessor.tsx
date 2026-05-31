import { useState } from 'react';
import { Activity, Play, Square, Settings, Database, AlertTriangle, Globe } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export default function StreamProcessor() {
  const {
    kafkaConfig, setKafkaConfig, streamConfig, setStreamConfig,
    activeStreams, addActiveStream, removeActiveStream, hmmModel, setLoading,
  } = useAppStore();

  const [error, setError] = useState<string | null>(null);
  const [outputKafkaTopic, setOutputKafkaTopic] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [processCount] = useState(0);
  const [anomalyCount] = useState(0);

  const recentResults = [
    { time: '10:45:23', asset: 'BTC', value: 42567.89, score: 2.34, isAnomaly: false },
    { time: '10:45:13', asset: 'ETH', value: 2234.56, score: 3.12, isAnomaly: true },
    { time: '10:45:03', asset: 'BTC', value: 42512.34, score: 1.89, isAnomaly: false },
    { time: '10:44:53', asset: 'SOL', value: 98.45, score: 2.56, isAnomaly: false },
  ];

  const handleStartStream = async () => {
    if (!streamConfig.modelId) {
      setError('请选择已训练的模型');
      return;
    }
    setError(null);
    try {
      setLoading(true, '启动流处理...');
      const response = await fetch('http://localhost:3001/api/stream/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kafkaConfig, streamConfig, output: { kafkaTopic: outputKafkaTopic, webhookUrl } }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '启动失败');
      addActiveStream(result.streamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '启动失败');
    } finally {
      setLoading(false);
    }
  };

  const handleStopStream = async (streamId: string) => {
    try {
      setLoading(true, '停止流处理...');
      const response = await fetch('http://localhost:3001/api/stream/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '停止失败');
      removeActiveStream(streamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : '停止失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-text-primary mb-6 flex items-center gap-3">
        <Activity className="w-8 h-8 text-accent" /> <span className="gradient-text">实时流处理</span>
      </h1>

      {error && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertTriangle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-1 space-y-6">
          <div className="card p-6">
            <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Database className="w-5 h-5 text-accent" /> Kafka配置
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Brokers</label>
                <input type="text" value={kafkaConfig.brokers} onChange={(e) => setKafkaConfig({ brokers: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Topic</label>
                <input type="text" value={kafkaConfig.topic} onChange={(e) => setKafkaConfig({ topic: e.target.value })} className="input" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Group ID</label>
                <input type="text" value={kafkaConfig.groupId} onChange={(e) => setKafkaConfig({ groupId: e.target.value })} className="input" />
              </div>
              <label className="flex items-center gap-2 pt-1">
                <input type="checkbox" checked={kafkaConfig.ssl} onChange={(e) => setKafkaConfig({ ssl: e.target.checked })} className="accent-accent" />
                <span className="text-sm text-text-primary">启用SSL</span>
              </label>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-accent" /> 流处理配置
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">已训练模型</label>
                <select value={streamConfig.modelId} onChange={(e) => setStreamConfig({ modelId: e.target.value })} className="input">
                  <option value="">请选择模型</option>
                  {hmmModel && <option value={hmmModel.id}>HMM Model - {hmmModel.id}</option>}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">窗口大小</label>
                  <input type="number" min="10" max="300" value={streamConfig.windowSize} onChange={(e) => setStreamConfig({ windowSize: parseInt(e.target.value) })} className="input data-text" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">滑动间隔(秒)</label>
                  <input type="number" min="1" max="60" value={streamConfig.slideInterval} onChange={(e) => setStreamConfig({ slideInterval: parseInt(e.target.value) })} className="input data-text" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  异常阈值K: <span className="data-text text-accent">{streamConfig.anomalyThreshold}</span>
                </label>
                <input type="range" min="1" max="4" step="0.1" value={streamConfig.anomalyThreshold} onChange={(e) => setStreamConfig({ anomalyThreshold: parseFloat(e.target.value) })} className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent" />
              </div>
            </div>
          </div>

          <div className="card p-6">
            <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Globe className="w-5 h-5 text-accent" /> 输出配置
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">输出Kafka Topic</label>
                <input type="text" value={outputKafkaTopic} onChange={(e) => setOutputKafkaTopic(e.target.value)} className="input" placeholder="anomaly-alerts" />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Webhook URL</label>
                <input type="text" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} className="input" placeholder="https://..." />
              </div>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={handleStartStream} disabled={activeStreams.length > 0} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
              <Play className="w-5 h-5" /> 启动流
            </button>
            <button onClick={() => activeStreams.forEach(handleStopStream)} disabled={activeStreams.length === 0} className="flex-1 flex items-center justify-center gap-2 px-4 py-3 btn-secondary disabled:opacity-50 disabled:cursor-not-allowed">
              <Square className="w-5 h-5" /> 停止流
            </button>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-3 gap-4">
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-accent data-text">{activeStreams.length}</p>
              <p className="text-text-muted text-sm">活跃流</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-text-primary data-text">{processCount}</p>
              <p className="text-text-muted text-sm">处理计数</p>
            </div>
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-anomaly data-text">{anomalyCount}</p>
              <p className="text-text-muted text-sm">异常计数</p>
            </div>
          </div>

          {activeStreams.length > 0 && (
            <div className="card p-6">
              <h3 className="font-semibold text-text-primary mb-4">活跃流列表</h3>
              <div className="space-y-2">
                {activeStreams.map((streamId) => (
                  <div key={streamId} className="flex items-center justify-between p-3 bg-accent/5 rounded-lg border border-accent/20">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                      <span className="text-text-primary text-sm data-text">{streamId}</span>
                    </div>
                    <button onClick={() => handleStopStream(streamId)} className="p-1 text-anomaly hover:bg-anomaly/10 rounded">
                      <Square className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card p-6">
            <h3 className="font-semibold text-text-primary mb-4">最近检测结果</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-text-secondary text-sm">
                    <th className="text-left p-2">时间</th>
                    <th className="text-left p-2">资产</th>
                    <th className="text-right p-2">值</th>
                    <th className="text-right p-2">异常得分</th>
                    <th className="text-center p-2">状态</th>
                  </tr>
                </thead>
                <tbody>
                  {recentResults.map((r, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="p-2 text-text-muted text-sm data-text">{r.time}</td>
                      <td className="p-2 text-text-primary data-text">{r.asset}</td>
                      <td className="p-2 text-right data-text">{r.value.toFixed(2)}</td>
                      <td className="p-2 text-right data-text">{r.score.toFixed(2)}</td>
                      <td className="p-2 text-center">
                        <span className={`px-2 py-1 text-xs rounded ${r.isAnomaly ? 'bg-anomaly/10 text-anomaly' : 'bg-accent/10 text-accent'}`}>
                          {r.isAnomaly ? '异常' : '正常'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
