import React from 'react'
import { Copy, Trash2, Edit, FileText, Download, Sparkles } from 'lucide-react'
import { motion } from 'framer-motion'
import type { Snippet } from '../../types'
import { formatTime } from '../utils/format.tsx'

interface SnippetCardProps {
  snippet: Snippet
  onEdit: () => void
  onDelete: () => void
  onCopy: () => void
  onSmartPaste: () => void
  onExport: () => void
}

const SnippetCard: React.FC<SnippetCardProps> = ({
  snippet,
  onEdit,
  onDelete,
  onCopy,
  onSmartPaste,
  onExport
}) => {
  const preview = snippet.items
    .filter(i => i.type === 'text')
    .map(i => i.content || '')
    .join(' ')
    .slice(0, 150)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className="group p-4 rounded-xl glass-light hover:bg-white/10 transition-all duration-200 border border-transparent hover:border-purple-500/30"
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-purple-400" />
          <h3 className="font-medium text-gray-100 truncate max-w-[200px]">
            {snippet.name}
          </h3>
        </div>
        <span className="text-xs text-gray-500">
          {formatTime(snippet.updatedAt)}
        </span>
      </div>

      {snippet.description && (
        <p className="text-xs text-gray-400 mb-2 line-clamp-2">
          {snippet.description}
        </p>
      )}

      <p className="text-sm text-gray-300 line-clamp-2 mb-3">
        {preview || '（无文本内容）'}
      </p>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
            {snippet.items.length} 项
          </span>
          <span className="text-xs text-gray-500">
            v{snippet.version}
          </span>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={onSmartPaste}
            className="p-1.5 rounded-lg hover:bg-green-500/20 text-gray-400 hover:text-green-400 transition-colors"
            title="智能粘贴"
          >
            <Sparkles size={14} />
          </button>
          <button
            onClick={onCopy}
            className="p-1.5 rounded-lg hover:bg-blue-500/20 text-gray-400 hover:text-blue-400 transition-colors"
            title="复制"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={onExport}
            className="p-1.5 rounded-lg hover:bg-yellow-500/20 text-gray-400 hover:text-yellow-400 transition-colors"
            title="导出Markdown"
          >
            <Download size={14} />
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-purple-500/20 text-gray-400 hover:text-purple-400 transition-colors"
            title="编辑"
          >
            <Edit size={14} />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
            title="删除"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </motion.div>
  )
}

export default SnippetCard
