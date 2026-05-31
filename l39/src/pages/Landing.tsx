import { Box, Database, Layers, Compass, Zap, Play, ChevronRight, GitBranch, Target, BarChart3 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface FeatureCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  color: string;
}

function FeatureCard({ icon, title, description, color }: FeatureCardProps) {
  return (
    <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700 hover:border-gray-600 transition-all group">
      <div className={`w-12 h-12 rounded-lg ${color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
        {icon}
      </div>
      <h3 className="text-lg font-semibold text-white mb-2">{title}</h3>
      <p className="text-sm text-gray-400 leading-relaxed">{description}</p>
    </div>
  );
}

export function Landing() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 text-white">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-orange-500/5 rounded-full blur-3xl" />
      </div>

      <header className="relative z-10 px-8 py-6 flex items-center justify-between border-b border-gray-800">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-blue-500/30">
            <Box size={28} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">
              GeoModel 3D
            </h1>
            <p className="text-xs text-gray-500">三维地质建模与钻井轨迹优化系统</p>
          </div>
        </div>

        <nav className="flex items-center gap-8">
          <a href="#features" className="text-sm text-gray-400 hover:text-white transition-colors">功能特性</a>
          <a href="#workflow" className="text-sm text-gray-400 hover:text-white transition-colors">工作流程</a>
          <a href="#tech" className="text-sm text-gray-400 hover:text-white transition-colors">技术架构</a>
        </nav>
      </header>

      <section className="relative z-10 px-8 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500/10 border border-orange-500/30 rounded-full mb-8">
            <Zap size={16} className="text-orange-400" />
            <span className="text-sm text-orange-400">全新版本 v1.0 发布</span>
          </div>
          
          <h2 className="text-5xl font-bold mb-6 leading-tight">
            高精度
            <span className="bg-gradient-to-r from-blue-400 via-cyan-400 to-teal-400 bg-clip-text text-transparent">
              {' '}三维地质建模
            </span>
            <br />
            与
            <span className="bg-gradient-to-r from-orange-400 via-pink-400 to-purple-400 bg-clip-text text-transparent">
              {' '}钻井轨迹优化
            </span>
          </h2>
          
          <p className="text-lg text-gray-400 mb-10 max-w-2xl mx-auto leading-relaxed">
            基于克里金插值算法构建高精度三维地质体模型，支持任意角度地层切片切割，
            采用三次贝塞尔曲线设计钻井轨迹，自动计算轨迹穿过每个地层的厚度和倾角，
            为油气勘探开发提供科学决策支持。
          </p>

          <div className="flex items-center justify-center gap-4">
            <button
              onClick={() => navigate('/workspace')}
              className="group flex items-center gap-2 px-8 py-4 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 rounded-xl font-semibold text-white shadow-lg shadow-blue-500/30 hover:shadow-blue-500/50 transition-all"
            >
              <Play size={20} />
              进入工作台
              <ChevronRight size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
            
            <button className="flex items-center gap-2 px-8 py-4 bg-gray-800 hover:bg-gray-700 rounded-xl font-semibold text-gray-300 border border-gray-700 transition-all">
              <Database size={20} />
              查看文档
            </button>
          </div>
        </div>

        <div className="mt-16 max-w-5xl mx-auto">
          <div className="relative rounded-2xl overflow-hidden border border-gray-700 shadow-2xl">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-cyan-900/20" />
            <div className="bg-gray-900/90 backdrop-blur p-8">
              <div className="grid grid-cols-4 gap-6">
                <div className="text-center">
                  <p className="text-4xl font-bold text-cyan-400 mb-1">200</p>
                  <p className="text-xs text-gray-500">X 网格分辨率</p>
                </div>
                <div className="text-center">
                  <p className="text-4xl font-bold text-orange-400 mb-1">200</p>
                  <p className="text-xs text-gray-500">Y 网格分辨率</p>
                </div>
                <div className="text-center">
                  <p className="text-4xl font-bold text-purple-400 mb-1">100</p>
                  <p className="text-xs text-gray-500">Z 网格分辨率</p>
                </div>
                <div className="text-center">
                  <p className="text-4xl font-bold text-pink-400 mb-1">4M</p>
                  <p className="text-xs text-gray-500">体素总数</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="relative z-10 px-8 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h3 className="text-3xl font-bold mb-4">核心功能</h3>
            <p className="text-gray-400 max-w-2xl mx-auto">
              集成先进的地质统计学算法与三维可视化技术，提供完整的地质建模与轨迹分析解决方案
            </p>
          </div>

          <div className="grid grid-cols-3 gap-6">
            <FeatureCard
              icon={<Database size={24} className="text-blue-400" />}
              title="SEGY 数据解析"
              description="支持标准SEGY格式地震勘探数据解析，包含3200字节文本头、400字节二进制头、道头和道数据的完整解析。"
              color="bg-blue-500/20"
            />
            <FeatureCard
              icon={<GitBranch size={24} className="text-orange-400" />}
              title="克里金插值"
              description="普通克里金插值算法，支持球状、指数、高斯三种变差函数模型，KD-tree优化邻域搜索。"
              color="bg-orange-500/20"
            />
            <FeatureCard
              icon={<Box size={24} className="text-cyan-400" />}
              title="三维地质建模"
              description="构建200×200×100高精度规则网格，400万体素三维地质体模型，三线性插值快速查询。"
              color="bg-cyan-500/20"
            />
            <FeatureCard
              icon={<Layers size={24} className="text-pink-400" />}
              title="任意角度切片"
              description="支持任意法向量平面切割地质体，GPU加速纹理采样，实时生成高质量地层切片图像。"
              color="bg-pink-500/20"
            />
            <FeatureCard
              icon={<Compass size={24} className="text-purple-400" />}
              title="贝塞尔轨迹设计"
              description="采用三次贝塞尔曲线参数化设计钻井轨迹，控制点可编辑，实时预览轨迹形态。"
              color="bg-purple-500/20"
            />
            <FeatureCard
              icon={<BarChart3 size={24} className="text-emerald-400" />}
              title="轨迹分析报告"
              description="射线追踪算法精确定位地层交点，自动计算轨迹穿越每个地层的厚度、倾角、走向角。"
              color="bg-emerald-500/20"
            />
          </div>
        </div>
      </section>

      <section id="workflow" className="relative z-10 px-8 py-20 bg-gray-900/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h3 className="text-3xl font-bold mb-4">工作流程</h3>
            <p className="text-gray-400 max-w-2xl mx-auto">
              从数据加载到轨迹优化，四步完成完整的地质建模与钻井分析
            </p>
          </div>

          <div className="grid grid-cols-4 gap-6">
            {[
              { step: 1, title: '数据加载', desc: '上传SEGY文件或生成模拟数据', icon: <Database size={28} className="text-blue-400" /> },
              { step: 2, title: '模型构建', desc: '克里金插值生成三维地质模型', icon: <GitBranch size={28} className="text-orange-400" /> },
              { step: 3, title: '轨迹设计', desc: '三次贝塞尔曲线设计钻井轨迹', icon: <Target size={28} className="text-cyan-400" /> },
              { step: 4, title: '分析优化', desc: '计算地层厚度倾角生成报告', icon: <BarChart3 size={28} className="text-emerald-400" /> }
            ].map((item, index) => (
              <div key={index} className="relative">
                <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700 text-center">
                  <div className="absolute -top-3 -left-3 w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center text-sm font-bold">
                    {item.step}
                  </div>
                  <div className="mb-4 flex justify-center">
                    {item.icon}
                  </div>
                  <h4 className="font-semibold text-white mb-2">{item.title}</h4>
                  <p className="text-sm text-gray-400">{item.desc}</p>
                </div>
                {index < 3 && (
                  <div className="absolute top-1/2 -right-3 transform -translate-y-1/2">
                    <ChevronRight size={24} className="text-gray-600" />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="tech" className="relative z-10 px-8 py-20">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <h3 className="text-3xl font-bold mb-4">技术架构</h3>
            <p className="text-gray-400 max-w-2xl mx-auto">
              采用现代化技术栈，前后端分离架构，确保系统高性能与可扩展性
            </p>
          </div>

          <div className="grid grid-cols-2 gap-8">
            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700">
              <h4 className="text-lg font-semibold text-blue-400 mb-4">前端技术栈</h4>
              <div className="space-y-3">
                {[
                  { name: 'React 18 + TypeScript', desc: '类型安全的组件开发' },
                  { name: 'Three.js + R3F', desc: '高性能WebGL三维渲染' },
                  { name: 'Zustand', desc: '轻量级状态管理' },
                  { name: 'TailwindCSS', desc: '原子化CSS样式框架' },
                  { name: 'Recharts', desc: '数据可视化图表库' },
                  { name: 'Vite', desc: '极速构建工具' }
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
                    <span className="text-sm text-white">{item.name}</span>
                    <span className="text-xs text-gray-500">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-gray-800/50 backdrop-blur-sm rounded-xl p-6 border border-gray-700">
              <h4 className="text-lg font-semibold text-orange-400 mb-4">后端技术栈</h4>
              <div className="space-y-3">
                {[
                  { name: 'Express + TypeScript', desc: '高性能API服务' },
                  { name: '克里金插值算法', desc: '地质统计学核心算法' },
                  { name: 'KD-Tree', desc: '高效空间索引' },
                  { name: 'SEGY解析器', desc: '标准地震数据格式解析' },
                  { name: '二进制存储', desc: '高效网格数据持久化' },
                  { name: '异步任务队列', desc: '大规模插值计算' }
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between py-2 border-b border-gray-700 last:border-0">
                    <span className="text-sm text-white">{item.name}</span>
                    <span className="text-xs text-gray-500">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-10 px-8 py-8 border-t border-gray-800">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-500 flex items-center justify-center">
              <Box size={18} className="text-white" />
            </div>
            <p className="text-sm text-gray-500">© 2024 GeoModel 3D. 三维地质建模与钻井轨迹优化系统</p>
          </div>
          
          <div className="flex items-center gap-6">
            <p className="text-xs text-gray-600">基于 React + Three.js + Express 构建</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
