import { useState, useCallback, useMemo } from 'react';
import { Upload, FileSpreadsheet, Database, TrendingUp, Play, Wand2, CheckCircle2, AlertCircle, X } from 'lucide-react';
import PlotlyChart from '@/components/PlotlyChart';
import { useAppStore } from '@/store/useAppStore';
import { cn } from '@/lib/utils';
import type { TimeSeriesData } from '../../shared/types';

export default function DataManagement() {
  const { timeSeriesData, setTimeSeriesData, addDataToList, setLoading } = useAppStore();
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [previewData, setPreviewData] = useState<Record<string, string | number>[]>([]);

  const loadSampleData = async (type: 'stock' | 'fx') => {
    try {
      setLoading(true, `加载${type === 'stock' ? '股票' : '外汇'}数据...`);
      const response = await fetch(`/api/data/sample?type=${type}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '加载失败');
      const data = result.data as TimeSeriesData;
      setTimeSeriesData(data);
      addDataToList(data);
      setSelectedFeatures(data.selectedFeatures || Object.keys(data.features));
      setError(null);
      await loadPreview(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  };

  const handleFile = useCallback(async (file: File) => {
    if (!file.name.endsWith('.csv')) { setError('请上传CSV文件'); return; }
    try {
      setLoading(true, '上传CSV文件...');
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/data/upload', { method: 'POST', body: formData });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '上传失败');
      const data = result.data as TimeSeriesData;
      setTimeSeriesData(data);
      addDataToList(data);
      setSelectedFeatures(Object.keys(data.features));
      setError(null);
      await loadPreview(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '上传失败');
    } finally {
      setLoading(false);
    }
  }, [setTimeSeriesData, addDataToList, setLoading]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  }, [handleFile]);

  const loadPreview = async (dataId: string) => {
    try {
      const response = await fetch(`/api/data/${dataId}/preview?page=1&pageSize=100`);
      const result = await response.json();
      if (result.success && result.data) {
        const { dates, features } = result.data;
        setPreviewData(dates.map((date: string, i: number) => {
          const row: Record<string, string | number> = { date };
          Object.keys(features).forEach((key) => { row[key] = features[key][i]; });
          return row;
        }));
      }
    } catch { /* ignore */ }
  };

  const toggleFeature = (f: string) => {
    setSelectedFeatures((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);
  };

  const applySelection = () => {
    if (timeSeriesData) setTimeSeriesData({ ...timeSeriesData, selectedFeatures });
  };

  const runFeatureEngineering = async () => {
    if (!timeSeriesData) return;
    try {
      setLoading(true, '执行特征工程...');
      const response = await fetch(`/api/data/${timeSeriesData.id}/features`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ features: selectedFeatures }),
      });
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '特征工程失败');
      const data = result.data as TimeSeriesData;
      setTimeSeriesData(data);
      setSelectedFeatures(Object.keys(data.features));
      await loadPreview(data.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : '特征工程失败');
    } finally {
      setLoading(false);
    }
  };

  const chartData = useMemo(() => {
    if (!timeSeriesData) return [];
    const colors = ['#00f5d4', '#f59e0b', '#8b5cf6', '#ef4444'];
    return timeSeriesData.selectedFeatures.slice(0, 4).map((f, i) => ({
      x: timeSeriesData.dates, y: timeSeriesData.features[f],
      type: 'scatter', mode: 'lines', name: f,
      line: { color: colors[i % colors.length], width: 1.5 },
    }));
  }, [timeSeriesData]);

  const displayRows = useMemo(() => {
    if (previewData.length > 0) return previewData;
    if (!timeSeriesData) return [];
    const count = Math.min(20, timeSeriesData.length);
    return Array.from({ length: count }, (_, i) => {
      const row: Record<string, string | number> = { date: timeSeriesData.dates[i] };
      Object.keys(timeSeriesData.features).forEach((key) => { row[key] = timeSeriesData.features[key][i]; });
      return row;
    });
  }, [previewData, timeSeriesData]);

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <h1 className="text-3xl font-bold text-text-primary mb-6 flex items-center gap-3">
        <Database className="w-8 h-8 text-accent" /> <span className="gradient-text">数据管理</span>
      </h1>

      {error && (
        <div className="mb-6 p-4 bg-anomaly-glow text-anomaly rounded-lg flex items-center gap-3 border border-anomaly/20">
          <AlertCircle className="w-5 h-5 shrink-0" /> {error}
          <button onClick={() => setError(null)} className="ml-auto"><X className="w-5 h-5" /></button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={() => setIsDragging(false)}
          className={cn(
            'border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer',
            isDragging ? 'border-accent bg-accent-glow glow-border'
              : 'border-border hover:border-accent/50 hover:bg-accent-glow/30'
          )}
        >
          <Upload className="w-12 h-12 mx-auto mb-4 text-text-muted" />
          <p className="text-text-primary font-medium mb-2">拖拽CSV文件到此处</p>
          <p className="text-text-muted text-sm mb-4">或点击选择文件上传</p>
          <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} className="hidden" id="csv-upload" />
          <label htmlFor="csv-upload" className="inline-flex items-center gap-2 px-4 py-2 btn-primary cursor-pointer">
            <FileSpreadsheet className="w-4 h-4" /> 选择文件
          </label>
        </div>

        <div className="card p-6">
          <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Play className="w-5 h-5 text-accent" /> 加载示例数据
          </h3>
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => loadSampleData('stock')} className="flex items-center justify-center gap-2 px-4 py-3 btn-secondary">
              <TrendingUp className="w-5 h-5 text-accent" /> 股票数据
            </button>
            <button onClick={() => loadSampleData('fx')} className="flex items-center justify-center gap-2 px-4 py-3 btn-secondary">
              <TrendingUp className="w-5 h-5 text-anomaly" /> 外汇数据
            </button>
          </div>
        </div>
      </div>

      {timeSeriesData && (
        <>
          <div className="card p-6 mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-text-primary flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-accent" />
                <span className="data-text">{timeSeriesData.name}</span>
                <span className="text-text-muted text-sm">({timeSeriesData.length} 条)</span>
              </h3>
              <button onClick={runFeatureEngineering} className="flex items-center gap-2 btn-anomaly">
                <Wand2 className="w-4 h-4" /> 特征工程
              </button>
            </div>
            <div className="mb-4">
              <p className="text-sm text-text-secondary mb-3">选择用于训练的特征：</p>
              <div className="flex flex-wrap gap-2 mb-4">
                {Object.keys(timeSeriesData.features).map((f) => (
                  <button key={f} onClick={() => toggleFeature(f)} className={cn(
                    'px-3 py-1.5 rounded-full text-sm font-medium transition-all border',
                    selectedFeatures.includes(f)
                      ? 'bg-accent/15 text-accent border-accent/30 glow-text'
                      : 'bg-background-dark text-text-secondary border-border hover:border-accent/30 hover:text-text-primary'
                  )}>{f}</button>
                ))}
              </div>
              <button onClick={applySelection} className="btn-primary text-sm">
                应用选择 ({selectedFeatures.length} 个特征)
              </button>
            </div>
            <PlotlyChart data={chartData} layout={{ title: '数据概览', showlegend: true }} height={350} />
          </div>

          <div className="card p-6">
            <h3 className="font-semibold text-text-primary mb-4">
              数据预览 <span className="text-text-muted text-sm">(前 {displayRows.length} 行)</span>
            </h3>
            <div className="overflow-x-auto max-h-96 overflow-y-auto scrollbar-thin">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-background-dark">
                  <tr>{displayRows[0] && Object.keys(displayRows[0]).map((key) => (
                    <th key={key} className="px-3 py-2 text-left font-medium text-text-secondary border-b border-border">{key}</th>
                  ))}</tr>
                </thead>
                <tbody>{displayRows.map((row, i) => (
                  <tr key={i} className="border-b border-border/50 hover:bg-background-dark/50">
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="px-3 py-2 text-text-secondary data-text">
                        {typeof val === 'number' ? val.toFixed(4) : val}
                      </td>
                    ))}
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
