import React, { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Database,
  AlertTriangle,
  Search,
  BarChart3,
  Menu,
  X,
  Activity,
  GitBranch,
  FileText,
  Radio,
  Database as DatabaseIcon,
} from 'lucide-react';
import { useAppStore, type PageType } from '@/store/useAppStore';
import { cn } from '@/lib/utils';

interface NavItem {
  id: PageType;
  label: string;
  icon: React.ElementType;
}

const navItems: NavItem[] = [
  { id: 'dashboard', label: '仪表盘', icon: LayoutDashboard },
  { id: 'data', label: '数据管理', icon: Database },
  { id: 'anomaly', label: '异常检测', icon: AlertTriangle },
  { id: 'rootcause', label: '根因分析', icon: Search },
  { id: 'backtest', label: '回测验证', icon: BarChart3 },
  { id: 'multiasset', label: '多资产检测', icon: GitBranch },
  { id: 'report', label: '报告生成', icon: FileText },
  { id: 'stream', label: '实时流处理', icon: Radio },
  { id: 'sql', label: 'SQL规则导出', icon: DatabaseIcon },
];

interface LayoutProps {
  children: React.ReactNode;
}

export default function Layout({ children }: LayoutProps) {
  const { currentPage, setCurrentPage, sidebarCollapsed, toggleSidebar, setSidebarCollapsed } = useAppStore();
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) {
        setSidebarCollapsed(true);
      }
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, [setSidebarCollapsed]);

  const handleNavClick = (page: PageType) => {
    setCurrentPage(page);
    if (isMobile) {
      setSidebarCollapsed(true);
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0e17] text-white flex">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex flex-col bg-[#0d1320] border-r border-[#1a2332] transition-all duration-300 ease-in-out',
          sidebarCollapsed ? 'w-0 md:w-20 overflow-hidden' : 'w-64'
        )}
      >
        <div className="flex items-center justify-between h-16 px-4 border-b border-[#1a2332]">
          {!sidebarCollapsed && (
            <div className="flex items-center gap-2">
              <Activity className="w-8 h-8 text-[#00f5d4]" />
              <span className="text-lg font-bold bg-gradient-to-r from-[#00f5d4] to-[#00b4a0] bg-clip-text text-transparent">
                HMM Anomaly
              </span>
            </div>
          )}
          {sidebarCollapsed && !isMobile && (
            <div className="w-full flex justify-center">
              <Activity className="w-8 h-8 text-[#00f5d4]" />
            </div>
          )}
          {isMobile && !sidebarCollapsed && (
            <button
              onClick={toggleSidebar}
              className="p-1 rounded-lg hover:bg-[#1a2332] transition-colors"
            >
              <X className="w-5 h-5 text-gray-400" />
            </button>
          )}
        </div>

        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => handleNavClick(item.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group',
                  isActive
                    ? 'bg-[#00f5d4]/10 text-[#00f5d4] shadow-[0_0_20px_rgba(0,245,212,0.15)]'
                    : 'text-gray-400 hover:bg-[#1a2332] hover:text-white'
                )}
              >
                <Icon
                  className={cn(
                    'w-5 h-5 flex-shrink-0 transition-all duration-200',
                    isActive
                      ? 'text-[#00f5d4] drop-shadow-[0_0_8px_rgba(0,245,212,0.6)]'
                      : 'group-hover:text-[#00f5d4]'
                  )}
                />
                {!sidebarCollapsed && (
                  <span className="font-medium text-sm">{item.label}</span>
                )}
              </button>
            );
          })}
        </nav>

        {!sidebarCollapsed && (
          <div className="p-4 border-t border-[#1a2332]">
            <div className="text-xs text-gray-500">v1.0.0</div>
          </div>
        )}
      </aside>

      {isMobile && !sidebarCollapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-40"
          onClick={() => setSidebarCollapsed(true)}
        />
      )}

      <div
        className={cn(
          'flex-1 flex flex-col min-h-screen transition-all duration-300',
          sidebarCollapsed ? 'md:ml-20' : 'md:ml-64'
        )}
      >
        <header className="sticky top-0 z-30 h-16 bg-[#0a0e17]/80 backdrop-blur-sm border-b border-[#1a2332] flex items-center justify-between px-4 md:px-6">
          <div className="flex items-center gap-3">
            {isMobile && (
              <button
                onClick={toggleSidebar}
                className="p-2 rounded-lg hover:bg-[#1a2332] transition-colors"
              >
                <Menu className="w-5 h-5 text-gray-400" />
              </button>
            )}
            <h1 className="text-xl font-semibold">
              {navItems.find((item) => item.id === currentPage)?.label}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#1a2332]">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span className="text-xs text-gray-400">系统就绪</span>
            </div>
          </div>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
