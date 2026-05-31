import React, { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Search, Copy, Check } from 'lucide-react'
import type { ClipboardItem } from '../../../types'
import { truncateText, highlightText } from '../../utils/format.tsx'

const FloatWindow: React.FC = () => {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<ClipboardItem[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [copiedId, setCopiedId] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const searchItems = useCallback(async (searchQuery: string) => {
    if (!window.electronAPI) return

    if (searchQuery.trim()) {
      const items = await window.electronAPI.clipboard.search(searchQuery)
      setResults(items.slice(0, 10))
    } else {
      const result = await window.electronAPI.clipboard.list(1, 10)
      setResults(result.items)
    }
    setSelectedIndex(0)
  }, [])

  useEffect(() => {
    searchItems(query)
  }, [query, searchItems])

  useEffect(() => {
    if (!window.electronAPI) return

    const handleNewItem = (item: ClipboardItem) => {
      setResults(prev => [item, ...prev].slice(0, 10))
    }

    const handleFocus = () => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }

    window.electronAPI.clipboard.onNew(handleNewItem)
    window.electronAPI.window.onFocusSearch(handleFocus)
  }, [])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.electronAPI?.window.closeFloat()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex(prev => Math.min(results.length - 1, prev + 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex(prev => Math.max(0, prev - 1))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = results[selectedIndex]
        if (item) {
          handleCopy(item)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [results, selectedIndex])

  const handleCopy = async (item: ClipboardItem) => {
    if (!window.electronAPI || !item.id) return

    const success = await window.electronAPI.clipboard.copy(item.id)
    if (success) {
      setCopiedId(item.id)
      setTimeout(() => {
        setCopiedId(null)
        window.electronAPI?.window.closeFloat()
      }, 500)
    }
  }

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'text': return 'text-blue-400 bg-blue-500/20'
      case 'image': return 'text-purple-400 bg-purple-500/20'
      case 'file': return 'text-green-400 bg-green-500/20'
      default: return 'text-gray-400 bg-gray-500/20'
    }
  }

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'text': return '文'
      case 'image': return '图'
      case 'file': return '文'
      default: return '?'
    }
  }

  return (
    <div className="h-full flex flex-col glass rounded-3xl overflow-hidden shadow-2xl shadow-black/50">
      <div className="p-4 pb-2">
        <div className="relative">
          <Search
            size={20}
            className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500"
          />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索剪贴板历史..."
            className="w-full pl-12 pr-4 py-3.5 bg-dark-800/50 border border-white/10 rounded-2xl text-gray-200 placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:ring-2 focus:ring-blue-500/20 transition-all text-base"
            autoFocus
          />
        </div>
        <div className="flex items-center justify-between mt-2 px-1">
          <span className="text-xs text-gray-500">
            ↑↓ 选择 · 回车复制 · ESC 关闭
          </span>
          <span className="text-xs text-gray-500">
            {results.length} 条结果
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-3">
        <AnimatePresence mode="popLayout">
          {results.map((item, index) => (
            <motion.div
              key={item.id}
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.1, delay: index * 0.02 }}
              className={`group flex items-center gap-3 p-3 my-1 rounded-xl cursor-pointer transition-all ${
                selectedIndex === index
                  ? 'bg-blue-600/30 border border-blue-500/50'
                  : 'hover:bg-white/5 border border-transparent'
              }`}
              onClick={() => handleCopy(item)}
            >
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-medium ${getTypeColor(item.type)}`}>
                {getTypeLabel(item.type)}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-200 leading-relaxed line-clamp-2">
                  {highlightText(truncateText(item.ocrText || item.content || '', 100), query)}
                </p>
              </div>

              <div className="flex-shrink-0">
                {copiedId === item.id ? (
                  <div className="flex items-center gap-1 text-green-400">
                    <Check size={16} />
                    <span className="text-xs">已复制</span>
                  </div>
                ) : (
                  <Copy size={16} className="text-gray-500 group-hover:text-blue-400 transition-colors" />
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {results.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-500 py-10">
            <div className="text-5xl mb-3">🔍</div>
            <p className="text-sm">没有找到匹配的记录</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default FloatWindow
