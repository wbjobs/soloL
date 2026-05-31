import { create } from 'zustand'
import type { Snippet, ClipboardItem } from '../../types'

interface SnippetStore {
  snippets: Snippet[]
  selectedIds: Set<number>
  isCreating: boolean
  isEditing: boolean
  editingSnippet: Snippet | null

  loadSnippets: () => Promise<void>
  setSelectedIds: (ids: Set<number>) => void
  toggleSelected: (id: number) => void
  clearSelection: () => void
  createSnippet: (name: string, description: string | undefined, items: ClipboardItem[]) => Promise<Snippet | null>
  updateSnippet: (snippet: Omit<Snippet, 'createdAt' | 'updatedAt'>) => Promise<Snippet | null>
  deleteSnippet: (id: string) => Promise<boolean>
  reorderItems: (snippetId: string, itemOrders: { itemId: string; order: number }[]) => Promise<Snippet | null>
  exportMarkdown: (id: string) => Promise<string | null>
  smartPaste: (id: string) => Promise<boolean>
  copySnippet: (id: string) => Promise<boolean>
  setIsCreating: (value: boolean) => void
  setIsEditing: (value: boolean) => void
  setEditingSnippet: (snippet: Snippet | null) => void
}

export const useSnippetStore = create<SnippetStore>((set, get) => ({
  snippets: [],
  selectedIds: new Set(),
  isCreating: false,
  isEditing: false,
  editingSnippet: null,

  loadSnippets: async () => {
    if (!window.electronAPI) return
    const snippets = await window.electronAPI.snippets.list()
    set({ snippets })
  },

  setSelectedIds: (ids: Set<number>) => {
    set({ selectedIds: ids })
  },

  toggleSelected: (id: number) => {
    const { selectedIds } = get()
    const newIds = new Set(selectedIds)
    if (newIds.has(id)) {
      newIds.delete(id)
    } else {
      newIds.add(id)
    }
    set({ selectedIds: newIds })
  },

  clearSelection: () => {
    set({ selectedIds: new Set() })
  },

  createSnippet: async (name: string, description: string | undefined, items: ClipboardItem[]) => {
    if (!window.electronAPI) return null
    const snippet = await window.electronAPI.snippets.create(name, description, items)
    if (snippet) {
      const { snippets } = get()
      set({ snippets: [snippet, ...snippets] })
    }
    return snippet
  },

  updateSnippet: async (snippet: Omit<Snippet, 'createdAt' | 'updatedAt'>) => {
    if (!window.electronAPI) return null
    const updated = await window.electronAPI.snippets.update(snippet)
    if (updated) {
      const { snippets } = get()
      set({
        snippets: snippets.map(s => s.id === updated.id ? updated : s)
      })
    }
    return updated
  },

  deleteSnippet: async (id: string) => {
    if (!window.electronAPI) return false
    const success = await window.electronAPI.snippets.delete(id)
    if (success) {
      const { snippets } = get()
      set({ snippets: snippets.filter(s => s.id !== id) })
    }
    return success
  },

  reorderItems: async (snippetId: string, itemOrders: { itemId: string; order: number }[]) => {
    if (!window.electronAPI) return null
    const updated = await window.electronAPI.snippets.reorder(snippetId, itemOrders)
    if (updated) {
      const { snippets } = get()
      set({
        snippets: snippets.map(s => s.id === updated.id ? updated : s)
      })
    }
    return updated
  },

  exportMarkdown: async (id: string) => {
    if (!window.electronAPI) return null
    return window.electronAPI.snippets.exportMarkdown(id)
  },

  smartPaste: async (id: string) => {
    if (!window.electronAPI) return false
    return window.electronAPI.snippets.smartPaste(id)
  },

  copySnippet: async (id: string) => {
    if (!window.electronAPI) return false
    return window.electronAPI.snippets.copy(id)
  },

  setIsCreating: (value: boolean) => {
    set({ isCreating: value })
  },

  setIsEditing: (value: boolean) => {
    set({ isEditing: value })
  },

  setEditingSnippet: (snippet: Snippet | null) => {
    set({ editingSnippet: snippet })
  }
}))
