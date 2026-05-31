import { useState } from 'react';
import { Database, Eye, Download, Trash2, AlertCircle, Copy, Settings } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export default function SQLExporter() {
  const {
    sqlRuleConfig, setSqlRuleConfig, sqlRuleResult, setSqlRuleResult,
    sqlRuleList, setSqlRuleList, addSqlRuleToList, hmmModel, setLoading,
  } = useAppStore();

  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const databaseTypes = [
    { value: 'postgres', label: 'PostgreSQL' },
    { value: 'mysql', label: 'MySQL' },
    { value: 'bigquery', label: 'BigQuery' },
    { value: 'snowflake', label: 'Snowflake' },
  ];

  const sampleSQL = `WITH stats AS (
  SELECT 
    AVG(score) as mean_score,
    STDDEV(score) as std_score
  FROM market_data
  WHERE timestamp >= NOW() - INTERVAL '30 days'
)
SELECT 
  timestamp,
  asset,
  value,
  score,
  CASE WHEN score < (mean_score - ${sqlRuleConfig.thresholdK} * std_score) 
       THEN 'ANOMALY' ELSE 'NORMAL' END as status
FROM market_data, stats
ORDER BY timestamp DESC;`;

  const handlePreview = async () => {
    if (!sqlRuleConfig.ruleName) {
      setError('请输入规则名称');
      return;
    }
    setError(null);
    try {
      setLoading(true, '生成SQL预览...');
      const response = await fetch('http://localhost:3001/api/sql/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sqlRuleConfig),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '生成失败');
      setSqlRuleResult(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!sqlRuleConfig.ruleName) {
      setError('请输入规则名称');
      return;
    }
    setError(null);
    try {
      setLoading(true, '导出SQL规则...');
      const response = await fetch('http://localhost:3001/api/sql/export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sqlRuleConfig),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '导出失败');
      addSqlRuleToList(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(sqlRuleResult?.sql || sampleSQL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDelete = (ruleId: string) => {
    setSqlRuleList(sqlRuleList.filter((r) => r.id !== ruleId));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-text-primary mb-6 flex items-center gap-3">
        <Database className="w-8 h-8 text-accent" /> <span className="gradient-text">SQL规则导出</span>
      </h1>

      {error && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="space-y-6">
          <div className="card p-6">
            <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
              <Settings className="w-5 h-5 text-accent" /> 规则配置
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">HMM模型</label>
                <select
                  value={hmmModel?.id || ''}
                  className="input"
                  disabled
                >
                  <option value="">请选择模型</option>
                  {hmmModel && <option value={hmmModel.id}>HMM Model - {hmmModel.id}</option>}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">规则名称</label>
                <input
                  type="text"
                  value={sqlRuleConfig.ruleName}
                  onChange={(e) => setSqlRuleConfig({ ruleName: e.target.value })}
                  className="input"
                  placeholder="hmm_anomaly_detection"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">规则描述</label>
                <textarea
                  value={sqlRuleConfig.ruleDescription}
                  onChange={(e) => setSqlRuleConfig({ ruleDescription: e.target.value })}
                  className="input min-h-[60px] resize-none"
                  placeholder="描述此规则的用途..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">数据库类型</label>
                <select
                value={sqlRuleConfig.databaseType}
                onChange={(e) => setSqlRuleConfig({ databaseType: e.target.value as any })}
                className="input"
              >
                {databaseTypes.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">
                  阈值K: <span className="data-text text-accent">{sqlRuleConfig.thresholdK}</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="4"
                  step="0.1"
                  value={sqlRuleConfig.thresholdK}
                  onChange={(e) => setSqlRuleConfig({ thresholdK: parseFloat(e.target.value) })}
                  className="w-full h-2 bg-border rounded-lg appearance-none cursor-pointer accent-accent"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">时间列名</label>
                  <input
                    type="text"
                    value={sqlRuleConfig.timeColumn}
                    onChange={(e) => setSqlRuleConfig({ timeColumn: e.target.value })}
                    className="input"
                    placeholder="timestamp"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-1">值列名</label>
                  <input
                    type="text"
                    value={sqlRuleConfig.valueColumn}
                    onChange={(e) => setSqlRuleConfig({ valueColumn: e.target.value })}
                    className="input"
                    placeholder="value"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">资产列名 (可选)</label>
                <input
                  type="text"
                  value={sqlRuleConfig.assetColumn || ''}
                  onChange={(e) => setSqlRuleConfig({ assetColumn: e.target.value })}
                  className="input"
                  placeholder="asset"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-4">
              <button onClick={handlePreview} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 btn-secondary">
                <Eye className="w-4 h-4" /> 预览
              </button>
              <button onClick={handleExport} className="flex-1 flex items-center justify-center gap-2 px-4 py-2 btn-primary">
                <Download className="w-4 h-4" /> 导出
              </button>
            </div>
          </div>

          <div className="card p-6">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-text-primary">SQL预览</h3>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1 text-sm text-accent hover:text-accent/80"
              >
                <Copy className="w-4 h-4" /> {copied ? '已复制' : '复制'}
              </button>
            </div>
            <pre className="p-4 bg-surface rounded-lg text-sm text-text-primary overflow-x-auto font-mono max-h-60 overflow-y-auto">
              <code>{sqlRuleResult?.sql || sampleSQL}</code>
            </pre>
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-text-primary mb-4">已导出规则</h3>
          {sqlRuleList.length === 0 ? (
            <p className="text-text-muted text-center py-8">暂无导出的规则</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-text-secondary text-sm">
                    <th className="text-left p-2">规则名称</th>
                    <th className="text-left p-2">数据库</th>
                    <th className="text-left p-2">创建时间</th>
                    <th className="text-right p-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {sqlRuleList.map((rule) => (
                    <tr key={rule.id} className="border-t border-border">
                      <td className="p-2 text-text-primary text-sm">{rule.ruleName}</td>
                      <td className="p-2 text-sm data-text">{rule.databaseType}</td>
                      <td className="p-2 text-sm text-text-muted">{rule.createdAt}</td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => setSqlRuleResult(rule)}
                            className="p-1 text-accent hover:bg-accent/10 rounded"
                            title="查看"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(rule.id)}
                            className="p-1 text-anomaly hover:bg-anomaly/10 rounded"
                            title="删除"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
