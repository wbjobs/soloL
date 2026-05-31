import { contextBridge, ipcRenderer } from 'electron'
import type { ClipboardItem, Snippet, PeerInfo } from '../types'

contextBridge.exposeInMainWorld('electronAPI', {
  clipboard: {
    list: (page: number, pageSize: number, type?: string) =>
      ipcRenderer.invoke('clipboard:list', page, pageSize, type),
    search: (query: string) =>
      ipcRenderer.invoke('clipboard:search', query),
    copy: (id: number) =>
      ipcRenderer.invoke('clipboard:copy', id),
    delete: (id: number) =>
      ipcRenderer.invoke('clipboard:delete', id),
    favorite: (id: number) =>
      ipcRenderer.invoke('clipboard:favorite', id),
    get: (id: number) =>
      ipcRenderer.invoke('clipboard:get', id),
    onNew: (callback: (item: ClipboardItem) => void) =>
      ipcRenderer.on('clipboard:new', (_event, item) => callback(item)),
    onOcrComplete: (callback: (data: { id: number; text: string }) => void) =>
      ipcRenderer.on('ocr:complete', (_event, data) => callback(data)),
  },

  settings: {
    get: (key: string) =>
      ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: string) =>
      ipcRenderer.invoke('settings:set', key, value),
    getAll: () =>
      ipcRenderer.invoke('settings:all'),
  },

  database: {
    vacuum: () =>
      ipcRenderer.invoke('db:vacuum'),
    cleanup: () =>
      ipcRenderer.invoke('db:cleanup'),
    stats: () =>
      ipcRenderer.invoke('db:stats'),
  },

  sync: {
    enable: () =>
      ipcRenderer.invoke('sync:enable'),
    disable: () =>
      ipcRenderer.invoke('sync:disable'),
    peers: () =>
      ipcRenderer.invoke('sync:peers'),
    status: () =>
      ipcRenderer.invoke('sync:status'),
    onPeersChanged: (callback: () => void) =>
      ipcRenderer.on('sync:peers-changed', () => callback()),
  },

  snippets: {
    list: () =>
      ipcRenderer.invoke('snippets:list'),
    get: (id: string) =>
      ipcRenderer.invoke('snippets:get', id),
    create: (name: string, description: string | undefined, items: ClipboardItem[]) =>
      ipcRenderer.invoke('snippets:create', name, description, items),
    update: (snippet: Omit<Snippet, 'createdAt' | 'updatedAt'>) =>
      ipcRenderer.invoke('snippets:update', snippet),
    delete: (id: string) =>
      ipcRenderer.invoke('snippets:delete', id),
    reorder: (snippetId: string, itemOrders: { itemId: string; order: number }[]) =>
      ipcRenderer.invoke('snippets:reorder', snippetId, itemOrders),
    exportMarkdown: (id: string) =>
      ipcRenderer.invoke('snippets:export-markdown', id),
    smartPaste: (id: string) =>
      ipcRenderer.invoke('snippets:smart-paste', id),
    copy: (id: string) =>
      ipcRenderer.invoke('snippets:copy', id),
    onChanged: (callback: () => void) =>
      ipcRenderer.on('snippets:changed', () => callback()),
  },

  window: {
    closeMain: () =>
      ipcRenderer.invoke('window:close-main'),
    closeFloat: () =>
      ipcRenderer.invoke('window:close-float'),
    showSettings: () =>
      ipcRenderer.invoke('window:show-settings'),
    onFocusSearch: (callback: () => void) =>
      ipcRenderer.on('float:focus-search', () => callback()),
    onNavigate: (callback: (route: string) => void) =>
      ipcRenderer.on('navigate', (_event, route) => callback(route)),
  },
})

declare global {
  interface Window {
    electronAPI: {
      clipboard: {
        list: (page: number, pageSize: number, type?: string) => Promise<{ items: ClipboardItem[]; total: number }>
        search: (query: string) => Promise<ClipboardItem[]>
        copy: (id: number) => Promise<boolean>
        delete: (id: number) => Promise<boolean>
        favorite: (id: number) => Promise<boolean>
        get: (id: number) => Promise<ClipboardItem | null>
        onNew: (callback: (item: ClipboardItem) => void) => void
        onOcrComplete: (callback: (data: { id: number; text: string }) => void) => void
      }
      settings: {
        get: (key: string) => Promise<string | null>
        set: (key: string, value: string) => Promise<boolean>
        getAll: () => Promise<Record<string, string>>
      }
      database: {
        vacuum: () => Promise<boolean>
        cleanup: () => Promise<number>
        stats: () => Promise<{ totalCount: number; size: number }>
      }
      sync: {
        enable: () => Promise<boolean>
        disable: () => Promise<boolean>
        peers: () => Promise<PeerInfo[]>
        status: () => Promise<boolean>
        onPeersChanged: (callback: () => void) => void
      }
      snippets: {
        list: () => Promise<Snippet[]>
        get: (id: string) => Promise<Snippet | null>
        create: (name: string, description: string | undefined, items: ClipboardItem[]) => Promise<Snippet | null>
        update: (snippet: Omit<Snippet, 'createdAt' | 'updatedAt'>) => Promise<Snippet | null>
        delete: (id: string) => Promise<boolean>
        reorder: (snippetId: string, itemOrders: { itemId: string; order: number }[]) => Promise<Snippet | null>
        exportMarkdown: (id: string) => Promise<string | null>
        smartPaste: (id: string) => Promise<boolean>
        copy: (id: string) => Promise<boolean>
        onChanged: (callback: () => void) => void
      }
      window: {
        closeMain: () => Promise<boolean>
        closeFloat: () => Promise<boolean>
        showSettings: () => Promise<boolean>
        onFocusSearch: (callback: () => void) => void
        onNavigate: (callback: (route: string) => void) => void
      }
    }
  }
}
