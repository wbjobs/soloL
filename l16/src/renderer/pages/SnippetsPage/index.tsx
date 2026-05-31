import React, { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, FileText, Search, CheckSquare, Square } from 'lucide-react'
import SnippetCard from '../../components/SnippetCard'
import SnippetEditor from '../../components/SnippetEditor'
import { useSnippetStore } from '../../store/useSnippetStore'
import { useClipboardStore } from '../../store/useClipboardStore'
import type { ClipboardItem } from '../../../types'

const SnippetsPage: React.FC = () => {
  const { snippets, loadSnippets, deleteSnippet, copySnippet, smartPaste, exportMarkdown, setIsCreating, setEditingSnippet, setIsEditing } = useSnippetStore()
  const { items, setItems } = useClipboardStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedHistoryItems, setSelectedHistoryItems] = useState<Set<number>>(new Set())
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [editingSnippet, setEditingSnippetLocal] = useState<any>(null)
  const [showHistorySelect, setShowHistorySelect] = useState(false)

  useEffect(() => {
    loadSnippets()

    if (window.electronAPI) {
      window.electronAPI.snippets.onChanged(() => {
        loadSnippets()
      })
    }
  }, [loadSnippets])

  useEffect(() => {
    const loadHistory = async () => {
      if (window.electronAPI) {
        const result = await window.electronAPI.clipboard.list(1, 50, 'all')
        setItems(result.items, result.total)
      }
    }
    loadHistory()
  }, [setItems])

  const filteredSnippets = snippets.filter(s =>
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const selectedItems = items.filter(item => item.id !== undefined && selectedHistoryItems.has(item.id)) as ClipboardItem[]

  const handleCreateSnippet = () => {
    if (selectedItems.length === 0) {
      setShowHistorySelect(true)
      return
    }
    setShowCreateDialog(true)
  }

  const handleCloseCreateDialog = () => {
    setShowCreateDialog(false)
    setShowHistorySelect(false)
    setSelectedHistoryItems(new Set())
    setIsCreating(false)
  }

  const handleEditSnippet = (snippet: any) => {
    setEditingSnippetLocal(snippet)
    setEditingSnippet(snippet)
    setIsEditing(true)
    setShowEditDialog(true)
  }

  const handleCloseEditDialog = () => {
    setShowEditDialog(false)
    setEditingSnippetLocal(null)
    setEditingSnippet(null)
    setIsEditing(false)
  }

  const handleExportMarkdown = async (snippet: any) => {
    const markdown = await exportMarkdown(snippet.id)
    if (markdown) {
      const blob = new Blob([markdown], { type: 'text/markdown' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${snippet.name}.md`
      a.click()
      URL.revokeObjectURL(url)
    }
  }

  const toggleHistoryItem = (id: number) => {
    const newSelected = new Set(selectedHistoryItems)
    if (newSelected.has(id)) {
      newSelected.delete(id)
    } else {
      newSelected.add(id)
    }
    setSelectedHistoryItems(newSelected)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 flex flex-col p-6">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <FileText size={24} className="text-purple-400" />
              <h1 className="text-xl font-semibold text-gray-100">我的片段</h1>
            </div>
            <button
              onClick={handleCreateSnippet}
              className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors"
            >
              <Plus size={18} />
              创建片段
            </button>
          </div>

          <div className="relative mb-4">
            <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="搜索片段..."
              className="w-full pl-11 pr-4 py-2.5 bg-dark-700 border border-white/10 rounded-xl text-gray-200 placeholder-gray-500 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          <div className="flex-1 overflow-y-auto">
            {filteredSnippets.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-gray-500">
                <FileText size={48} className="mb-4 opacity-30" />
                <p className="text-lg">暂无片段</p>
                <p className="text-sm">选中多条历史记录，点击"创建片段"开始</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <AnimatePresence mode="popLayout">
                  {filteredSnippets.map(snippet => (
                    <SnippetCard
                      key={snippet.id}
                      snippet={snippet}
                      onEdit={() => handleEditSnippet(snippet)}
                      onDelete={() => deleteSnippet(snippet.id)}
                      onCopy={() => copySnippet(snippet.id)}
                      onSmartPaste={() => smartPaste(snippet.id)}
                      onExport={() => handleExportMarkdown(snippet)}
                    />
                  ))}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>

        {showHistorySelect && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            className="border-l border-white/5 flex flex-col"
          >
            <div className="p-4 border-b border-white/5">
              <h3 className="font-medium text-gray-100 mb-2">选择历史记录</h3>
              <p className="text-xs text-gray-500">
                已选择 {selectedHistoryItems.size} 项
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <div className="space-y-2">
                {items.map(item => (
                  <div
                    key={item.id}
                    onClick={() => item.id !== undefined && toggleHistoryItem(item.id)}
                    className="flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-colors hover:bg-white/5"
                  >
                    {item.id !== undefined && selectedHistoryItems.has(item.id) ? (
                      <CheckSquare size={16} className="text-purple-400 flex-shrink-0 mt-0.5" />
                    ) : (
                      <Square size={16} className="text-gray-600 flex-shrink-0 mt-0.5" />
                    )}
                    <p className="text-sm text-gray-300 line-clamp-2">
                      {item.content?.slice(0, 80) || '（无内容）'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 border-t border-white/5">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setShowHistorySelect(false)}
                  className="flex-1 px-4 py-2 rounded-xl text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={() => {
                    setShowCreateDialog(true)
                  }}
                  disabled={selectedHistoryItems.size === 0}
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  下一步
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </div>

      <SnippetEditor
        isOpen={showCreateDialog}
        onClose={handleCloseCreateDialog}
        mode="create"
        selectedItems={selectedItems}
      />

      <SnippetEditor
        isOpen={showEditDialog}
        onClose={handleCloseEditDialog}
        mode="edit"
        snippet={editingSnippet}
      />
    </div>
  )
}

export default SnippetsPage
