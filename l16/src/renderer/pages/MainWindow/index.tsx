import React, { useEffect, useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ClipboardList, FileText, Settings } from 'lucide-react'
import TitleBar from '../../components/TitleBar'
import SearchInput from '../../components/SearchInput'
import TypeFilter from '../../components/TypeFilter'
import ClipboardCard from '../../components/ClipboardCard'
import SnippetsPage from '../SnippetsPage'
import SettingsPage from '../SettingsPage'
import { useClipboardStore } from '../../store/useClipboardStore'
import type { ClipboardItem } from '../../../types'

type TabType = 'history' | 'snippets' | 'settings'

const MainWindow: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('history')
  const {
    items,
    total,
    currentPage,
    pageSize,
    filterType,
    searchQuery,
    setItems,
    setFilterType,
    setSearchQuery,
    setCurrentPage,
    addItem,
    removeItem,
    updateItem
  } = useClipboardStore()

  const [isSearching, setIsSearching] = useState(false)

  const loadItems = useCallback(async () => {
    if (!window.electronAPI) return

    if (searchQuery.trim()) {
      setIsSearching(true)
      const results = await window.electronAPI.clipboard.search(searchQuery)
      setItems(results, results.length)
      setIsSearching(false)
    } else {
      const result = await window.electronAPI.clipboard.list(currentPage, pageSize, filterType)
      setItems(result.items, result.total)
    }
  }, [currentPage, pageSize, filterType, searchQuery, setItems])

  useEffect(() => {
    if (activeTab === 'history') {
      loadItems()
    }
  }, [activeTab, loadItems])

  useEffect(() => {
    if (!window.electronAPI) return

    const handleNewItem = (item: ClipboardItem) => {
      if (filterType === 'all' || filterType === item.type) {
        addItem(item)
      }
    }

    const handleOcrComplete = (data: { id: number; text: string }) => {
      updateItem(data.id, { ocrText: data.text })
    }

    const handleNavigate = (route: string) => {
      if (route === 'settings') {
        setActiveTab('settings')
      }
    }

    window.electronAPI.clipboard.onNew(handleNewItem)
    window.electronAPI.clipboard.onOcrComplete(handleOcrComplete)
    window.electronAPI.window.onNavigate(handleNavigate)
  }, [filterType, addItem, updateItem])

  const handleCopy = async (id: number) => {
    if (!window.electronAPI) return
    await window.electronAPI.clipboard.copy(id)
  }

  const handleDelete = async (id: number) => {
    if (!window.electronAPI) return
    const success = await window.electronAPI.clipboard.delete(id)
    if (success) {
      removeItem(id)
    }
  }

  const handleFavorite = async (id: number) => {
    if (!window.electronAPI) return
    const success = await window.electronAPI.clipboard.favorite(id)
    if (success) {
      const item = items.find(i => i.id === id)
      if (item) {
        updateItem(id, { isFavorite: !item.isFavorite })
      }
    }
  }

  const handleClose = () => {
    window.electronAPI?.window.closeMain()
  }

  const totalPages = Math.ceil(total / pageSize)

  const tabs = [
    { id: 'history', label: '历史记录', icon: ClipboardList },
    { id: 'snippets', label: '片段', icon: FileText },
    { id: 'settings', label: '设置', icon: Settings }
  ]

  return (
    <div className="h-full flex flex-col glass rounded-2xl overflow-hidden">
      <TitleBar
        title="ClipMaster - 剪贴板管理器"
        onClose={handleClose}
      />

      <div className="flex-1 flex overflow-hidden">
        <div className="w-48 p-4 border-r border-white/5 flex flex-col">
          <div className="space-y-1">
            {tabs.map((tab) => {
              const Icon = tab.icon
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as TabType)}
                  className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm transition-all ${
                    activeTab === tab.id
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-white/5'
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <AnimatePresence mode="wait">
            {activeTab === 'history' && (
              <motion.div
                key="history"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full flex flex-col p-4"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="flex-1">
                    <SearchInput
                      value={searchQuery}
                      onChange={setSearchQuery}
                      placeholder="搜索剪贴板历史（支持全文检索）..."
                    />
                  </div>
                  <TypeFilter value={filterType} onChange={setFilterType} />
                </div>

                <div className="flex items-center justify-between mb-3">
                  <span className="text-sm text-gray-400">
                    共 {total} 条记录
                    {isSearching && <span className="ml-2 text-accent-400">搜索中...</span>}
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto pr-2">
                  <AnimatePresence mode="popLayout">
                    <div className="space-y-2">
                      {items.map((item) => (
                        <ClipboardCard
                          key={item.id}
                          item={item}
                          searchQuery={searchQuery}
                          onCopy={() => handleCopy(item.id!)}
                          onDelete={() => handleDelete(item.id!)}
                          onFavorite={() => handleFavorite(item.id!)}
                          onDoubleClick={() => handleCopy(item.id!)}
                        />
                      ))}
                    </div>
                  </AnimatePresence>

                  {items.length === 0 && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="h-full flex flex-col items-center justify-center text-gray-500"
                    >
                      <div className="text-6xl mb-4">📋</div>
                      <p className="text-lg">暂无剪贴板记录</p>
                      <p className="text-sm mt-1">复制一些内容试试吧</p>
                    </motion.div>
                  )}
                </div>

                {!searchQuery && totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-4 pt-4 border-t border-white/5">
                    <button
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 text-sm rounded-lg bg-dark-700 text-gray-300 hover:bg-dark-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      上一页
                    </button>
                    <span className="text-sm text-gray-400">
                      {currentPage} / {totalPages}
                    </span>
                    <button
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 text-sm rounded-lg bg-dark-700 text-gray-300 hover:bg-dark-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      下一页
                    </button>
                  </div>
                )}
              </motion.div>
            )}

            {activeTab === 'snippets' && (
              <motion.div
                key="snippets"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <SnippetsPage />
              </motion.div>
            )}

            {activeTab === 'settings' && (
              <motion.div
                key="settings"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="h-full"
              >
                <SettingsPage />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

export default MainWindow
