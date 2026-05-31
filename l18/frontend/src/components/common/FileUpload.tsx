import { useCallback, useRef } from 'react';
import { Upload, File } from 'lucide-react';
import { cn } from '@/lib/utils';
import Button from './Button';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  accept?: string;
  multiple?: boolean;
  className?: string;
  maxSize?: number;
}

export default function FileUpload({
  onFileSelect,
  accept = '.las,.laz,.ply,.xyz',
  multiple = false,
  className,
  maxSize = 500 * 1024 * 1024,
}: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const files = Array.from(e.dataTransfer.files);
      files.forEach((file) => {
        if (file.size <= maxSize) {
          onFileSelect(file);
        }
      });
    },
    [onFileSelect, maxSize]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    files.forEach((file) => {
      if (file.size <= maxSize) {
        onFileSelect(file);
      }
    });
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const handleClick = () => {
    inputRef.current?.click();
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  };

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className={cn(
        'relative border-2 border-dashed border-surface-border rounded-lg p-8 text-center hover:border-primary/50 transition-colors cursor-pointer group',
        className
      )}
      onClick={handleClick}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        onChange={handleChange}
        className="hidden"
      />
      <div className="flex flex-col items-center gap-3">
        <div className="p-4 rounded-full bg-surface group-hover:bg-primary/10 transition-colors">
          <Upload size={32} className="text-primary" />
        </div>
        <div>
          <p className="text-white font-medium">点击或拖拽文件到此处</p>
          <p className="text-sm text-gray-400 mt-1">
            支持 {accept} 格式，最大 {formatSize(maxSize)}
          </p>
        </div>
        <Button variant="primary" size="sm" className="mt-2">
          <File size={16} className="mr-2" />
          选择文件
        </Button>
      </div>
    </div>
  );
}
