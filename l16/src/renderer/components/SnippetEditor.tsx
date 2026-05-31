import React, { useState, useEffect } from 'react'
import { X, GripVertical, Plus, Trash2 } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import type { Snippet, SnippetItem, ClipboardItem } from '../../types'
import { useSnippetStore } from '../store/useSnippetStore'

interface SnippetEditorProps {
  isOpen: boolean
  onClose: () => void
  mode: 'create' | 'edit'
  snippet?: Snippet | null
  selectedItems?: ClipboardItem[]
}

const SnippetEditor: React.FC<SnippetEditorProps> = ({
  isOpen,
  onClose,
  mode,
  snippet,
  selectedItems = []
}) => {
  const { createSnippet, updateSnippet } = useSnippetStore()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [items, setItems] = useState<(SnippetItem | ClipboardItem)[]>([])
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null)

  useEffect(() => {
    if (isOpen) {
      if (mode === 'edit' && snippet) {
        setName(snippet.name)
        setDescription(snippet.description || '')
        setItems(snippet.items)
      } else if (mode === 'create') {
        setName('')
        setDescription('')
        setItems(selectedItems.map((item, index) => ({
          ...item,
          id: String(item.id || `temp-${index}`),
          order: index
        })))
      }
    }
  }, [isOpen, mode, snippet, selectedItems])

  const handleSave = async () => {
    if (!name.trim()) return

    const snippetItems: SnippetItem[] = items.map((item, index) => ({
      id: 'id' in item ? String(item.id) : `item-${index}`,
      type: item.type,
      content: item.content,
      imagePath: 'imagePath' in item ? item.imagePath : undefined,
      order: index
    }))

    if (mode === 'create') {
      await createSnippet(name, description || undefined, selectedItems)
    } else if (mode === 'edit' && snippet) {
      await updateSnippet({
        ...snippet,
        name,
        description: description || undefined,
        items: snippetItems
      })
    }

    onClose()
  }

  const handleDragStart = (index: number) => {
    setDraggedIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    if (draggedIndex === null || draggedIndex === index) return

    const newItems = [...items]
    const [draggedItem] = newItems.splice(draggedIndex, 1)
    newItems.splice(index, 0, draggedItem)
    setItems(newItems)
    setDraggedIndex(index)
  }

  const handleDragEnd = () => {
    setDraggedIndex(null)
  }

  const handleRemoveItem = (index: number) => {
    const newItems = [...items]
    newItems.splice(index, 1)
    setItems(newItems)
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.9, opacity: 0 }}
          className="w-full max-w-lg mx-4 rounded-2xl glass p-6"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-gray-100">
              {mode === 'create' ? '创建片段' : '编辑片段'}
            </h2>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-white/10 text-gray-400 hover:text-gray-200 transition-colors"
            >
              <X size={20} />
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm text-gray-300 mb-2">名称</label>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="输入片段名称..."
                className="w-full px-4 py-2 bg-dark-700 border border-white/10 rounded-xl text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">备注（可选）</label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="添加备注..."
                rows={2}
                className="w-full px-4 py-2 bg-dark-700 border border-white/10 rounded-xl text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm text-gray-300 mb-2">
                内容项（拖拽排序）
              </label>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {items.map((item, index) => (
                  <motion.div
                    key={`id` in item ? item.id : index}
                    draggable
                    onDragStart={() => handleDragStart(index)}
                    onDragOver={e => handleDragOver(e, index)}
                    onDragEnd={handleDragEnd}
                    className={`flex items-center gap-2 p-3 rounded-xl bg-dark-700/50 border transition-all cursor-move ${
                      draggedIndex === index
                        ? 'border-purple-500/50 bg-purple-500/10'
                        : 'border-white/5 hover:border-white/10'
                    }`}
                  >
                    <GripVertical size={16} className="text-gray-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-300 truncate">
                        {item.content?.slice(0, 80) || '（无内容）'}
                      </p>
                    </div>
                    {items.length > 1 && (
                      <button
                        onClick={() => handleRemoveItem(index)}
                        className="p-1 rounded-lg hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-colors flex-shrink-0"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </motion.div>
                ))}

                {items.length === 0 && (
                  <div className="p-8 text-center text-gray-500 text-sm">
                    <Plus size={32} className="mx-auto mb-2 opacity-50" />
                    <p>暂无内容项</p>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 mt-6">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!name.trim() || items.length === 0}
              className="px-6 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mode === 'create' ? '创建' : '保存'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default SnippetEditor
