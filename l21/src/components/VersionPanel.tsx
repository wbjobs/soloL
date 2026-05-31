import { useState, useCallback, useMemo } from 'react';
import { History, Save, RotateCcw, GitCompare, Plus, X, FileText, User, Clock } from 'lucide-react';
import { useCollaborationStore } from '../store/useCollaborationStore';
import { useWebRTC } from '../hooks/useWebRTC';
import { computeDiff, formatDiffForDisplay, type DiffChange } from '../utils/diffUtils';
import type { ScoreVersion } from '../../shared/types';
import { cn } from '../lib/utils';

interface VersionPanelProps {
  className?: string;
  roomId?: string;
}

function VersionDiffView({ oldContent, newContent }: { oldContent: string; newContent: string }) {
  const changes = useMemo(() => {
    const diffs = computeDiff(oldContent, newContent);
    return formatDiffForDisplay(diffs);
  }, [oldContent, newContent]);

  const renderChange = (change: DiffChange) => {
    const bgColor = change.type === 'insert' ? 'bg-green-50' : change.type === 'delete' ? 'bg-red-50' : 'bg-white';
    const textColor = change.type === 'insert' ? 'text-green-700' : change.type === 'delete' ? 'text-red-700' : 'text-gray-700';
    const borderColor = change.type === 'insert' ? 'border-green-200' : change.type === 'delete' ? 'border-red-200' : 'border-gray-100';

    return (
      <div key={change.startLine} className={cn('border-l-2', borderColor, bgColor, 'px-2 py-0.5')}>
        <pre className={cn('whitespace-pre-wrap break-all font-mono text-xs', textColor)}>
          {change.text}
        </pre>
      </div>
    );
  };

  return (
    <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
      {changes.map(renderChange)}
    </div>
  );
}

function VersionItem({
  version,
  isCurrent,
  onRollback,
  onCompare,
  isComparing,
}: {
  version: ScoreVersion;
  isCurrent: boolean;
  onRollback: (v: ScoreVersion) => void;
  onCompare: (v: ScoreVersion) => void;
  isComparing: boolean;
}) {
  const formattedDate = new Date(version.createdAt).toLocaleString('zh-CN');

  return (
    <div className="relative pl-8 pb-4 last:pb-0">
      <div className="absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white bg-indigo-100">
        <div className={cn('h-2 w-2 rounded-full', isCurrent ? 'bg-indigo-600' : 'bg-indigo-400')} />
      </div>
      {!isCurrent && <div className="absolute left-[9px] top-6 h-full w-px bg-gray-200" />}

      <div
        className={cn(
          'rounded-lg border p-3 transition-all',
          isCurrent
            ? 'border-indigo-200 bg-indigo-50'
            : isComparing
              ? 'border-yellow-200 bg-yellow-50'
              : 'border-gray-100 bg-white hover:border-gray-200 hover:bg-gray-50'
        )}
      >
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                v{version.version}
              </span>
              {isCurrent && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                  当前
                </span>
              )}
            </div>
            <p className="mt-1.5 truncate text-sm font-medium text-gray-900">{version.message}</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-gray-500">
              <span className="flex items-center gap-1">
                <User className="h-3 w-3" />
                {version.userName}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {formattedDate}
              </span>
            </div>
          </div>
          <div className="ml-2 flex flex-col gap-1">
            {!isCurrent && (
              <>
                <button
                  onClick={() => onCompare(version)}
                  className={cn(
                    'rounded p-1 text-gray-400 hover:text-indigo-600 transition-colors',
                    isComparing && 'text-indigo-600 bg-indigo-50'
                  )}
                  title="对比版本"
                >
                  <GitCompare className="h-4 w-4" />
                </button>
                <button
                  onClick={() => onRollback(version)}
                  className="rounded p-1 text-gray-400 hover:text-red-600 transition-colors"
                  title="回滚到此版本"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function VersionPanel({ className, roomId }: VersionPanelProps) {
  const { versions, content, version: currentVersion, currentUser } = useCollaborationStore();
  const { sendSaveVersion } = useWebRTC({ userId: currentUser?.id || '', roomId: roomId || '' });
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [compareVersion, setCompareVersion] = useState<ScoreVersion | null>(null);

  const handleSaveVersion = useCallback(async () => {
    if (!saveMessage.trim()) return;
    setIsSaving(true);
    try {
      sendSaveVersion(content, saveMessage.trim());
      setSaveMessage('');
      setIsSaving(false);
    } catch (error) {
      console.error('Failed to save version:', error);
      setIsSaving(false);
    }
  }, [content, saveMessage, sendSaveVersion]);

  const handleRollback = useCallback((version: ScoreVersion) => {
    if (confirm(`确定要回滚到版本 v${version.version} 吗？`)) {
      sendSaveVersion(version.content, `回滚到 v${version.version}`);
    }
  }, [sendSaveVersion]);

  const handleCompare = useCallback((version: ScoreVersion) => {
    setCompareVersion((prev) => (prev?.id === version.id ? null : version));
  }, []);

  const currentContent = useMemo(() => {
    const current = versions.find((v) => v.version === currentVersion);
    return current?.content || content;
  }, [versions, currentVersion, content]);

  return (
    <div className={cn('flex h-full flex-col rounded-lg border border-gray-200 bg-white', className)}>
      <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-indigo-500" />
          <span className="text-sm font-medium text-gray-700">版本历史</span>
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-600">
            {versions.length}
          </span>
        </div>
      </div>

      <div className="border-b border-gray-200 p-4">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <FileText className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={saveMessage}
              onChange={(e) => setSaveMessage(e.target.value)}
              placeholder="输入版本备注..."
              className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:outline-none focus:ring-2 focus:ring-indigo-100"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSaveVersion();
                }
              }}
            />
          </div>
          <button
            onClick={handleSaveVersion}
            disabled={!saveMessage.trim() || isSaving}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-all',
              saveMessage.trim() && !isSaving
                ? 'bg-indigo-600 text-white hover:bg-indigo-700'
                : 'cursor-not-allowed bg-gray-100 text-gray-400'
            )}
          >
            {isSaving ? (
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            保存
          </button>
        </div>
      </div>

      {compareVersion && (
        <div className="border-b border-gray-200 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              版本对比: v{compareVersion.version} → v{currentVersion}
            </span>
            <button
              onClick={() => setCompareVersion(null)}
              className="rounded p-1 text-gray-400 hover:text-gray-600 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <VersionDiffView oldContent={compareVersion.content} newContent={currentContent} />
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4">
        {versions.length > 0 ? (
          <div>
            {versions.map((version) => (
              <VersionItem
                key={version.id}
                version={version}
                isCurrent={version.version === currentVersion}
                onRollback={handleRollback}
                onCompare={handleCompare}
                isComparing={compareVersion?.id === version.id}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Save className="mb-2 h-10 w-10" />
            <p className="text-sm">暂无版本记录</p>
            <p className="mt-1 text-xs">保存第一个版本开始追踪变更</p>
          </div>
        )}
      </div>
    </div>
  );
}
