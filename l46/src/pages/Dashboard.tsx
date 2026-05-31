import { Activity, Database, AlertTriangle, Search, BarChart3, Play, TrendingUp, Upload, ArrowRight } from 'lucide-react';
import { useAppStore, type PageType } from '@/store/useAppStore';
import type { TimeSeriesData } from '../../shared/types';

export default function Dashboard() {
  const { setTimeSeriesData, timeSeriesData, addDataToList, setCurrentPage, setLoading } = useAppStore();

  const loadSampleData = async (type: 'stock' | 'fx') => {
    try {
      setLoading(true, `加载${type === 'stock' ? '股票' : '外汇'}示例数据...`);
      const response = await fetch(`/api/data/sample?type=${type}`);
      const result = await response.json();
      if (!result.success) throw new Error(result.error || '加载数据失败');
      const data = result.data as TimeSeriesData;
      setTimeSeriesData(data);
      addDataToList(data);
      setCurrentPage('data');
    } catch (error) {
      console.error('加载示例数据失败:', error);
      alert(error instanceof Error ? error.message : '加载数据失败');
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: Database, title: '数据管理', desc: '上传CSV数据，选择特征，进行特征工程', page: 'data' as PageType },
    { icon: AlertTriangle, title: '异常检测', desc: '配置HMM模型，训练并检测时序异常', page: 'anomaly' as PageType },
    { icon: Search, title: '根因分析', desc: '使用SHAP值分析异常根因，特征重要性可视化', page: 'rootcause' as PageType },
    { icon: BarChart3, title: '回测验证', desc: '滑动窗口回测，验证模型稳定性与准确率', page: 'backtest' as PageType },
  ];

  return (
    <div className="p-6 max-w-7xl mx-auto animate-fade-in">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2 flex items-center gap-3">
          <Activity className="w-8 h-8 text-accent" />
          <span className="gradient-text">时序异常检测平台</span>
        </h1>
        <p className="text-text-secondary text-lg">
          基于隐马尔可夫模型（HMM）的高性能时序异常检测与根因分析系统
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <div className="card p-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-accent" />
            项目介绍
          </h2>
          <p className="text-text-secondary mb-4 leading-relaxed">
            本平台提供完整的时序异常检测解决方案，支持多变量时间序列数据的异常检测、根因分析和回测验证。采用HMM模型结合SHAP可解释性分析，帮助您快速发现数据中的异常模式并定位根本原因。
          </p>
          <div className="flex flex-wrap gap-2">
            {['HMM模型', 'SHAP分析', '滑动窗口', '多变量支持', '实时检测'].map((tag) => (
              <span key={tag} className="px-3 py-1 bg-accent-glow text-accent text-sm rounded-full border border-accent/20">
                {tag}
              </span>
            ))}
          </div>
        </div>

        <div className="card p-6">
          <h2 className="text-xl font-semibold text-text-primary mb-4 flex items-center gap-2">
            <Play className="w-5 h-5 text-anomaly" />
            快速操作
          </h2>
          <div className="space-y-3">
            <button
              onClick={() => loadSampleData('stock')}
              className="w-full flex items-center justify-between px-4 py-3 btn-primary"
            >
              <span className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                加载股票示例数据
              </span>
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => loadSampleData('fx')}
              className="w-full flex items-center justify-between px-4 py-3 btn-primary"
            >
              <span className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                加载外汇示例数据
              </span>
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => setCurrentPage('data')}
              className="w-full flex items-center justify-between px-4 py-3 btn-ghost"
            >
              <span className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                上传自己的数据
              </span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
          {timeSeriesData && (
            <div className="mt-4 p-3 bg-accent-glow text-accent rounded-lg text-sm data-text glow-border">
              ✓ 已加载数据: {timeSeriesData.name} ({timeSeriesData.length} 条)
            </div>
          )}
        </div>
      </div>

      <h2 className="text-2xl font-bold text-text-primary mb-6">功能模块</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <button
              key={feature.page}
              onClick={() => setCurrentPage(feature.page)}
              className="card-hover p-6 text-left group"
            >
              <div className="w-12 h-12 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center mb-4 group-hover:bg-accent/20 group-hover:scale-110 transition-all">
                <Icon className="w-6 h-6 text-accent" />
              </div>
              <h3 className="text-lg font-semibold text-text-primary mb-2">
                {feature.title}
              </h3>
              <p className="text-text-secondary text-sm leading-relaxed">
                {feature.desc}
              </p>
              <div className="mt-4 flex items-center text-accent text-sm font-medium gap-1 group-hover:gap-2 transition-all">
                进入 <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
