import { Undo2, Redo2, Save, Download, LogOut, User } from 'lucide-react';
import Button from '../common/Button';
import { useHistoryStore } from '@/store/useHistoryStore';
import { useAuthStore } from '@/store/useAuthStore';
import { useNavigate } from 'react-router-dom';

export default function TopToolbar() {
  const { canUndo, canRedo, undo, redo } = useHistoryStore();
  const { user, logout } = useAuthStore();
  const navigate = useNavigate();

  const handleSave = () => {
    console.log('保存标注');
  };

  const handleExport = () => {
    console.log('导出数据');
  };

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <header className="h-14 bg-surface border-b border-surface-border flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1 mr-4">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center">
            <span className="text-white font-bold text-sm">3D</span>
          </div>
          <span className="text-white font-semibold ml-2">点云标注工具</span>
        </div>

        <div className="h-6 w-px bg-surface-border mx-2" />

        <Button
          variant="icon"
          size="sm"
          onClick={undo}
          disabled={!canUndo()}
          title="撤销 (Ctrl+Z)"
        >
          <Undo2 size={18} />
        </Button>
        <Button
          variant="icon"
          size="sm"
          onClick={redo}
          disabled={!canRedo()}
          title="重做 (Ctrl+Y)"
        >
          <Redo2 size={18} />
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={handleSave}>
          <Save size={16} className="mr-2" />
          保存
        </Button>
        <Button variant="primary" size="sm" onClick={handleExport}>
          <Download size={16} className="mr-2" />
          导出
        </Button>

        <div className="h-6 w-px bg-surface-border mx-2" />

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 text-sm text-gray-300">
            <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center">
              <User size={14} className="text-primary" />
            </div>
            <span>{user?.username || '用户'}</span>
          </div>
          <Button variant="icon" size="sm" onClick={handleLogout} title="退出登录">
            <LogOut size={16} />
          </Button>
        </div>
      </div>
    </header>
  );
}
