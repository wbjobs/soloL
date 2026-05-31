import React from 'react'
import { X, Minus, Settings } from 'lucide-react'

interface TitleBarProps {
  title: string
  showSettings?: boolean
  onClose?: () => void
  onMinimize?: () => void
  onSettings?: () => void
}

const TitleBar: React.FC<TitleBarProps> = ({
  title,
  showSettings = false,
  onClose,
  onMinimize,
  onSettings
}) => {
  return (
    <div className="flex items-center justify-between px-4 py-2 bg-dark-800/80 backdrop-blur-sm border-b border-white/5">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-gradient-to-br from-blue-500 to-cyan-400 shadow-lg shadow-blue-500/30" />
        <span className="text-sm font-medium text-gray-200">{title}</span>
      </div>

      <div className="flex items-center gap-1">
        {showSettings && (
          <button
            onClick={onSettings}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="设置"
          >
            <Settings size={14} className="text-gray-400" />
          </button>
        )}
        {onMinimize && (
          <button
            onClick={onMinimize}
            className="p-1.5 rounded hover:bg-white/10 transition-colors"
            title="最小化"
          >
            <Minus size={14} className="text-gray-400" />
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-red-500/20 transition-colors"
            title="关闭"
          >
            <X size={14} className="text-gray-400 hover:text-red-400" />
          </button>
        )}
      </div>
    </div>
  )
}

export default TitleBar
