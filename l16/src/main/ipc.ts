import { ipcMain, BrowserWindow, clipboard } from 'electron'
import { db } from './database'
import { clipboardMonitor } from './clipboard'
import { ocrService } from './ocr'
import { scheduler } from './scheduler'
import { syncService } from './sync'
import { snippetService } from './snippetService'
import { getActiveWindowTitle } from './windowDetector'
import type { ClipboardItem, Snippet } from '../types'

export function setupIpcHandlers(mainWindow: BrowserWindow | null, floatWindow: BrowserWindow | null) {
  ipcMain.handle('clipboard:list', async (_event, page: number = 1, pageSize: number = 50, type?: string) => {
    return db.getClipboardList(page, pageSize, type)
  })

  ipcMain.handle('clipboard:search', async (_event, query: string) => {
    return db.searchClipboard(query)
  })

  ipcMain.handle('clipboard:copy', async (_event, id: number) => {
    const item = db.getClipboardById(id)
    if (!item) return false
    return clipboardMonitor.copyToClipboard(item)
  })

  ipcMain.handle('clipboard:delete', async (_event, id: number) => {
    return db.deleteClipboard(id)
  })

  ipcMain.handle('clipboard:favorite', async (_event, id: number) => {
    return db.toggleFavorite(id)
  })

  ipcMain.handle('clipboard:get', async (_event, id: number) => {
    return db.getClipboardById(id)
  })

  ipcMain.handle('settings:get', async (_event, key: string) => {
    return db.getSetting(key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: string) => {
    return db.setSetting(key, value)
  })

  ipcMain.handle('settings:all', async () => {
    return db.getAllSettings()
  })

  ipcMain.handle('db:vacuum', async () => {
    return db.vacuum()
  })

  ipcMain.handle('db:cleanup', async () => {
    return scheduler.runCleanupNow()
  })

  ipcMain.handle('db:stats', async () => {
    return {
      totalCount: db.getTotalCount(),
      size: db.getDatabaseSize()
    }
  })

  ipcMain.handle('sync:enable', async () => {
    const port = parseInt(db.getSetting('syncPort') || '8972', 10)
    const result = await syncService.enable(port)
    if (result) {
      db.setSetting('enableSync', 'true')
    }
    return result
  })

  ipcMain.handle('sync:disable', async () => {
    const result = syncService.disable()
    if (result) {
      db.setSetting('enableSync', 'false')
    }
    return result
  })

  ipcMain.handle('sync:peers', async () => {
    return syncService.getPeers()
  })

  ipcMain.handle('sync:status', async () => {
    return syncService.isSyncEnabled()
  })

  ipcMain.handle('snippets:list', async () => {
    return snippetService.getAllSnippets()
  })

  ipcMain.handle('snippets:get', async (_event, id: string) => {
    return snippetService.getSnippet(id)
  })

  ipcMain.handle('snippets:create', async (_event, name: string, description: string | undefined, items: ClipboardItem[]) => {
    const snippet = snippetService.createSnippetFromItems(name, description, items)
    if (snippet) {
      syncService.broadcastSnippet('create', snippet)
    }
    return snippet
  })

  ipcMain.handle('snippets:update', async (_event, snippet: Omit<Snippet, 'createdAt' | 'updatedAt'>) => {
    const updated = snippetService.updateSnippet(snippet)
    if (updated) {
      syncService.broadcastSnippet('update', updated)
    }
    return updated
  })

  ipcMain.handle('snippets:delete', async (_event, id: string) => {
    const success = snippetService.deleteSnippet(id)
    if (success) {
      syncService.broadcastSnippet('delete', { id })
    }
    return success
  })

  ipcMain.handle('snippets:reorder', async (_event, snippetId: string, itemOrders: { itemId: string; order: number }[]) => {
    return snippetService.reorderItems(snippetId, itemOrders)
  })

  ipcMain.handle('snippets:export-markdown', async (_event, id: string) => {
    const snippet = snippetService.getSnippet(id)
    if (!snippet) return null
    return snippetService.exportToMarkdown(snippet)
  })

  ipcMain.handle('snippets:smart-paste', async (_event, id: string) => {
    const snippet = snippetService.getSnippet(id)
    if (!snippet) return false

    const windowTitle = await getActiveWindowTitle()
    const content = snippetService.formatForSmartPaste(snippet, windowTitle)

    clipboard.writeText(content)
    return true
  })

  ipcMain.handle('snippets:copy', async (_event, id: string) => {
    const snippet = snippetService.getSnippet(id)
    if (!snippet) return false

    const content = snippet.items
      .filter(i => i.type === 'text' || i.type === 'file')
      .map(i => i.content || '')
      .filter(c => c.trim())
      .join('\n\n')

    clipboard.writeText(content)
    return true
  })

  ipcMain.handle('window:close-main', () => {
    mainWindow?.hide()
    return true
  })

  ipcMain.handle('window:close-float', () => {
    floatWindow?.hide()
    return true
  })

  ipcMain.handle('window:show-settings', () => {
    mainWindow?.show()
    mainWindow?.webContents.send('navigate', 'settings')
    return true
  })

  clipboardMonitor.setOnNewItemCallback((item: ClipboardItem) => {
    mainWindow?.webContents.send('clipboard:new', item)
    floatWindow?.webContents.send('clipboard:new', item)
    syncService.broadcastItem(item)
  })

  ocrService.setCallback((id: number, text: string | null, _error?: string) => {
    if (text) {
      const item = db.getClipboardById(id)
      if (item) {
        mainWindow?.webContents.send('ocr:complete', { id, text })
        floatWindow?.webContents.send('ocr:complete', { id, text })
      }
    }
  })

  syncService.setOnNewItemCallback((item: ClipboardItem) => {
    mainWindow?.webContents.send('clipboard:new', item)
    floatWindow?.webContents.send('clipboard:new', item)
  })

  syncService.setOnPeerChangeCallback(() => {
    mainWindow?.webContents.send('sync:peers-changed')
  })

  syncService.setOnSnippetChangeCallback(() => {
    mainWindow?.webContents.send('snippets:changed')
  })
}
