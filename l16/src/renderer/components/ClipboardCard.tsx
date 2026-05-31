import React from 'react'
import { Copy, Trash2, Star, FileText, Image, File } from 'lucide-react'
import { motion } from 'framer-motion'
import type { ClipboardItem } from '../../types'
import { formatTime, truncateText, highlightText } from '../utils/format.tsx'

interface ClipboardCardProps {
  item: ClipboardItem
  searchQuery?: string
  onCopy: () => void
  onDelete: () => void
  onFavorite: () => void
  onDoubleClick?: () => void
}

const ClipboardCard: React.FC<ClipboardCardProps> = ({
  item,
  searchQuery = '',
  onCopy,
  onDelete,
  onFavorite,
  onDoubleClick
}) => {
  const getTypeIcon = () => {
    switch (item.type) {
      case 'text':
        return <FileText size={16} className="text-blue-400" />
      case 'image':
        return <Image size={16} className="text-purple-400" />
      case 'file':
        return <File size={16} className="text-green-400" />
      default:
        return <FileText size={16} className="text-gray-400" />
    }
  }

  const getTypeLabel = () => {
    switch (item.type) {
      case 'text': return '文本'
      case 'image': return '图片'
      case 'file': return '文件'
      default: return '未知'
    }
  }

  const displayContent = item.ocrText || item.content || ''

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className="group p-3 rounded-xl glass-light hover:bg-white/10 transition-all duration-200 cursor-pointer border border-transparent hover:border-blue-500/30"
      onDoubleClick={onDoubleClick}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 mt-0.5">
          {getTypeIcon()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs px-2 py-0.5 rounded-full bg-dark-700 text-gray-400">
              {getTypeLabel()}
            </span>
            <span className="text-xs text-gray-500">
              {formatTime(item.createdAt)}
            </span>
            {item.ocrText && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300">
                OCR
              </span>
            )}
          </div>

          <p className="text-sm text-gray-300 leading-relaxed line-clamp-3">
            {highlightText(truncateText(displayContent, 200), searchQuery)}
          </p>
        </div>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onFavorite() }}
            className={`p-1.5 rounded-lg transition-colors ${
              item.isFavorite
                ? 'bg-yellow-500/20 text-yellow-400'
                : 'hover:bg-white/10 text-gray-400'
            }`}
            title={item.isFavorite ? '取消收藏' : '收藏'}
          >
            <Star size={14} fill={item.isFavorite ? 'currentColor' : 'none'} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onCopy() }}
            className="p-1.5 rounded-lg hover:bg-blue-500/20 text-gray-400 hover:text-blue-400 transition-colors"
            title="复制"
          >
            <Copy size={14} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
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

export default ClipboardCard
