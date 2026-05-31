"use strict";
var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const electron = require("electron");
const path = require("path");
const Database = require("better-sqlite3");
const fs = require("fs");
const crypto = require("crypto");
const worker_threads = require("worker_threads");
const sharp = require("sharp");
const cron = require("node-cron");
const ws = require("ws");
const bonjourService = require("bonjour-service");
const os = require("os");
const child_process = require("child_process");
const DEFAULT_MAX_RECORDS = 1e4;
class DatabaseService {
  constructor() {
    __publicField(this, "db", null);
  }
  init() {
    const dbDir = path.join(electron.app.getPath("userData"), "database");
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    const dbPath = path.join(dbDir, "clipmaster.db");
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrateDatabase();
    this.createTables();
    this.createDefaultSettings();
  }
  migrateDatabase() {
    if (!this.db) return;
    try {
      const columns = this.db.prepare("PRAGMA table_info(clipboard_history)").all();
      const hasImageData = columns.some((c) => c.name === "image_data");
      const hasImagePath = columns.some((c) => c.name === "image_path");
      if (hasImageData && !hasImagePath) {
        this.db.exec(`
          ALTER TABLE clipboard_history ADD COLUMN image_path TEXT;
        `);
        console.log("Database migrated: added image_path column");
      }
    } catch (error) {
      console.log("Database migration check skipped:", error);
    }
  }
  createTables() {
    if (!this.db) return;
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
    `);
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
    `);
  }
  createDefaultSettings() {
    const defaults = {
      maxRecords: DEFAULT_MAX_RECORDS,
      autoStart: false,
      shortcut: "CmdOrCtrl+Shift+V",
      enableOcr: true,
      enableSync: false,
      syncPort: 8972,
      theme: "dark"
    };
    for (const [key, value] of Object.entries(defaults)) {
      this.setSetting(key, String(value), true);
    }
  }
  insertClipboardItem(item) {
    if (!this.db) return 0;
    const stmt = this.db.prepare(`
      INSERT INTO clipboard_history (type, content, image_path, ocr_text, is_favorite)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = stmt.run(
      item.type,
      item.content || null,
      item.imagePath || null,
      item.ocrText || null,
      item.isFavorite ? 1 : 0
    );
    return Number(result.lastInsertRowid);
  }
  updateOcrText(id, ocrText) {
    if (!this.db) return false;
    const stmt = this.db.prepare(`
      UPDATE clipboard_history
      SET ocr_text = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const result = stmt.run(ocrText, id);
    return result.changes > 0;
  }
  getClipboardList(page = 1, pageSize = 50, type) {
    if (!this.db) return { items: [], total: 0 };
    let whereClause = "";
    const params = [];
    if (type && type !== "all") {
      whereClause = "WHERE type = ?";
      params.push(type);
    }
    const countStmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM clipboard_history ${whereClause}
    `);
    const { count } = countStmt.get(...params);
    const offset = (page - 1) * pageSize;
    params.push(pageSize, offset);
    const listStmt = this.db.prepare(`
      SELECT id, type, content, ocr_text as ocrText, is_favorite as isFavorite,
             created_at as createdAt, updated_at as updatedAt
      FROM clipboard_history
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);
    const items = listStmt.all(...params);
    return { items, total: count };
  }
  getClipboardById(id) {
    if (!this.db) return null;
    const stmt = this.db.prepare(`
      SELECT id, type, content, image_path as imagePath, ocr_text as ocrText,
             is_favorite as isFavorite, created_at as createdAt, updated_at as updatedAt
      FROM clipboard_history
      WHERE id = ?
    `);
    return stmt.get(id) || null;
  }
  searchClipboard(query, limit = 50) {
    if (!this.db || !query.trim()) return [];
    const stmt = this.db.prepare(`
      SELECT ch.id, ch.type, ch.content, ch.ocr_text as ocrText,
             ch.is_favorite as isFavorite, ch.created_at as createdAt
      FROM clipboard_fts fts
      JOIN clipboard_history ch ON ch.id = fts.rowid
      WHERE clipboard_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `);
    return stmt.all(`${query}*`, limit);
  }
  deleteClipboard(id) {
    if (!this.db) return false;
    const stmt = this.db.prepare("DELETE FROM clipboard_history WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }
  toggleFavorite(id) {
    if (!this.db) return false;
    const stmt = this.db.prepare(`
      UPDATE clipboard_history
      SET is_favorite = 1 - is_favorite, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    const result = stmt.run(id);
    return result.changes > 0;
  }
  cleanOldRecords(maxRecords = DEFAULT_MAX_RECORDS) {
    if (!this.db) return 0;
    const countStmt = this.db.prepare("SELECT COUNT(*) as count FROM clipboard_history WHERE is_favorite = 0");
    const { count } = countStmt.get();
    if (count <= maxRecords) return 0;
    const toDelete = count - maxRecords;
    const deleteStmt = this.db.prepare(`
      DELETE FROM clipboard_history
      WHERE is_favorite = 0
      AND id IN (
        SELECT id FROM clipboard_history
        WHERE is_favorite = 0
        ORDER BY created_at ASC
        LIMIT ?
      )
    `);
    const result = deleteStmt.run(toDelete);
    return Number(result.changes);
  }
  getTotalCount() {
    if (!this.db) return 0;
    const stmt = this.db.prepare("SELECT COUNT(*) as count FROM clipboard_history");
    const result = stmt.get();
    return result.count;
  }
  vacuum() {
    if (!this.db) return false;
    try {
      this.db.exec("VACUUM");
      return true;
    } catch {
      return false;
    }
  }
  getSetting(key) {
    if (!this.db) return null;
    const stmt = this.db.prepare("SELECT value FROM settings WHERE key = ?");
    const result = stmt.get(key);
    return (result == null ? void 0 : result.value) || null;
  }
  setSetting(key, value, skipUpdate = false) {
    if (!this.db) return false;
    if (skipUpdate) {
      const existing = this.db.prepare("SELECT 1 FROM settings WHERE key = ?").get(key);
      if (existing) return true;
    }
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    const result = stmt.run(key, value);
    return result.changes > 0;
  }
  getAllSettings() {
    if (!this.db) return {};
    const stmt = this.db.prepare("SELECT key, value FROM settings");
    const rows = stmt.all();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }
  upsertPeer(peer) {
    if (!this.db) return false;
    const stmt = this.db.prepare(`
      INSERT INTO sync_peers (device_id, device_name, ip_address, port, is_online, last_sync)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(device_id) DO UPDATE SET
        device_name = excluded.device_name,
        ip_address = excluded.ip_address,
        port = excluded.port,
        is_online = excluded.is_online,
        last_sync = CURRENT_TIMESTAMP
    `);
    const result = stmt.run(
      peer.deviceId,
      peer.deviceName,
      peer.ipAddress,
      peer.port,
      peer.isOnline ? 1 : 0
    );
    return result.changes > 0;
  }
  getPeers() {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT id, device_id as deviceId, device_name as deviceName,
             ip_address as ipAddress, port, is_online as isOnline,
             last_sync as lastSync
      FROM sync_peers
      ORDER BY is_online DESC, last_sync DESC
    `);
    return stmt.all();
  }
  updatePeerStatus(deviceId, isOnline) {
    if (!this.db) return false;
    const stmt = this.db.prepare(`
      UPDATE sync_peers SET is_online = ? WHERE device_id = ?
    `);
    const result = stmt.run(isOnline ? 1 : 0, deviceId);
    return result.changes > 0;
  }
  getDatabaseSize() {
    if (!this.db) return 0;
    const stmt = this.db.prepare("PRAGMA page_size");
    const pageSize = stmt.get().page_size;
    const stmt2 = this.db.prepare("PRAGMA page_count");
    const pageCount = stmt2.get().page_count;
    return pageSize * pageCount;
  }
  insertSnippet(snippet, deviceId) {
    if (!this.db) return null;
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const snippetStmt = this.db.prepare(`
      INSERT INTO snippets (id, name, description, last_modified_by, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const itemStmt = this.db.prepare(`
      INSERT INTO snippet_items (id, snippet_id, type, content, image_path, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const transaction = this.db.transaction(() => {
      snippetStmt.run(
        snippet.id,
        snippet.name,
        snippet.description || null,
        deviceId || null,
        snippet.version || 1,
        now,
        now
      );
      for (const item of snippet.items) {
        itemStmt.run(
          item.id,
          snippet.id,
          item.type,
          item.content || null,
          item.imagePath || null,
          item.order
        );
      }
    });
    try {
      transaction();
      return this.getSnippetById(snippet.id);
    } catch (error) {
      console.error("Insert snippet error:", error);
      return null;
    }
  }
  updateSnippet(snippet, deviceId) {
    if (!this.db) return null;
    const existing = this.getSnippetById(snippet.id);
    if (!existing) return null;
    if (existing.version > snippet.version) {
      return null;
    }
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const newVersion = Math.max(existing.version, snippet.version) + 1;
    const updateSnippetStmt = this.db.prepare(`
      UPDATE snippets
      SET name = ?, description = ?, last_modified_by = ?, version = ?, updated_at = ?
      WHERE id = ?
    `);
    const deleteItemsStmt = this.db.prepare("DELETE FROM snippet_items WHERE snippet_id = ?");
    const insertItemStmt = this.db.prepare(`
      INSERT INTO snippet_items (id, snippet_id, type, content, image_path, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const transaction = this.db.transaction(() => {
      updateSnippetStmt.run(
        snippet.name,
        snippet.description || null,
        deviceId || null,
        newVersion,
        now,
        snippet.id
      );
      deleteItemsStmt.run(snippet.id);
      for (const item of snippet.items) {
        insertItemStmt.run(
          item.id,
          snippet.id,
          item.type,
          item.content || null,
          item.imagePath || null,
          item.order
        );
      }
    });
    try {
      transaction();
      return this.getSnippetById(snippet.id);
    } catch (error) {
      console.error("Update snippet error:", error);
      return null;
    }
  }
  getSnippetById(id) {
    if (!this.db) return null;
    const snippetStmt = this.db.prepare(`
      SELECT id, name, description, created_at as createdAt,
             updated_at as updatedAt, last_modified_by as lastModifiedBy, version
      FROM snippets
      WHERE id = ?
    `);
    const itemsStmt = this.db.prepare(`
      SELECT id, type, content, image_path as imagePath, sort_order as 'order'
      FROM snippet_items
      WHERE snippet_id = ?
      ORDER BY sort_order ASC
    `);
    const snippet = snippetStmt.get(id);
    if (!snippet) return null;
    const items = itemsStmt.all(id);
    return { ...snippet, items };
  }
  getAllSnippets() {
    if (!this.db) return [];
    const stmt = this.db.prepare(`
      SELECT id, name, description, created_at as createdAt,
             updated_at as updatedAt, last_modified_by as lastModifiedBy, version
      FROM snippets
      ORDER BY updated_at DESC
    `);
    const snippets = stmt.all();
    const itemsStmt = this.db.prepare(`
      SELECT id, type, content, image_path as imagePath, sort_order as 'order'
      FROM snippet_items
      WHERE snippet_id = ?
      ORDER BY sort_order ASC
    `);
    return snippets.map((snippet) => ({
      ...snippet,
      items: itemsStmt.all(snippet.id)
    }));
  }
  deleteSnippet(id) {
    if (!this.db) return false;
    const stmt = this.db.prepare("DELETE FROM snippets WHERE id = ?");
    const result = stmt.run(id);
    return result.changes > 0;
  }
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
const db = new DatabaseService();
class OcrService {
  constructor() {
    __publicField(this, "queue", []);
    __publicField(this, "activeWorkers", /* @__PURE__ */ new Set());
    __publicField(this, "maxWorkers", 2);
    __publicField(this, "callback", null);
  }
  setCallback(callback) {
    this.callback = callback;
  }
  async recognize(id, imagePath) {
    this.queue.push({ id, imagePath });
    this.processQueue();
  }
  processQueue() {
    if (this.activeWorkers.size >= this.maxWorkers || this.queue.length === 0) return;
    const task = this.queue.shift();
    if (!task) return;
    const workerPath = path.join(__dirname, "ocrWorker.js");
    const worker = new worker_threads.Worker(workerPath, {
      workerData: { task }
    });
    this.activeWorkers.add(worker);
    worker.on("message", (result) => {
      if (result.success && result.text) {
        db.updateOcrText(result.id, result.text);
        if (this.callback) {
          this.callback(result.id, result.text);
        }
      } else if (this.callback) {
        this.callback(result.id, null, result.error);
      }
    });
    worker.on("error", (error) => {
      console.error("OCR Worker error:", error);
      if (this.callback) {
        this.callback(task.id, null, String(error));
      }
    });
    worker.on("exit", () => {
      this.activeWorkers.delete(worker);
      this.processQueue();
    });
  }
  async terminate() {
    for (const worker of this.activeWorkers) {
      worker.terminate();
    }
    this.activeWorkers.clear();
    this.queue = [];
  }
}
const ocrService = new OcrService();
class ImageStoreService {
  constructor() {
    __publicField(this, "imagesDir", "");
  }
  init() {
    this.imagesDir = path.join(electron.app.getPath("userData"), "images");
    if (!fs.existsSync(this.imagesDir)) {
      fs.mkdirSync(this.imagesDir, { recursive: true });
    }
  }
  async saveImage(imageBuffer) {
    const hash = crypto.createHash("md5").update(imageBuffer).digest("hex");
    const ext = "webp";
    const fileName = `${hash}.${ext}`;
    const filePath = path.join(this.imagesDir, fileName);
    if (fs.existsSync(filePath)) {
      return { filePath, hash };
    }
    try {
      await sharp(imageBuffer).resize({
        width: 1920,
        height: 1080,
        fit: "inside",
        withoutEnlargement: true
      }).webp({ quality: 80 }).toFile(filePath);
      return { filePath, hash };
    } catch (error) {
      console.error("Image compression error:", error);
      fs.writeFileSync(filePath, imageBuffer);
      return { filePath, hash };
    }
  }
  getImageBuffer(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath);
      }
      return null;
    } catch (error) {
      console.error("Read image error:", error);
      return null;
    }
  }
  deleteImage(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return true;
      }
      return false;
    } catch (error) {
      console.error("Delete image error:", error);
      return false;
    }
  }
  cleanupOrphanedImages(validPaths) {
    try {
      const files = fs.readdirSync(this.imagesDir);
      let deletedCount = 0;
      for (const file of files) {
        const filePath = path.join(this.imagesDir, file);
        if (!validPaths.has(filePath)) {
          fs.unlinkSync(filePath);
          deletedCount++;
        }
      }
      return deletedCount;
    } catch (error) {
      console.error("Cleanup orphaned images error:", error);
      return 0;
    }
  }
  getImagesDirSize() {
    try {
      let totalSize = 0;
      const files = fs.readdirSync(this.imagesDir);
      for (const file of files) {
        const filePath = path.join(this.imagesDir, file);
        const stats = fs.statSync(filePath);
        totalSize += stats.size;
      }
      return totalSize;
    } catch (error) {
      return 0;
    }
  }
}
const imageStore = new ImageStoreService();
class ClipboardMonitor {
  constructor() {
    __publicField(this, "lastHash", "");
    __publicField(this, "interval", null);
    __publicField(this, "isProcessing", false);
    __publicField(this, "onNewItemCallback", null);
  }
  start(pollInterval = 500) {
    this.interval = setInterval(() => {
      if (!this.isProcessing) {
        this.checkClipboard();
      }
    }, pollInterval);
  }
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
  setOnNewItemCallback(callback) {
    this.onNewItemCallback = callback;
  }
  async checkClipboard() {
    this.isProcessing = true;
    try {
      const content = this.readClipboard();
      if (!content) return;
      const hash = this.computeHash(content);
      if (hash === this.lastHash) return;
      this.lastHash = hash;
      await this.processContent(content);
    } catch (error) {
      console.error("Clipboard check error:", error);
    } finally {
      this.isProcessing = false;
    }
  }
  readClipboard() {
    const formats = electron.clipboard.availableFormats();
    if (formats.some((f) => f.startsWith("image/")) || formats.includes("image/png") || formats.includes("image/jpeg")) {
      const image = electron.clipboard.readImage();
      if (!image.isEmpty()) {
        return {
          type: "image",
          imageBuffer: image.toPNG()
        };
      }
    }
    const files = electron.clipboard.read("text/uri-list");
    if (files) {
      const filePaths = files.split("\r\n").filter((f) => f.trim());
      if (filePaths.length > 0 && filePaths[0].startsWith("file://")) {
        return {
          type: "file",
          content: filePaths.map((f) => f.replace("file:///", "").replace("file://", "")).join("\n")
        };
      }
    }
    const text = electron.clipboard.readText();
    if (text && text.trim()) {
      return {
        type: "text",
        content: text
      };
    }
    return null;
  }
  computeHash(content) {
    const data = content.type === "image" && content.imageBuffer ? content.imageBuffer : Buffer.from(content.content || "");
    return crypto.createHash("md5").update(data).digest("hex");
  }
  async processContent(content) {
    let imagePath;
    if (content.type === "image" && content.imageBuffer) {
      const result = await imageStore.saveImage(content.imageBuffer);
      imagePath = result.filePath;
    }
    const id = db.insertClipboardItem({
      type: content.type,
      content: content.content,
      imagePath,
      isFavorite: false
    });
    if (content.type === "image" && imagePath) {
      const enableOcr = db.getSetting("enableOcr");
      if (enableOcr !== "false") {
        setImmediate(() => {
          ocrService.recognize(id, imagePath);
        });
      }
    }
    const maxRecords = parseInt(db.getSetting("maxRecords") || "10000", 10);
    db.cleanOldRecords(maxRecords);
    const item = db.getClipboardById(id);
    if (item && this.onNewItemCallback) {
      this.onNewItemCallback(item);
    }
  }
  copyToClipboard(item) {
    try {
      if (item.type === "text") {
        electron.clipboard.writeText(item.content || "");
      } else if (item.type === "image" && item.imagePath) {
        const imageBuffer = imageStore.getImageBuffer(item.imagePath);
        if (imageBuffer) {
          const image = electron.nativeImage.createFromBuffer(imageBuffer);
          electron.clipboard.writeImage(image);
        }
      } else if (item.type === "file") {
        electron.clipboard.writeText(item.content || "");
      }
      this.lastHash = item.type === "image" && item.imagePath ? this.lastHash : crypto.createHash("md5").update(item.content || "").digest("hex");
      return true;
    } catch (error) {
      console.error("Copy to clipboard error:", error);
      return false;
    }
  }
}
const clipboardMonitor = new ClipboardMonitor();
class SchedulerService {
  constructor() {
    __publicField(this, "tasks", /* @__PURE__ */ new Map());
  }
  start() {
    this.scheduleWeeklyCleanup();
  }
  scheduleWeeklyCleanup() {
    const task = cron.schedule("0 0 3 * * 0", async () => {
      console.log("Starting weekly database maintenance...");
      const maxRecords = parseInt(db.getSetting("maxRecords") || "10000", 10);
      const deleted = db.cleanOldRecords(maxRecords);
      console.log(`Deleted ${deleted} old records`);
      const vacuumed = db.vacuum();
      console.log(`Database vacuum ${vacuumed ? "completed" : "failed"}`);
    }, {
      timezone: "Asia/Shanghai"
    });
    this.tasks.set("weeklyCleanup", task);
  }
  stop() {
    this.tasks.forEach((task) => task.stop());
    this.tasks.clear();
  }
  runCleanupNow() {
    const maxRecords = parseInt(db.getSetting("maxRecords") || "10000", 10);
    const deleted = db.cleanOldRecords(maxRecords);
    db.vacuum();
    return deleted;
  }
}
const scheduler = new SchedulerService();
class SyncService {
  constructor() {
    __publicField(this, "wss", null);
    __publicField(this, "bonjour", null);
    __publicField(this, "service", null);
    __publicField(this, "peers", /* @__PURE__ */ new Map());
    __publicField(this, "deviceId", "");
    __publicField(this, "deviceName", os.hostname());
    __publicField(this, "isEnabled", false);
    __publicField(this, "onNewItemCallback", null);
    __publicField(this, "onPeerChangeCallback", null);
    __publicField(this, "onSnippetChangeCallback", null);
  }
  init() {
    this.deviceId = crypto.createHash("md5").update(os.hostname() + os.platform() + os.arch()).digest("hex");
  }
  setOnNewItemCallback(callback) {
    this.onNewItemCallback = callback;
  }
  setOnPeerChangeCallback(callback) {
    this.onPeerChangeCallback = callback;
  }
  setOnSnippetChangeCallback(callback) {
    this.onSnippetChangeCallback = callback;
  }
  async enable(port = 8972) {
    if (this.isEnabled) return true;
    try {
      this.wss = new ws.WebSocketServer({ port });
      this.wss.on("connection", (ws2, req) => {
        const ip = req.socket.remoteAddress || "";
        this.handleConnection(ws2, ip);
      });
      this.bonjour = new bonjourService.Bonjour();
      this.service = this.bonjour.publish({
        name: `ClipMaster-${this.deviceName}`,
        type: "clipmaster",
        port,
        txt: {
          deviceId: this.deviceId,
          deviceName: this.deviceName
        }
      });
      const browser = this.bonjour.find({ type: "clipmaster" });
      browser.on("up", (service) => {
        var _a;
        if (((_a = service.txt) == null ? void 0 : _a.deviceId) !== this.deviceId) {
          this.connectToPeer(service);
        }
      });
      this.isEnabled = true;
      return true;
    } catch (error) {
      console.error("Sync service enable error:", error);
      return false;
    }
  }
  disable() {
    try {
      this.peers.forEach((ws2) => ws2.close());
      this.peers.clear();
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }
      if (this.service) {
        this.service.stop();
        this.service = null;
      }
      if (this.bonjour) {
        this.bonjour.destroy();
        this.bonjour = null;
      }
      this.isEnabled = false;
      return true;
    } catch (error) {
      console.error("Sync service disable error:", error);
      return false;
    }
  }
  handleConnection(ws2, ip) {
    let peerDeviceId = null;
    ws2.on("message", (data) => {
      var _a;
      try {
        const message = JSON.parse(data.toString());
        if (message.type === "hello") {
          peerDeviceId = message.deviceId;
          this.peers.set(message.deviceId, ws2);
          const peer = {
            deviceId: message.deviceId,
            deviceName: message.deviceName,
            ipAddress: ip,
            port: 0,
            isOnline: true
          };
          db.upsertPeer(peer);
          this.sendHello(ws2);
          (_a = this.onPeerChangeCallback) == null ? void 0 : _a.call(this);
        } else if (message.type === "new-item") {
          this.handleSyncItem(message.payload).catch((error) => {
            console.error("Handle sync item error:", error);
          });
        } else if (message.type === "new-snippet" || message.type === "update-snippet" || message.type === "delete-snippet") {
          this.handleSyncSnippet(message.type, message.payload).catch((error) => {
            console.error("Handle sync snippet error:", error);
          });
        }
      } catch (error) {
        console.error("Sync message parse error:", error);
      }
    });
    ws2.on("close", () => {
      var _a;
      if (peerDeviceId) {
        this.peers.delete(peerDeviceId);
        db.updatePeerStatus(peerDeviceId, false);
        (_a = this.onPeerChangeCallback) == null ? void 0 : _a.call(this);
      }
    });
    this.sendHello(ws2);
  }
  sendHello(ws2) {
    const message = {
      type: "hello",
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      timestamp: Date.now()
    };
    ws2.send(JSON.stringify(message));
  }
  connectToPeer(service) {
    var _a;
    const address = ((_a = service.addresses) == null ? void 0 : _a[0]) || service.host;
    if (!address) return;
    const port = service.port;
    const wsUrl = `ws://${address}:${port}`;
    try {
      const ws$1 = new ws.WebSocket(wsUrl);
      ws$1.on("open", () => {
        this.handleConnection(ws$1, address);
      });
      ws$1.on("error", (error) => {
        console.error("Peer connection error:", error);
      });
    } catch (error) {
      console.error("Connect to peer error:", error);
    }
  }
  async broadcastItem(item) {
    if (!this.isEnabled || this.peers.size === 0) return;
    let itemToSend = { ...item };
    if (item.type === "image" && item.imagePath) {
      const imageBuffer = imageStore.getImageBuffer(item.imagePath);
      if (imageBuffer) {
        itemToSend.imageData = imageBuffer.toString("base64");
      }
      delete itemToSend.imagePath;
    }
    const message = {
      type: "new-item",
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      payload: itemToSend,
      timestamp: Date.now()
    };
    const data = JSON.stringify(message);
    this.peers.forEach((ws$1) => {
      if (ws$1.readyState === ws.WebSocket.OPEN) {
        ws$1.send(data);
      }
    });
  }
  async handleSyncItem(item) {
    var _a;
    if (!item.type) return;
    let imagePath;
    if (item.type === "image" && item.imageData) {
      const imageBuffer = Buffer.from(item.imageData, "base64");
      const result = await imageStore.saveImage(imageBuffer);
      imagePath = result.filePath;
    }
    const id = db.insertClipboardItem({
      type: item.type,
      content: item.content,
      imagePath,
      ocrText: item.ocrText,
      isFavorite: false
    });
    const savedItem = db.getClipboardById(id);
    if (savedItem) {
      (_a = this.onNewItemCallback) == null ? void 0 : _a.call(this, savedItem);
    }
  }
  broadcastSnippet(action, snippet) {
    if (!this.isEnabled || this.peers.size === 0) return;
    const messageType = action === "create" ? "new-snippet" : action === "update" ? "update-snippet" : "delete-snippet";
    const message = {
      type: messageType,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      payload: snippet,
      timestamp: Date.now()
    };
    const data = JSON.stringify(message);
    this.peers.forEach((ws$1) => {
      if (ws$1.readyState === ws.WebSocket.OPEN) {
        ws$1.send(data);
      }
    });
  }
  async handleSyncSnippet(messageType, payload) {
    var _a, _b, _c;
    const snippetId = payload.id;
    if (messageType === "delete-snippet") {
      db.deleteSnippet(snippetId);
      (_a = this.onSnippetChangeCallback) == null ? void 0 : _a.call(this);
      return;
    }
    const existingSnippet = db.getSnippetById(snippetId);
    if (messageType === "new-snippet") {
      if (!existingSnippet) {
        db.insertSnippet(payload, payload.lastModifiedBy);
        (_b = this.onSnippetChangeCallback) == null ? void 0 : _b.call(this);
      }
      return;
    }
    if (messageType === "update-snippet") {
      if (!existingSnippet || payload.version >= existingSnippet.version) {
        db.updateSnippet(payload, payload.lastModifiedBy);
        (_c = this.onSnippetChangeCallback) == null ? void 0 : _c.call(this);
      }
      return;
    }
  }
  getPeers() {
    return db.getPeers().map((peer) => ({
      ...peer,
      isOnline: this.peers.has(peer.deviceId)
    }));
  }
  isSyncEnabled() {
    return this.isEnabled;
  }
  getDeviceId() {
    return this.deviceId;
  }
}
const syncService = new SyncService();
class TrayManager {
  constructor() {
    __publicField(this, "tray", null);
    __publicField(this, "mainWindow", null);
    __publicField(this, "floatWindow", null);
  }
  setWindows(mainWindow2, floatWindow2) {
    this.mainWindow = mainWindow2;
    this.floatWindow = floatWindow2;
  }
  create() {
    const iconPath = path.join(__dirname, "../../public/icon.png");
    const icon = electron.nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 });
    this.tray = new electron.Tray(icon);
    const contextMenu = electron.Menu.buildFromTemplate([
      {
        label: "打开主窗口",
        click: () => {
          var _a, _b;
          (_a = this.mainWindow) == null ? void 0 : _a.show();
          (_b = this.mainWindow) == null ? void 0 : _b.focus();
        }
      },
      {
        label: "快速搜索",
        click: () => {
          var _a, _b;
          (_a = this.floatWindow) == null ? void 0 : _a.show();
          (_b = this.floatWindow) == null ? void 0 : _b.focus();
        }
      },
      { type: "separator" },
      {
        label: "开机自启",
        type: "checkbox",
        checked: electron.app.getLoginItemSettings().openAtLogin,
        click: (menuItem) => {
          electron.app.setLoginItemSettings({
            openAtLogin: menuItem.checked
          });
        }
      },
      { type: "separator" },
      {
        label: "退出",
        click: () => {
          electron.app.quit();
        }
      }
    ]);
    this.tray.setToolTip("ClipMaster - 智能剪贴板管理器");
    this.tray.setContextMenu(contextMenu);
    this.tray.on("click", () => {
      var _a, _b;
      (_a = this.mainWindow) == null ? void 0 : _a.show();
      (_b = this.mainWindow) == null ? void 0 : _b.focus();
    });
  }
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}
const trayManager = new TrayManager();
class SnippetService {
  constructor() {
    __publicField(this, "deviceId", "");
  }
  setDeviceId(id) {
    this.deviceId = id;
  }
  createSnippetFromItems(name, description, items) {
    const id = crypto.randomUUID();
    const snippetItems = items.map((item, index) => ({
      id: crypto.randomUUID(),
      type: item.type,
      content: item.content,
      imagePath: item.imagePath,
      order: index
    }));
    const snippet = {
      id,
      name,
      description,
      items: snippetItems,
      version: 1,
      lastModifiedBy: this.deviceId
    };
    return db.insertSnippet(snippet, this.deviceId);
  }
  updateSnippet(snippet) {
    return db.updateSnippet(snippet, this.deviceId);
  }
  getSnippet(id) {
    return db.getSnippetById(id);
  }
  getAllSnippets() {
    return db.getAllSnippets();
  }
  deleteSnippet(id) {
    return db.deleteSnippet(id);
  }
  reorderItems(snippetId, itemOrders) {
    const snippet = db.getSnippetById(snippetId);
    if (!snippet) return null;
    const updatedItems = snippet.items.map((item) => {
      const newOrder = itemOrders.find((o) => o.itemId === item.id);
      if (newOrder !== void 0) {
        return { ...item, order: newOrder.order };
      }
      return item;
    }).sort((a, b) => a.order - b.order);
    const updatedSnippet = {
      ...snippet,
      items: updatedItems
    };
    return db.updateSnippet(updatedSnippet, this.deviceId);
  }
  exportToMarkdown(snippet) {
    let markdown = `# ${snippet.name}

`;
    if (snippet.description) {
      markdown += `${snippet.description}

`;
    }
    snippet.items.forEach((item, index) => {
      if (item.type === "text") {
        const content = item.content || "";
        const isCode = this.looksLikeCode(content);
        if (isCode) {
          const lang = this.detectLanguage(content);
          markdown += `\`\`\`${lang}
${content}
\`\`\`

`;
        } else {
          markdown += `${content}

`;
        }
      } else if (item.type === "image" && item.imagePath) {
        markdown += `![Image ${index + 1}](${item.imagePath})

`;
      } else if (item.type === "file") {
        const files = (item.content || "").split("\n");
        files.forEach((file) => {
          markdown += `- \`${file}\`
`;
        });
        markdown += "\n";
      }
    });
    markdown += `---
*导出时间: ${(/* @__PURE__ */ new Date()).toLocaleString()}*
`;
    return markdown;
  }
  looksLikeCode(text) {
    const codePatterns = [
      /^\s*(function|class|const|let|var|import|export|if|for|while|def|fn|pub|struct|impl)/m,
      /[\{\}\[\]\(\);]\s*$/,
      /^\s*\/\//m,
      /^\s*#\s*(include|define|if|endif)/m,
      /^\s*def\s+\w+\s*\(/m,
      /^\s*fn\s+\w+\s*\(/m,
      /^\s*public\s+(static\s+)?(void|string|int|bool|class)\s+\w+/m
    ];
    return codePatterns.some((pattern) => pattern.test(text));
  }
  detectLanguage(text) {
    if (/^\s*(function|const|let|var|import|export|=>)\s/.test(text)) return "javascript";
    if (/^\s*(def|class\s+\w+|if\s+__name__)/.test(text)) return "python";
    if (/^\s*(fn|struct|impl|pub\s+fn|use\s+)/.test(text)) return "rust";
    if (/^\s*<(\?xml|!DOCTYPE|html|div|span|table)/.test(text)) return "html";
    if (/^\s*(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP)\s+/i.test(text)) return "sql";
    if (/^\s*(package|import\s+java|public\s+class)/.test(text)) return "java";
    if (/^\s*#include|^\s*#define/.test(text)) return "cpp";
    if (/^\s*using\s+System|^\s*namespace\s+\w+/.test(text)) return "csharp";
    return "";
  }
  formatForSmartPaste(snippet, windowTitle) {
    const appType = this.detectAppType(windowTitle);
    if (appType === "vscode") {
      return this.formatForVSCode(snippet);
    } else if (appType === "word") {
      return this.formatForWord(snippet);
    } else if (appType === "markdown") {
      return this.exportToMarkdown(snippet);
    }
    return this.formatPlainText(snippet);
  }
  detectAppType(windowTitle) {
    const lowerTitle = windowTitle.toLowerCase();
    if (lowerTitle.includes("visual studio code") || lowerTitle.includes("vscode") || lowerTitle.includes(" - code")) {
      return "vscode";
    }
    if (lowerTitle.includes("word") || lowerTitle.includes(".doc") || lowerTitle.includes("microsoft word")) {
      return "word";
    }
    if (lowerTitle.includes(".md") || lowerTitle.includes("markdown") || lowerTitle.includes("obsidian") || lowerTitle.includes("notion")) {
      return "markdown";
    }
    return "other";
  }
  formatForVSCode(snippet) {
    const textItems = snippet.items.filter((i) => i.type === "text");
    if (textItems.length === 1) {
      const content = textItems[0].content || "";
      if (this.looksLikeCode(content)) {
        return content;
      }
    }
    const allText = textItems.map((i) => i.content || "").join("\n\n");
    if (this.looksLikeCode(allText)) {
      return allText;
    }
    return this.formatPlainText(snippet);
  }
  formatForWord(snippet) {
    return this.formatPlainText(snippet);
  }
  formatPlainText(snippet) {
    return snippet.items.filter((i) => i.type === "text" || i.type === "file").map((i) => i.content || "").filter((c) => c.trim()).join("\n\n");
  }
}
const snippetService = new SnippetService();
async function getActiveWindowTitle() {
  if (process.platform === "win32") {
    return getWindowsActiveWindow();
  } else if (process.platform === "darwin") {
    return getMacActiveWindow();
  } else {
    return getLinuxActiveWindow();
  }
}
function getWindowsActiveWindow() {
  return new Promise((resolve) => {
    const psScript = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
          [DllImport("user32.dll")]
          public static extern int GetWindowText(IntPtr hWnd, System.Text.StringBuilder text, int count);
        }
      "@
      $hWnd = [Win32]::GetForegroundWindow()
      $text = New-Object System.Text.StringBuilder 256
      [Win32]::GetWindowText($hWnd, $text, 256) | Out-Null
      $text.ToString()
    `;
    child_process.exec(`powershell -NoProfile -Command "${psScript}"`, (error, stdout) => {
      if (error) {
        resolve("");
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
function getMacActiveWindow() {
  return new Promise((resolve) => {
    child_process.exec(
      `osascript -e 'tell application "System Events" to get name of first application process whose frontmost is true'`,
      (error, stdout) => {
        if (error) {
          resolve("");
        } else {
          resolve(stdout.trim());
        }
      }
    );
  });
}
function getLinuxActiveWindow() {
  return new Promise((resolve) => {
    child_process.exec("xdotool getactivewindow getwindowname", (error, stdout) => {
      if (error) {
        resolve("");
      } else {
        resolve(stdout.trim());
      }
    });
  });
}
function setupIpcHandlers(mainWindow2, floatWindow2) {
  electron.ipcMain.handle("clipboard:list", async (_event, page = 1, pageSize = 50, type) => {
    return db.getClipboardList(page, pageSize, type);
  });
  electron.ipcMain.handle("clipboard:search", async (_event, query) => {
    return db.searchClipboard(query);
  });
  electron.ipcMain.handle("clipboard:copy", async (_event, id) => {
    const item = db.getClipboardById(id);
    if (!item) return false;
    return clipboardMonitor.copyToClipboard(item);
  });
  electron.ipcMain.handle("clipboard:delete", async (_event, id) => {
    return db.deleteClipboard(id);
  });
  electron.ipcMain.handle("clipboard:favorite", async (_event, id) => {
    return db.toggleFavorite(id);
  });
  electron.ipcMain.handle("clipboard:get", async (_event, id) => {
    return db.getClipboardById(id);
  });
  electron.ipcMain.handle("settings:get", async (_event, key) => {
    return db.getSetting(key);
  });
  electron.ipcMain.handle("settings:set", async (_event, key, value) => {
    return db.setSetting(key, value);
  });
  electron.ipcMain.handle("settings:all", async () => {
    return db.getAllSettings();
  });
  electron.ipcMain.handle("db:vacuum", async () => {
    return db.vacuum();
  });
  electron.ipcMain.handle("db:cleanup", async () => {
    return scheduler.runCleanupNow();
  });
  electron.ipcMain.handle("db:stats", async () => {
    return {
      totalCount: db.getTotalCount(),
      size: db.getDatabaseSize()
    };
  });
  electron.ipcMain.handle("sync:enable", async () => {
    const port = parseInt(db.getSetting("syncPort") || "8972", 10);
    const result = await syncService.enable(port);
    if (result) {
      db.setSetting("enableSync", "true");
    }
    return result;
  });
  electron.ipcMain.handle("sync:disable", async () => {
    const result = syncService.disable();
    if (result) {
      db.setSetting("enableSync", "false");
    }
    return result;
  });
  electron.ipcMain.handle("sync:peers", async () => {
    return syncService.getPeers();
  });
  electron.ipcMain.handle("sync:status", async () => {
    return syncService.isSyncEnabled();
  });
  electron.ipcMain.handle("snippets:list", async () => {
    return snippetService.getAllSnippets();
  });
  electron.ipcMain.handle("snippets:get", async (_event, id) => {
    return snippetService.getSnippet(id);
  });
  electron.ipcMain.handle("snippets:create", async (_event, name, description, items) => {
    const snippet = snippetService.createSnippetFromItems(name, description, items);
    if (snippet) {
      syncService.broadcastSnippet("create", snippet);
    }
    return snippet;
  });
  electron.ipcMain.handle("snippets:update", async (_event, snippet) => {
    const updated = snippetService.updateSnippet(snippet);
    if (updated) {
      syncService.broadcastSnippet("update", updated);
    }
    return updated;
  });
  electron.ipcMain.handle("snippets:delete", async (_event, id) => {
    const success = snippetService.deleteSnippet(id);
    if (success) {
      syncService.broadcastSnippet("delete", { id });
    }
    return success;
  });
  electron.ipcMain.handle("snippets:reorder", async (_event, snippetId, itemOrders) => {
    return snippetService.reorderItems(snippetId, itemOrders);
  });
  electron.ipcMain.handle("snippets:export-markdown", async (_event, id) => {
    const snippet = snippetService.getSnippet(id);
    if (!snippet) return null;
    return snippetService.exportToMarkdown(snippet);
  });
  electron.ipcMain.handle("snippets:smart-paste", async (_event, id) => {
    const snippet = snippetService.getSnippet(id);
    if (!snippet) return false;
    const windowTitle = await getActiveWindowTitle();
    const content = snippetService.formatForSmartPaste(snippet, windowTitle);
    electron.clipboard.writeText(content);
    return true;
  });
  electron.ipcMain.handle("snippets:copy", async (_event, id) => {
    const snippet = snippetService.getSnippet(id);
    if (!snippet) return false;
    const content = snippet.items.filter((i) => i.type === "text" || i.type === "file").map((i) => i.content || "").filter((c) => c.trim()).join("\n\n");
    electron.clipboard.writeText(content);
    return true;
  });
  electron.ipcMain.handle("window:close-main", () => {
    mainWindow2 == null ? void 0 : mainWindow2.hide();
    return true;
  });
  electron.ipcMain.handle("window:close-float", () => {
    floatWindow2 == null ? void 0 : floatWindow2.hide();
    return true;
  });
  electron.ipcMain.handle("window:show-settings", () => {
    mainWindow2 == null ? void 0 : mainWindow2.show();
    mainWindow2 == null ? void 0 : mainWindow2.webContents.send("navigate", "settings");
    return true;
  });
  clipboardMonitor.setOnNewItemCallback((item) => {
    mainWindow2 == null ? void 0 : mainWindow2.webContents.send("clipboard:new", item);
    floatWindow2 == null ? void 0 : floatWindow2.webContents.send("clipboard:new", item);
    syncService.broadcastItem(item);
  });
  ocrService.setCallback((id, text, _error) => {
    if (text) {
      const item = db.getClipboardById(id);
      if (item) {
        mainWindow2 == null ? void 0 : mainWindow2.webContents.send("ocr:complete", { id, text });
        floatWindow2 == null ? void 0 : floatWindow2.webContents.send("ocr:complete", { id, text });
      }
    }
  });
  syncService.setOnNewItemCallback((item) => {
    mainWindow2 == null ? void 0 : mainWindow2.webContents.send("clipboard:new", item);
    floatWindow2 == null ? void 0 : floatWindow2.webContents.send("clipboard:new", item);
  });
  syncService.setOnPeerChangeCallback(() => {
    mainWindow2 == null ? void 0 : mainWindow2.webContents.send("sync:peers-changed");
  });
  syncService.setOnSnippetChangeCallback(() => {
    mainWindow2 == null ? void 0 : mainWindow2.webContents.send("snippets:changed");
  });
}
process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
let mainWindow = null;
let floatWindow = null;
const isDev = !electron.app.isPackaged;
function createMainWindow() {
  mainWindow = new electron.BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 700,
    minHeight: 500,
    frame: false,
    transparent: true,
    resizable: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:33445#/main");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "../dist/index.html"), { hash: "main" });
  }
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("close", (e) => {
    e.preventDefault();
    mainWindow == null ? void 0 : mainWindow.hide();
  });
}
function createFloatWindow() {
  floatWindow = new electron.BrowserWindow({
    width: 650,
    height: 500,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      nodeIntegration: false,
      contextIsolation: true
    }
  });
  if (isDev) {
    floatWindow.loadURL("http://localhost:33445#/float");
  } else {
    floatWindow.loadFile(path.join(__dirname, "../dist/index.html"), { hash: "float" });
  }
  floatWindow.on("blur", () => {
    floatWindow == null ? void 0 : floatWindow.hide();
  });
  floatWindow.on("closed", () => {
    floatWindow = null;
  });
}
function positionFloatWindow() {
  if (!floatWindow) return;
  const cursorPoint = electron.screen.getCursorScreenPoint();
  const display = electron.screen.getDisplayNearestPoint({ x: cursorPoint.x, y: cursorPoint.y });
  const workArea = display.workArea;
  const windowWidth = 650;
  const windowHeight = 500;
  const x = Math.floor(workArea.x + (workArea.width - windowWidth) / 2);
  const y = Math.floor(workArea.y + (workArea.height - windowHeight) / 3);
  floatWindow.setPosition(x, y);
}
function registerShortcuts() {
  const shortcut = db.getSetting("shortcut") || "CmdOrCtrl+Shift+V";
  electron.globalShortcut.register(shortcut, () => {
    if (floatWindow == null ? void 0 : floatWindow.isVisible()) {
      floatWindow.hide();
    } else {
      positionFloatWindow();
      floatWindow == null ? void 0 : floatWindow.show();
      floatWindow == null ? void 0 : floatWindow.focus();
      floatWindow == null ? void 0 : floatWindow.webContents.send("float:focus-search");
    }
  });
}
async function initServices() {
  db.init();
  imageStore.init();
  syncService.init();
  snippetService.setDeviceId(syncService.getDeviceId());
  const enableSync = db.getSetting("enableSync") === "true";
  if (enableSync) {
    const port = parseInt(db.getSetting("syncPort") || "8972", 10);
    await syncService.enable(port);
  }
  clipboardMonitor.start();
  scheduler.start();
}
electron.app.whenReady().then(async () => {
  await initServices();
  createMainWindow();
  createFloatWindow();
  if (mainWindow && floatWindow) {
    trayManager.setWindows(mainWindow, floatWindow);
    trayManager.create();
    setupIpcHandlers(mainWindow, floatWindow);
  }
  registerShortcuts();
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") ;
});
electron.app.on("before-quit", async () => {
  electron.globalShortcut.unregisterAll();
  clipboardMonitor.stop();
  scheduler.stop();
  syncService.disable();
  await ocrService.terminate();
  db.close();
  trayManager.destroy();
});
electron.app.on("will-quit", () => {
  electron.globalShortcut.unregisterAll();
});
//# sourceMappingURL=index.js.map
