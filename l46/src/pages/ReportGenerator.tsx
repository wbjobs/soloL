import { useState } from 'react';
import { FileText, Download, Trash2, AlertCircle, Settings, Play } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';

export default function ReportGenerator() {
  const {
    reportConfig, setReportConfig, reportList, setReportList, addReportToList, setLoading,
  } = useAppStore();

  const [selectedResultId, setSelectedResultId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const anomalyResults = [
    { id: '1', name: 'BTC/USDT 异常检测结果 - 2024-01' },
    { id: '2', name: 'ETH/USDT 异常检测结果 - 2024-01' },
    { id: '3', name: '多资产相关性异常 - 2024-01' },
  ];

  const handleGenerate = async () => {
    if (!selectedResultId) {
      setError('请选择检测结果');
      return;
    }
    setError(null);
    setIsGenerating(true);
    try {
      setLoading(true, '正在生成报告...');
      const response = await fetch('http://localhost:3001/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resultId: selectedResultId,
          config: reportConfig,
        }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '生成失败');
      addReportToList(result.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '生成失败');
    } finally {
      setLoading(false);
      setIsGenerating(false);
    }
  };

  const handleDownload = async (reportId: string) => {
    try {
      setLoading(true, '准备下载...');
      window.open(`http://localhost:3001/api/report/download/${reportId}`, '_blank');
    } catch (err) {
      setError(err instanceof Error ? err.message : '下载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = (reportId: string) => {
    setReportList(reportList.filter((r) => r.id !== reportId));
  };

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-text-primary mb-6 flex items-center gap-3">
        <FileText className="w-8 h-8 text-accent" /> <span className="gradient-text">异常根因报告生成</span>
      </h1>

      {error && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="card p-6">
          <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Settings className="w-5 h-5 text-accent" /> 报告配置
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">检测结果选择</label>
              <select
                value={selectedResultId}
                onChange={(e) => setSelectedResultId(e.target.value)}
                className="input"
              >
                <option value="">请选择检测结果</option>
                {anomalyResults.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">报告格式</label>
              <select
                value={reportConfig.format}
                onChange={(e) => setReportConfig({ format: e.target.value as 'word' | 'pdf' })}
                className="input"
              >
                <option value="word">Word (.docx)</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">报告语言</label>
              <select
                value={reportConfig.language}
                onChange={(e) => setReportConfig({ language: e.target.value as 'zh' | 'en' })}
                className="input"
              >
                <option value="zh">中文</option>
                <option value="en">English</option>
              </select>
            </div>
            <div className="space-y-2 pt-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={reportConfig.includeCharts}
                  onChange={(e) => setReportConfig({ includeCharts: e.target.checked })}
                  className="accent-accent"
                />
                <span className="text-sm text-text-primary">包含图表</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={reportConfig.includeSHAP}
                  onChange={(e) => setReportConfig({ includeSHAP: e.target.checked })}
                  className="accent-accent"
                />
                <span className="text-sm text-text-primary">包含SHAP分析</span>
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={reportConfig.includeRawData}
                  onChange={(e) => setReportConfig({ includeRawData: e.target.checked })}
                  className="accent-accent"
                />
                <span className="text-sm text-text-primary">包含原始数据</span>
              </label>
            </div>
            <button
              onClick={handleGenerate}
              disabled={isGenerating || !selectedResultId}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Play className="w-5 h-5" />
              {isGenerating ? '生成中...' : '生成报告'}
            </button>
            {isGenerating && (
              <div className="w-full h-2 bg-border rounded-full overflow-hidden mt-2">
                <div className="h-full bg-accent animate-pulse" style={{ width: '60%' }} />
              </div>
            )}
          </div>
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-text-primary mb-4">已生成报告</h3>
          {reportList.length === 0 ? (
            <p className="text-text-muted text-center py-8">暂无报告</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="text-text-secondary text-sm">
                    <th className="text-left p-2">报告名称</th>
                    <th className="text-left p-2">格式</th>
                    <th className="text-left p-2">生成时间</th>
                    <th className="text-right p-2">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {reportList.map((report) => (
                    <tr key={report.id} className="border-t border-border">
                      <td className="p-2 text-text-primary text-sm">{report.fileName}</td>
                      <td className="p-2 text-sm data-text">Word</td>
                      <td className="p-2 text-sm text-text-muted">{report.createdAt}</td>
                      <td className="p-2 text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            onClick={() => handleDownload(report.id)}
                            className="p-1 text-accent hover:bg-accent/10 rounded"
                            title="下载"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(report.id)}
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
