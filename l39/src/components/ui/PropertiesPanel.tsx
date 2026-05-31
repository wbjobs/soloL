import { useState, useCallback } from 'react';
import { 
  BarChart3, 
  FileText, 
  Target, 
  Layers, 
  ChevronDown,
  ChevronUp,
  Play,
  Download,
  RefreshCw,
  AlertCircle
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { trajectoryAPI } from '../../utils/api';
import { AnalysisReport, IntersectionResult, BezierControlPoints } from '../../../shared/types';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

interface PanelSectionProps {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

function PanelSection({ title, icon, children, defaultOpen = true }: PanelSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-gray-700">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-medium text-gray-200">{title}</span>
        </div>
        {isOpen ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
      </button>
      {isOpen && (
        <div className="px-4 pb-4">
          {children}
        </div>
      )}
    </div>
  );
}

const PIE_COLORS = ['#ff6b35', '#4ecdc4', '#45b7d1', '#96ceb4', '#ffeaa7', '#dfe6e9', '#fd79a8', '#a29bfe'];

export function PropertiesPanel() {
  const {
    grid,
    gridId,
    formations,
    trajectories,
    selectedTrajectoryId,
    analysisReport,
    setAnalysisReport,
    selectTrajectory,
    updateTrajectory
  } = useStore();

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [selectedSegmentIndex, setSelectedSegmentIndex] = useState(0);

  const selectedTrajectory = trajectories.find(t => t.id === selectedTrajectoryId);

  const handleAnalyzeTrajectory = useCallback(async () => {
    if (!gridId || !selectedTrajectory) return;

    setIsAnalyzing(true);
    try {
      const report = await trajectoryAPI.analyze(
        gridId,
        selectedTrajectory
      );
      setAnalysisReport(report);
    } catch (error) {
      console.error('Failed to analyze trajectory:', error);
    } finally {
      setIsAnalyzing(false);
    }
  }, [gridId, selectedTrajectory, formations, setAnalysisReport]);

  const handleControlPointChange = useCallback((segmentIndex: number, pointKey: keyof BezierControlPoints, axis: 'x' | 'y' | 'z', value: number) => {
    if (!selectedTrajectory) return;

    const newSegments = [...selectedTrajectory.segments];
    newSegments[segmentIndex] = {
      ...newSegments[segmentIndex],
      [pointKey]: {
        ...newSegments[segmentIndex][pointKey],
        [axis]: value
      }
    };

    updateTrajectory(selectedTrajectory.id, {
      segments: newSegments
    });
  }, [selectedTrajectory, updateTrajectory]);

  const renderThicknessChart = (intersections: IntersectionResult[]) => {
    const data = intersections.map(intersection => ({
      name: intersection.formationName,
      thickness: intersection.thickness,
      dipAngle: intersection.dipAngle
    }));

    return (
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis dataKey="name" stroke="#9ca3af" tick={{ fontSize: 10 }} />
          <YAxis stroke="#9ca3af" tick={{ fontSize: 10 }} />
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px' }}
            labelStyle={{ color: '#e5e7eb' }}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Bar dataKey="thickness" fill="#ff6b35" name="厚度 (m)" radius={[4, 4, 0, 0]} />
          <Bar dataKey="dipAngle" fill="#4ecdc4" name="倾角 (°)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  const renderFormationDistribution = (intersections: IntersectionResult[]) => {
    const data = intersections.map(intersection => ({
      name: intersection.formationName,
      value: intersection.thickness
    }));

    return (
      <ResponsiveContainer width="100%" height={180}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={40}
            outerRadius={70}
            paddingAngle={2}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{ backgroundColor: '#1f2937', border: '1px solid #374151', borderRadius: '4px' }}
            formatter={(value: number) => [`${value.toFixed(2)} m`, '厚度']}
          />
        </PieChart>
      </ResponsiveContainer>
    );
  };

  return (
    <div className="w-80 bg-gray-900 text-white overflow-y-auto border-l border-gray-700">
      <div className="p-4 border-b border-gray-700">
        <h2 className="text-lg font-bold bg-gradient-to-r from-orange-400 to-pink-400 bg-clip-text text-transparent">
          属性面板
        </h2>
      </div>

      {!selectedTrajectory ? (
        <div className="p-4">
          <div className="flex flex-col items-center justify-center py-12 text-gray-500">
            <Target size={48} className="mb-4 opacity-50" />
            <p className="text-sm">请选择一条钻井轨迹</p>
            <p className="text-xs mt-1">或在左侧控制面板中添加新轨迹</p>
          </div>
        </div>
      ) : (
        <>
          <PanelSection title="轨迹属性" icon={<FileText size={18} className="text-orange-400" />}>
            <div className="space-y-3">
              <div>
                <label className="block text-sm text-gray-400 mb-1">轨迹名称</label>
                <input
                  type="text"
                  value={selectedTrajectory.name}
                  onChange={(e) => updateTrajectory(selectedTrajectory.id, { name: e.target.value })}
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-sm"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-1">轨迹颜色</label>
                <input
                  type="color"
                  value={selectedTrajectory.color}
                  onChange={(e) => updateTrajectory(selectedTrajectory.id, { color: e.target.value })}
                  className="w-full h-10 rounded cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-sm text-gray-400 mb-2">贝塞尔曲线段</label>
                <div className="flex gap-1 flex-wrap">
                  {selectedTrajectory.segments.map((_, index) => (
                    <button
                      key={index}
                      onClick={() => setSelectedSegmentIndex(index)}
                      className={`px-3 py-1 rounded text-xs transition-colors ${
                        selectedSegmentIndex === index
                          ? 'bg-orange-600 text-white'
                          : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                      }`}
                    >
                      段 {index + 1}
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2 border-t border-gray-700">
                <h4 className="text-sm font-medium text-gray-300 mb-2">
                  控制点 - 段 {selectedSegmentIndex + 1}
                </h4>
                {['p0', 'p1', 'p2', 'p3'].map((pointKey) => {
                  const point = selectedTrajectory.segments[selectedSegmentIndex][pointKey as keyof BezierControlPoints];
                  const label = pointKey === 'p0' ? '起点' : pointKey === 'p3' ? '终点' : `控制点 ${pointKey}`;
                  const color = pointKey === 'p0' || pointKey === 'p3' ? 'text-orange-400' : 'text-cyan-400';
                  
                  return (
                    <div key={pointKey} className="mb-3">
                      <p className={`text-xs ${color} mb-1`}>{label}</p>
                      <div className="grid grid-cols-3 gap-2">
                        {(['x', 'y', 'z'] as const).map((axis) => (
                          <div key={axis}>
                            <label className="block text-xs text-gray-500 mb-1">{axis.toUpperCase()}</label>
                            <input
                              type="number"
                              step="5"
                              value={point[axis]}
                              onChange={(e) => handleControlPointChange(
                                selectedSegmentIndex,
                                pointKey as keyof BezierControlPoints,
                                axis,
                                Number(e.target.value)
                              )}
                              className="w-full px-2 py-1 bg-gray-800 border border-gray-600 rounded text-xs"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="pt-2 border-t border-gray-700">
                <button
                  onClick={handleAnalyzeTrajectory}
                  disabled={isAnalyzing || !gridId}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-600 rounded transition-colors"
                >
                  {isAnalyzing ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" />
                      <span className="text-sm">分析中...</span>
                    </>
                  ) : (
                    <>
                      <Play size={16} />
                      <span className="text-sm">分析轨迹</span>
                    </>
                  )}
                </button>
                {!gridId && (
                  <p className="text-xs text-yellow-500 mt-2 flex items-center gap-1">
                    <AlertCircle size={12} />
                    需要先加载地质模型
                  </p>
                )}
              </div>
            </div>
          </PanelSection>

          {analysisReport && analysisReport.trajectoryId === selectedTrajectoryId && (
            <>
              <PanelSection title="分析报告" icon={<BarChart3 size={18} className="text-cyan-400" />}>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="p-3 bg-gray-800 rounded">
                      <p className="text-xs text-gray-400">总长度</p>
                      <p className="text-lg font-bold text-cyan-400">
                        {analysisReport.totalLength.toFixed(1)} m
                      </p>
                    </div>
                    <div className="p-3 bg-gray-800 rounded">
                      <p className="text-xs text-gray-400">最大深度</p>
                      <p className="text-lg font-bold text-orange-400">
                        {analysisReport.maxDepth.toFixed(1)} m
                      </p>
                    </div>
                    <div className="p-3 bg-gray-800 rounded">
                      <p className="text-xs text-gray-400">穿过地层</p>
                      <p className="text-lg font-bold text-purple-400">
                        {analysisReport.intersections.length} 层
                      </p>
                    </div>
                    <div className="p-3 bg-gray-800 rounded">
                      <p className="text-xs text-gray-400">平均倾角</p>
                      <p className="text-lg font-bold text-pink-400">
                        {analysisReport.averageDipAngle.toFixed(1)}°
                      </p>
                    </div>
                  </div>

                  <div className="pt-2">
                    <p className="text-sm text-gray-300 mb-2">厚度与倾角对比</p>
                    {renderThicknessChart(analysisReport.intersections)}
                  </div>

                  <div className="pt-2">
                    <p className="text-sm text-gray-300 mb-2">地层厚度分布</p>
                    {renderFormationDistribution(analysisReport.intersections)}
                  </div>

                  <div className="pt-2 border-t border-gray-700">
                    <button
                      onClick={() => {
                        const csv = [
                          ['地层名称', '厚度 (m)', '倾角 (°)', '走向角 (°)', '入口深度 (m)', '出口深度 (m)'],
                          ...analysisReport.intersections.map(i => [
                            i.formationName,
                            i.thickness.toFixed(2),
                            i.dipAngle.toFixed(2),
                            i.strikeAngle.toFixed(2),
                            i.entryDepth.toFixed(2),
                            i.exitDepth.toFixed(2)
                          ])
                        ].map(row => row.join(',')).join('\n');
                        
                        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                        const link = document.createElement('a');
                        link.href = URL.createObjectURL(blob);
                        link.download = `trajectory_analysis_${Date.now()}.csv`;
                        link.click();
                      }}
                      className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
                    >
                      <Download size={16} />
                      <span className="text-sm">导出 CSV 报告</span>
                    </button>
                  </div>
                </div>
              </PanelSection>

              <PanelSection title="地层详情" icon={<Layers size={18} className="text-purple-400" />}>
                <div className="space-y-2">
                  {analysisReport.intersections.map((intersection, index) => {
                    const formation = formations.find(f => f.id === intersection.formationId);
                    return (
                      <div
                        key={index}
                        className="p-3 bg-gray-800 rounded border-l-4"
                        style={{ borderLeftColor: formation?.color || '#888' }}
                      >
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{intersection.formationName}</span>
                          <span className="text-xs text-gray-400">第 {index + 1} 层</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <span className="text-gray-500">厚度: </span>
                            <span className="text-cyan-400">{intersection.thickness.toFixed(2)} m</span>
                          </div>
                          <div>
                            <span className="text-gray-500">倾角: </span>
                            <span className="text-orange-400">{intersection.dipAngle.toFixed(2)}°</span>
                          </div>
                          <div>
                            <span className="text-gray-500">走向: </span>
                            <span className="text-purple-400">{intersection.strikeAngle.toFixed(2)}°</span>
                          </div>
                          <div>
                            <span className="text-gray-500">深度: </span>
                            <span className="text-pink-400">{intersection.entryDepth.toFixed(0)} - {intersection.exitDepth.toFixed(0)} m</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </PanelSection>
            </>
          )}

          <PanelSection title="地层图例" icon={<Layers size={18} className="text-blue-400" />}>
            <div className="space-y-2">
              {formations.map((formation) => (
                <div key={formation.id} className="flex items-center gap-3">
                  <div
                    className="w-4 h-4 rounded"
                    style={{ backgroundColor: formation.color }}
                  />
                  <div>
                    <p className="text-sm text-gray-200">{formation.name}</p>
                    <p className="text-xs text-gray-500">
                      {formation.minValue.toFixed(1)} - {formation.maxValue.toFixed(1)}
                    </p>
                  </div>
                </div>
              ))}
              {formations.length === 0 && (
                <p className="text-xs text-gray-500 text-center py-4">
                  加载模型后显示图例
                </p>
              )}
            </div>
          </PanelSection>
        </>
      )}
    </div>
  );
}
