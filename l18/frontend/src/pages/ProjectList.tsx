import { useState } from 'react';
import { Plus, Folder, Calendar, HardDrive, MoreVertical, Search, Upload, Grid, List } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import FileUpload from '@/components/common/FileUpload';

interface Project {
  id: string;
  name: string;
  pointCount: number;
  fileSize: number;
  uploadDate: Date;
  annotationProgress: number;
  thumbnail?: string;
}

const mockProjects: Project[] = [
  {
    id: '1',
    name: '城市道路扫描_001',
    pointCount: 2560000,
    fileSize: 128 * 1024 * 1024,
    uploadDate: new Date('2024-01-15'),
    annotationProgress: 75,
  },
  {
    id: '2',
    name: '建筑工地扫描',
    pointCount: 5800000,
    fileSize: 256 * 1024 * 1024,
    uploadDate: new Date('2024-01-10'),
    annotationProgress: 30,
  },
  {
    id: '3',
    name: '森林植被调查',
    pointCount: 1200000,
    fileSize: 64 * 1024 * 1024,
    uploadDate: new Date('2024-01-05'),
    annotationProgress: 100,
  },
  {
    id: '4',
    name: '矿区地形测量',
    pointCount: 8900000,
    fileSize: 512 * 1024 * 1024,
    uploadDate: new Date('2024-01-01'),
    annotationProgress: 0,
  },
  {
    id: '5',
    name: '铁路沿线扫描',
    pointCount: 3400000,
    fileSize: 180 * 1024 * 1024,
    uploadDate: new Date('2023-12-28'),
    annotationProgress: 50,
  },
  {
    id: '6',
    name: '古建筑数字化',
    pointCount: 4200000,
    fileSize: 220 * 1024 * 1024,
    uploadDate: new Date('2023-12-20'),
    annotationProgress: 85,
  },
];

const formatNumber = (n: number) => n.toLocaleString();

const formatSize = (bytes: number) => {
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
};

const formatDate = (date: Date) => {
  return date.toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
};

export default function ProjectList() {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [uploadModalOpen, setUploadModalOpen] = useState(false);

  const filteredProjects = mockProjects.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleProjectClick = (projectId: string) => {
    navigate(`/annotation/${projectId}`);
  };

  const handleFileSelect = (file: File) => {
    console.log('上传文件:', file.name);
    setUploadModalOpen(false);
  };

  const getProgressColor = (progress: number) => {
    if (progress === 0) return 'bg-gray-500';
    if (progress === 100) return 'bg-green-500';
    if (progress >= 70) return 'bg-primary';
    return 'bg-yellow-500';
  };

  return (
    <div className="h-full bg-background p-6 overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold text-white mb-1">项目列表</h1>
            <p className="text-gray-400">管理您的点云标注项目</p>
          </div>
          <Button onClick={() => setUploadModalOpen(true)}>
            <Plus size={18} className="mr-2" />
            上传点云
          </Button>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              placeholder="搜索项目..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 bg-surface border border-surface-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary transition-all"
            />
          </div>
          <div className="flex items-center gap-1 bg-surface rounded-lg p-1 border border-surface-border">
            <Button
              variant="icon"
              size="sm"
              isActive={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
            >
              <Grid size={16} />
            </Button>
            <Button
              variant="icon"
              size="sm"
              isActive={viewMode === 'list'}
              onClick={() => setViewMode('list')}
            >
              <List size={16} />
            </Button>
          </div>
        </div>

        {filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-500">
            <Folder size={64} className="mb-4 opacity-50" />
            <p className="text-lg">暂无项目</p>
            <p className="text-sm mt-1">点击上方按钮上传您的第一个点云文件</p>
          </div>
        ) : (
          <div
            className={cn(
              viewMode === 'grid'
                ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4'
                : 'space-y-3'
            )}
          >
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                onClick={() => handleProjectClick(project.id)}
                className={cn(
                  'group cursor-pointer transition-all duration-200',
                  viewMode === 'grid'
                    ? 'panel p-5 hover:border-primary/50 hover:shadow-lg hover:shadow-primary/10'
                    : 'panel p-4 flex items-center gap-4 hover:border-primary/50'
                )}
              >
                {viewMode === 'grid' ? (
                  <>
                    <div className="aspect-video bg-surface-dark rounded-lg mb-4 flex items-center justify-center overflow-hidden">
                      <div className="w-full h-full bg-gradient-to-br from-primary/20 to-purple-500/20 flex items-center justify-center group-hover:scale-105 transition-transform duration-300">
                        <Folder size={48} className="text-primary/60" />
                      </div>
                    </div>
                    <h3 className="font-semibold text-white mb-2 truncate group-hover:text-primary transition-colors">
                      {project.name}
                    </h3>
                    <div className="space-y-2 text-sm text-gray-400">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5">
                          <HardDrive size={14} />
                          {formatSize(project.fileSize)}
                        </span>
                        <span className="font-mono">
                          {formatNumber(project.pointCount)} 点
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Calendar size={14} />
                        {formatDate(project.uploadDate)}
                      </div>
                      <div className="pt-2">
                        <div className="flex justify-between text-xs mb-1">
                          <span>标注进度</span>
                          <span className="text-primary">{project.annotationProgress}%</span>
                        </div>
                        <div className="h-1.5 bg-surface-dark rounded-full overflow-hidden">
                          <div
                            className={cn('h-full transition-all duration-500', getProgressColor(project.annotationProgress))}
                            style={{ width: `${project.annotationProgress}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="w-16 h-16 bg-surface-dark rounded-lg flex items-center justify-center shrink-0">
                      <Folder size={24} className="text-primary/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-white truncate group-hover:text-primary transition-colors">
                        {project.name}
                      </h3>
                      <div className="flex items-center gap-4 text-sm text-gray-400 mt-1">
                        <span className="flex items-center gap-1">
                          <HardDrive size={14} />
                          {formatSize(project.fileSize)}
                        </span>
                        <span className="font-mono">
                          {formatNumber(project.pointCount)} 点
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar size={14} />
                          {formatDate(project.uploadDate)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-2">
                        <div className="flex-1 h-1.5 bg-surface-dark rounded-full overflow-hidden">
                          <div
                            className={cn('h-full transition-all duration-500', getProgressColor(project.annotationProgress))}
                            style={{ width: `${project.annotationProgress}%` }}
                          />
                        </div>
                        <span className="text-xs text-primary font-mono w-12 text-right">
                          {project.annotationProgress}%
                        </span>
                      </div>
                    </div>
                    <Button variant="icon" size="sm" className="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                      <MoreVertical size={16} />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <Modal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        title="上传点云文件"
      >
        <FileUpload onFileSelect={handleFileSelect} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setUploadModalOpen(false)}>
            取消
          </Button>
          <Button variant="ghost" disabled>
            <Upload size={16} className="mr-2" />
            上传中...
          </Button>
        </div>
      </Modal>
    </div>
  );
}
