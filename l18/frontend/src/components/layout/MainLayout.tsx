import { Outlet } from 'react-router-dom';
import TopToolbar from './TopToolbar';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
  showToolbar?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export default function MainLayout({ showToolbar = true, className, children }: MainLayoutProps) {
  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      {showToolbar && <TopToolbar />}
      <main className="flex-1 overflow-hidden">
        {children || <Outlet />}
      </main>
    </div>
  );
}
