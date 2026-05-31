import React, { useCallback, useState, useRef } from 'react';
import { Upload, FileText, X, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import type { MatrixInfo } from '../types';

interface FileUploadProps {
  onUpload: (file: File) => Promise<MatrixInfo>;
  currentMatrix: MatrixInfo | null;
  loading?: boolean;
  error?: string | null;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  onUpload,
  currentMatrix,
  loading,
  error,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      setUploadError(null);

      const file = e.dataTransfer.files[0];
      if (!file) return;

      if (!file.name.endsWith('.mtx')) {
        setUploadError('请上传 Matrix Market 格式文件 (.mtx)');
        return;
      }

      try {
        await onUpload(file);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : '上传失败');
      }
    },
    [onUpload]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setUploadError(null);

      if (!file.name.endsWith('.mtx')) {
        setUploadError('请上传 Matrix Market 格式文件 (.mtx)');
        return;
      }

      try {
        await onUpload(file);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : '上传失败');
      }
    },
    [onUpload]
  );

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="w-full">
      <div
        className={cn(
          'relative border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 cursor-pointer',
          isDragging
            ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-500/20'
            : currentMatrix
              ? 'border-emerald-500/50 bg-emerald-500/5'
              : 'border-slate-700 bg-slate-800/50 hover:border-blue-500/50 hover:bg-slate-800',
          loading && 'opacity-60 pointer-events-none'
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".mtx"
          onChange={handleFileSelect}
          className="hidden"
        />

        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-blue-500/20 flex items-center justify-center animate-pulse">
              <Upload className="w-8 h-8 text-blue-400 animate-bounce" />
            </div>
            <p className="text-slate-300 font-medium">正在解析矩阵文件...</p>
          </div>
        ) : currentMatrix ? (
          <div className="flex flex-col items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
            </div>
            <div className="space-y-2">
              <p className="text-lg font-semibold text-emerald-400">
                {currentMatrix.filename}
              </p>
              <div className="flex flex-wrap justify-center gap-4 text-sm text-slate-400">
                <span className="font-mono bg-slate-700/50 px-3 py-1 rounded-full">
                  {currentMatrix.shape[0].toLocaleString()} × {currentMatrix.shape[1].toLocaleString()}
                </span>
                <span className="font-mono bg-slate-700/50 px-3 py-1 rounded-full">
                  非零元: {currentMatrix.nnz.toLocaleString()}
                </span>
                <span className="font-mono bg-slate-700/50 px-3 py-1 rounded-full">
                  稀疏度: {(currentMatrix.sparsity * 100).toFixed(4)}%
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-16 h-16 rounded-full bg-slate-700/50 flex items-center justify-center">
              <Upload className="w-8 h-8 text-slate-400" />
            </div>
            <div>
              <p className="text-lg font-medium text-slate-200">
                拖拽 Matrix Market 文件到此处
              </p>
              <p className="text-sm text-slate-400 mt-1">
                或点击选择文件 (.mtx 格式，最大 512MB)
              </p>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <FileText className="w-4 h-4" />
              <span>支持 1M × 1M 规模稀疏矩阵</span>
            </div>
          </div>
        )}
      </div>

      {(uploadError || error) && (
        <div className="mt-4 flex items-center gap-2 p-4 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <span className="text-sm">{uploadError || error}</span>
        </div>
      )}
    </div>
  );
};
