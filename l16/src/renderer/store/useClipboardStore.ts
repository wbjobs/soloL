import { create } from 'zustand'
import type { ClipboardItem } from '../../types'

interface ClipboardState {
  items: ClipboardItem[]
  total: number
  currentPage: number
  pageSize: number
  filterType: string
  searchQuery: string
  isLoading: boolean

  setItems: (items: ClipboardItem[], total: number) => void
  setFilterType: (type: string) => void
  setSearchQuery: (query: string) => void
  setCurrentPage: (page: number) => void
  addItem: (item: ClipboardItem) => void
  removeItem: (id: number) => void
  updateItem: (id: number, updates: Partial<ClipboardItem>) => void
  setLoading: (loading: boolean) => void
}

export const useClipboardStore = create<ClipboardState>((set) => ({
  items: [],
  total: 0,
  currentPage: 1,
  pageSize: 50,
  filterType: 'all',
  searchQuery: '',
  isLoading: false,

  setItems: (items, total) => set({ items, total }),
  setFilterType: (filterType) => set({ filterType, currentPage: 1 }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setCurrentPage: (currentPage) => set({ currentPage }),

  addItem: (item) => set((state) => ({
    items: [item, ...state.items].slice(0, state.pageSize),
    total: state.total + 1
  })),

  removeItem: (id) => set((state) => ({
    items: state.items.filter(item => item.id !== id),
    total: state.total - 1
  })),

  updateItem: (id, updates) => set((state) => ({
    items: state.items.map(item =>
      item.id === id ? { ...item, ...updates } : item
    )
  })),

  setLoading: (isLoading) => set({ isLoading })
}))
