import Database from 'better-sqlite3'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import type { ClipboardItem, Snippet, Settings, PeerInfo } from '../types'

const DEFAULT_MAX_RECORDS = 10000

class DatabaseService {
  private db: Database.Database | null = null

  init() {
    const dbDir = path.join(app.getPath('userData'), 'database')
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true })
    }

    const dbPath = path.join(dbDir, 'clipmaster.db')
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')

    this.migrateDatabase()
    this.createTables()
    this.createDefaultSettings()
  }

  private migrateDatabase() {
    if (!this.db) return

    try {
      const columns = this.db.prepare("PRAGMA table_info(clipboard_history)").all() as any[]
      const hasImageData = columns.some(c => c.name === 'image_data')
      const hasImagePath = columns.some(c => c.name === 'image_path')

      if (hasImageData && !hasImagePath) {
        this.db.exec(`
          ALTER TABLE clipboard_history ADD COLUMN image_path TEXT;
        `)
        console.log('Database migrated: added image_path column')
      }
    } catch (error) {
      console.log('Database migration check skipped:', error)
    }
  }

  private createTables() {
    if (!this.db) return

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS clipboard_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('text', 'image', 'file')),
        content TEXT,
        image_path TEXT,
        ocr_text TEXT,
        is_favorite INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS clipboard_fts USING fts5(
        content,
        ocr_text,
        content='clipboard_history',
        content_rowid='id'
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS sync_peers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT UNIQUE NOT NULL,
        device_name TEXT,
        ip_address TEXT,
        port INTEGER,
        is_online INTEGER DEFAULT 0,
        last_sync DATETIME
      );

      CREATE TABLE IF NOT EXISTS snippets (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_modified_by TEXT,
        version INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS snippet_items (
        id TEXT PRIMARY KEY,
        snippet_id TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('text', 'image', 'file')),
        content TEXT,
        image_path TEXT,
        sort_order INTEGER NOT NULL,
        FOREIGN KEY (snippet_id) REFERENCES snippets(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_history_type ON clipboard_history(type);
      CREATE INDEX IF NOT EXISTS idx_history_created ON clipboard_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_history_favorite ON clipboard_history(is_favorite);
      CREATE INDEX IF NOT EXISTS idx_snippet_items_snippet ON snippet_items(snippet_id);
      CREATE INDEX IF NOT EXISTS idx_snippets_updated ON snippets(updated_at DESC);
    `)

    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS after_clipboard_insert
      AFTER INSERT ON clipboard_history
      BEGIN
        INSERT INTO clipboard_fts(rowid, content, ocr_text)
        VALUES (NEW.id, NEW.content, NEW.ocr_text);
      END;

      CREATE TRIGGER IF NOT EXISTS after_clipboard_update
      AFTER UPDATE ON clipboard_history
      BEGIN
        UPDATE clipboard_fts
        SET content = NEW.content, ocr_text = NEW.ocr_text
        WHERE rowid = NEW.id;
      END;

      CREATE TRIGGER IF NOT EXISTS after_clipboard_delete
      AFTER DELETE ON clipboard_history
      BEGIN
        DELETE FROM clipboard_fts WHERE rowid = OLD.id;
      END;
    `)
  }

  private createDefaultSettings() {
    const defaults: Partial<Settings> = {
      maxRecords: DEFAULT_MAX_RECORDS,
      autoStart: false,
      shortcut: 'CmdOrCtrl+Shift+V',
      enableOcr: true,
      enableSync: false,
      syncPort: 8972,
      theme: 'dark'
    }

    for (const [key, value] of Object.entries(defaults)) {
      this.setSetting(key, String(value), true)
    }
  }

  insertClipboardItem(item: Omit<ClipboardItem, 'id' | 'createdAt' | 'updatedAt'>): number {
    if (!this.db) return 0

    const stmt = this.db.prepare(`
      INSERT INTO clipboard_history (type, content, image_path, ocr_text, is_favorite)
      VALUES (?, ?, ?, ?, ?)
    `)

    const result = stmt.run(
      item.type,
      item.content || null,
      item.imagePath || null,
      item.ocrText || null,
      item.isFavorite ? 1 : 0
    )

    return Number(result.lastInsertRowid)
  }

  updateOcrText(id: number, ocrText: string): boolean {
    if (!this.db) return false

    const stmt = this.db.prepare(`
      UPDATE clipboard_history
      SET ocr_text = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    const result = stmt.run(ocrText, id)
    return result.changes > 0
  }

  getClipboardList(page: number = 1, pageSize: number = 50, type?: string): { items: ClipboardItem[], total: number } {
    if (!this.db) return { items: [], total: 0 }

    let whereClause = ''
    const params: any[] = []

    if (type && type !== 'all') {
      whereClause = 'WHERE type = ?'
      params.push(type)
    }

    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM clipboard_history ${whereClause}
    `)
    const { count } = countStmt.get(...params) as { count: number }

    const offset = (page - 1) * pageSize
    params.push(pageSize, offset)

    const listStmt = this.db.prepare(`
      SELECT id, type, content, ocr_text as ocrText, is_favorite as isFavorite,
             created_at as createdAt, updated_at as updatedAt
      FROM clipboard_history
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)

    const items = listStmt.all(...params) as ClipboardItem[]
    return { items, total: count }
  }

  getClipboardById(id: number): ClipboardItem | null {
    if (!this.db) return null

    const stmt = this.db.prepare(`
      SELECT id, type, content, image_path as imagePath, ocr_text as ocrText,
             is_favorite as isFavorite, created_at as createdAt, updated_at as updatedAt
      FROM clipboard_history
      WHERE id = ?
    `)

    return stmt.get(id) as ClipboardItem || null
  }

  searchClipboard(query: string, limit: number = 50): ClipboardItem[] {
    if (!this.db || !query.trim()) return []

    const stmt = this.db.prepare(`
      SELECT ch.id, ch.type, ch.content, ch.ocr_text as ocrText,
             ch.is_favorite as isFavorite, ch.created_at as createdAt
      FROM clipboard_fts fts
      JOIN clipboard_history ch ON ch.id = fts.rowid
      WHERE clipboard_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)

    return stmt.all(`${query}*`, limit) as ClipboardItem[]
  }

  deleteClipboard(id: number): boolean {
    if (!this.db) return false

    const stmt = this.db.prepare('DELETE FROM clipboard_history WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  toggleFavorite(id: number): boolean {
    if (!this.db) return false

    const stmt = this.db.prepare(`
      UPDATE clipboard_history
      SET is_favorite = 1 - is_favorite, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `)

    const result = stmt.run(id)
    return result.changes > 0
  }

  cleanOldRecords(maxRecords: number = DEFAULT_MAX_RECORDS): number {
    if (!this.db) return 0

    const countStmt = this.db.prepare('SELECT COUNT(*) as count FROM clipboard_history WHERE is_favorite = 0')
    const { count } = countStmt.get() as { count: number }

    if (count <= maxRecords) return 0

    const toDelete = count - maxRecords

    const deleteStmt = this.db.prepare(`
      DELETE FROM clipboard_history
      WHERE is_favorite = 0
      AND id IN (
        SELECT id FROM clipboard_history
        WHERE is_favorite = 0
        ORDER BY created_at ASC
        LIMIT ?
      )
    `)

    const result = deleteStmt.run(toDelete)
    return Number(result.changes)
  }

  getTotalCount(): number {
    if (!this.db) return 0
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM clipboard_history')
    const result = stmt.get() as { count: number }
    return result.count
  }

  vacuum(): boolean {
    if (!this.db) return false
    try {
      this.db.exec('VACUUM')
      return true
    } catch {
      return false
    }
  }

  getSetting(key: string): string | null {
    if (!this.db) return null
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    const result = stmt.get(key) as { value: string } | undefined
    return result?.value || null
  }

  setSetting(key: string, value: string, skipUpdate: boolean = false): boolean {
    if (!this.db) return false

    if (skipUpdate) {
      const existing = this.db.prepare('SELECT 1 FROM settings WHERE key = ?').get(key)
      if (existing) return true
    }

    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)

    const result = stmt.run(key, value)
    return result.changes > 0
  }

  getAllSettings(): Record<string, string> {
    if (!this.db) return {}
    const stmt = this.db.prepare('SELECT key, value FROM settings')
    const rows = stmt.all() as { key: string; value: string }[]
    return Object.fromEntries(rows.map(r => [r.key, r.value]))
  }

  upsertPeer(peer: PeerInfo): boolean {
    if (!this.db) return false

    const stmt = this.db.prepare(`
      INSERT INTO sync_peers (device_id, device_name, ip_address, port, is_online, last_sync)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(device_id) DO UPDATE SET
        device_name = excluded.device_name,
        ip_address = excluded.ip_address,
        port = excluded.port,
        is_online = excluded.is_online,
        last_sync = CURRENT_TIMESTAMP
    `)

    const result = stmt.run(
      peer.deviceId,
      peer.deviceName,
      peer.ipAddress,
      peer.port,
      peer.isOnline ? 1 : 0
    )
    return result.changes > 0
  }

  getPeers(): PeerInfo[] {
    if (!this.db) return []
    const stmt = this.db.prepare(`
      SELECT id, device_id as deviceId, device_name as deviceName,
             ip_address as ipAddress, port, is_online as isOnline,
             last_sync as lastSync
      FROM sync_peers
      ORDER BY is_online DESC, last_sync DESC
    `)
    return stmt.all() as PeerInfo[]
  }

  updatePeerStatus(deviceId: string, isOnline: boolean): boolean {
    if (!this.db) return false
    const stmt = this.db.prepare(`
      UPDATE sync_peers SET is_online = ? WHERE device_id = ?
    `)
    const result = stmt.run(isOnline ? 1 : 0, deviceId)
    return result.changes > 0
  }

  getDatabaseSize(): number {
    if (!this.db) return 0
    const stmt = this.db.prepare('PRAGMA page_size')
    const pageSize = (stmt.get() as { page_size: number }).page_size
    const stmt2 = this.db.prepare('PRAGMA page_count')
    const pageCount = (stmt2.get() as { page_count: number }).page_count
    return pageSize * pageCount
  }

  insertSnippet(snippet: Omit<Snippet, 'createdAt' | 'updatedAt'>, deviceId?: string): Snippet | null {
    if (!this.db) return null

    const now = new Date().toISOString()

    const snippetStmt = this.db.prepare(`
      INSERT INTO snippets (id, name, description, last_modified_by, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `)

    const itemStmt = this.db.prepare(`
      INSERT INTO snippet_items (id, snippet_id, type, content, image_path, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      snippetStmt.run(
        snippet.id,
        snippet.name,
        snippet.description || null,
        deviceId || null,
        snippet.version || 1,
        now,
        now
      )

      for (const item of snippet.items) {
        itemStmt.run(
          item.id,
          snippet.id,
          item.type,
          item.content || null,
          item.imagePath || null,
          item.order
        )
      }
    })

    try {
      transaction()
      return this.getSnippetById(snippet.id)
    } catch (error) {
      console.error('Insert snippet error:', error)
      return null
    }
  }

  updateSnippet(snippet: Omit<Snippet, 'createdAt' | 'updatedAt'>, deviceId?: string): Snippet | null {
    if (!this.db) return null

    const existing = this.getSnippetById(snippet.id)
    if (!existing) return null

    if (existing.version > snippet.version) {
      return null
    }

    const now = new Date().toISOString()
    const newVersion = Math.max(existing.version, snippet.version) + 1

    const updateSnippetStmt = this.db.prepare(`
      UPDATE snippets
      SET name = ?, description = ?, last_modified_by = ?, version = ?, updated_at = ?
      WHERE id = ?
    `)

    const deleteItemsStmt = this.db.prepare('DELETE FROM snippet_items WHERE snippet_id = ?')

    const insertItemStmt = this.db.prepare(`
      INSERT INTO snippet_items (id, snippet_id, type, content, image_path, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `)

    const transaction = this.db.transaction(() => {
      updateSnippetStmt.run(
        snippet.name,
        snippet.description || null,
        deviceId || null,
        newVersion,
        now,
        snippet.id
      )

      deleteItemsStmt.run(snippet.id)

      for (const item of snippet.items) {
        insertItemStmt.run(
          item.id,
          snippet.id,
          item.type,
          item.content || null,
          item.imagePath || null,
          item.order
        )
      }
    })

    try {
      transaction()
      return this.getSnippetById(snippet.id)
    } catch (error) {
      console.error('Update snippet error:', error)
      return null
    }
  }

  getSnippetById(id: string): Snippet | null {
    if (!this.db) return null

    const snippetStmt = this.db.prepare(`
      SELECT id, name, description, created_at as createdAt,
             updated_at as updatedAt, last_modified_by as lastModifiedBy, version
      FROM snippets
      WHERE id = ?
    `)

    const itemsStmt = this.db.prepare(`
      SELECT id, type, content, image_path as imagePath, sort_order as 'order'
      FROM snippet_items
      WHERE snippet_id = ?
      ORDER BY sort_order ASC
    `)

    const snippet = snippetStmt.get(id) as any
    if (!snippet) return null

    const items = itemsStmt.all(id) as any[]
    return { ...snippet, items }
  }

  getAllSnippets(): Snippet[] {
    if (!this.db) return []

    const stmt = this.db.prepare(`
      SELECT id, name, description, created_at as createdAt,
             updated_at as updatedAt, last_modified_by as lastModifiedBy, version
      FROM snippets
      ORDER BY updated_at DESC
    `)

    const snippets = stmt.all() as any[]

    const itemsStmt = this.db.prepare(`
      SELECT id, type, content, image_path as imagePath, sort_order as 'order'
      FROM snippet_items
      WHERE snippet_id = ?
      ORDER BY sort_order ASC
    `)

    return snippets.map(snippet => ({
      ...snippet,
      items: itemsStmt.all(snippet.id) as any[]
    }))
  }

  deleteSnippet(id: string): boolean {
    if (!this.db) return false

    const stmt = this.db.prepare('DELETE FROM snippets WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  close() {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}

export const db = new DatabaseService()
