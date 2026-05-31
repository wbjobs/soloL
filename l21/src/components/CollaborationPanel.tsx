import { useMemo, useState, useCallback } from 'react';
import { Users, Copy, Check, Lock, Wifi, WifiOff, User } from 'lucide-react';
import { useCollaborationStore } from '../store/useCollaborationStore';
import { useWebRTC } from '../hooks/useWebRTC';
import type { User as UserType, LockedSection } from '../../shared/types';
import { cn } from '../lib/utils';

interface CollaborationPanelProps {
  className?: string;
  roomId?: string;
}

function UserAvatar({ user, showCursor = false }: { user: UserType; showCursor?: boolean }) {
  return (
    <div className="group relative">
      <div
        className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium text-white shadow-sm transition-transform group-hover:scale-110"
        style={{ backgroundColor: user.color }}
      >
        {user.name.charAt(0).toUpperCase()}
      </div>
      <div className="absolute -bottom-1 -right-1 h-3 w-3 rounded-full border-2 border-white bg-green-500" />
      {showCursor && user.cursor && (
        <div className="absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
          行 {user.cursor.line + 1}, 列 {user.cursor.ch + 1}
        </div>
      )}
    </div>
  );
}

function LockedSectionItem({ section }: { section: LockedSection }) {
  const expiresIn = Math.max(0, Math.ceil((section.expiresAt - Date.now()) / 1000 / 60));

  return (
    <div className="rounded-lg border border-red-100 bg-red-50 p-3">
      <div className="flex items-start gap-2">
        <Lock className="mt-0.5 h-4 w-4 text-red-500 flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-red-800">
              第 {section.startLine + 1} - {section.endLine + 1} 行
            </span>
            {expiresIn > 0 && (
              <span className="text-xs text-red-500">{expiresIn}分钟后过期</span>
            )}
          </div>
          <p className="mt-1 text-xs text-red-600">
            由 <span className="font-medium">{section.lockedByUserName}</span> 锁定
          </p>
        </div>
      </div>
    </div>
  );
}

export default function CollaborationPanel({ className, roomId }: CollaborationPanelProps) {
  const { users, lockedSections, currentUser, connectionStatus } = useCollaborationStore();
  const { peers } = useWebRTC({ userId: currentUser?.id || '', roomId: roomId || '' });
  const [copied, setCopied] = useState(false);

  const connectionCount = useMemo(() => {
    let count = 0;
    peers.forEach((peer) => {
      if (peer.status === 'connected') count++;
    });
    return count;
  }, [peers]);

  const handleCopyLink = useCallback(async () => {
    if (!roomId) return;
    const url = `${window.location.origin}/room/${roomId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  }, [roomId]);

  const statusConfig = useMemo(() => {
    const configs = {
      connected: { icon: Wifi, color: 'text-green-500', bg: 'bg-green-50', label: '已连接' },
      connecting: { icon: Wifi, color: 'text-yellow-500', bg: 'bg-yellow-50', label: '连接中...' },
      disconnected: { icon: WifiOff, color: 'text-gray-500', bg: 'bg-gray-50', label: '未连接' },
      error: { icon: WifiOff, color: 'text-red-500', bg: 'bg-red-50', label: '连接错误' },
    };
    return configs[connectionStatus] || configs.disconnected;
  }, [connectionStatus]);

  const StatusIcon = statusConfig.icon;

  return (
    <div className={cn('flex h-full flex-col rounded-lg border border-gray-200 bg-white', className)}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">协作者</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-600">
            {users.length}
          </span>
        </div>
        <div className={cn('flex items-center gap-1.5 rounded-full px-2 py-1', statusConfig.bg)}>
          <StatusIcon className={cn('h-3.5 w-3.5', statusConfig.color)} />
          <span className={cn('text-xs font-medium', statusConfig.color)}>
            {statusConfig.label}
          </span>
          <span className="text-xs text-gray-500">({connectionCount})</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="p-4">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
            在线用户
          </h4>
          <div className="space-y-2">
            {users.map((user) => (
              <div
                key={user.id}
                className={cn(
                  'flex items-center gap-3 rounded-lg p-2 transition-colors',
                  user.id === currentUser?.id ? 'bg-indigo-50' : 'hover:bg-gray-50'
                )}
              >
                <UserAvatar user={user} showCursor />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-gray-900">
                      {user.name}
                    </span>
                    {user.id === currentUser?.id && (
                      <span className="text-xs text-indigo-600">(你)</span>
                    )}
                  </div>
                  {user.cursor && (
                    <p className="text-xs text-gray-500">
                      行 {user.cursor.line + 1}, 列 {user.cursor.ch + 1}
                    </p>
                  )}
                </div>
              </div>
            ))}
            {users.length === 0 && (
              <div className="flex flex-col items-center justify-center py-8 text-gray-400">
                <User className="mb-2 h-8 w-8" />
                <p className="text-sm">暂无协作者</p>
              </div>
            )}
          </div>
        </div>

        {lockedSections.length > 0 && (
          <div className="border-t border-gray-200 p-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">
              锁定片段
            </h4>
            <div className="space-y-2">
              {lockedSections.map((section) => (
                <LockedSectionItem key={section.id} section={section} />
              ))}
            </div>
          </div>
        )}
      </div>

      {roomId && (
        <div className="border-t border-gray-200 p-4">
          <button
            onClick={handleCopyLink}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-all',
              copied
                ? 'bg-green-100 text-green-700'
                : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'
            )}
          >
            {copied ? (
              <>
                <Check className="h-4 w-4" />
                已复制链接
              </>
            ) : (
              <>
                <Copy className="h-4 w-4" />
                复制房间链接
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
