import { openDB } from 'idb'

const DB_NAME = 'midi_visualizer_db'
const DB_VERSION = 1

const STORES = {
  OPERATION_LOGS: 'operation_logs',
  ANNOTATION_HISTORY: 'annotation_history',
  CHORD_MODEL: 'chord_model',
  SETTINGS: 'settings'
}

class LocalDB {
  constructor() {
    this.db = null
    this.initPromise = null
  }

  async init() {
    if (this.db) return this.db
    
    if (this.initPromise) return this.initPromise

    this.initPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORES.OPERATION_LOGS)) {
          const logStore = db.createObjectStore(STORES.OPERATION_LOGS, {
            keyPath: 'id',
            autoIncrement: true
          })
          logStore.createIndex('midi_id', 'midi_id')
          logStore.createIndex('timestamp', 'timestamp')
          logStore.createIndex('type', 'type')
        }

        if (!db.objectStoreNames.contains(STORES.ANNOTATION_HISTORY)) {
          const historyStore = db.createObjectStore(STORES.ANNOTATION_HISTORY, {
            keyPath: 'history_id',
            autoIncrement: true
          })
          historyStore.createIndex('midi_id', 'midi_id')
          historyStore.createIndex('annotation_id', 'annotation_id')
          historyStore.createIndex('version', 'version')
          historyStore.createIndex('timestamp', 'timestamp')
        }

        if (!db.objectStoreNames.contains(STORES.CHORD_MODEL)) {
          db.createObjectStore(STORES.CHORD_MODEL, { keyPath: 'id' })
        }

        if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
          db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' })
        }
      }
    })

    this.db = await this.initPromise
    return this.db
  }

  async logOperation(operation) {
    await this.init()
    
    const log = {
      ...operation,
      timestamp: new Date().toISOString()
    }
    
    return this.db.add(STORES.OPERATION_LOGS, log)
  }

  async getOperationLogs(midiId, limit = 100) {
    await this.init()
    
    let logs
    if (midiId) {
      const index = this.db.transaction(STORES.OPERATION_LOGS).store.index('midi_id')
      logs = await index.getAll(IDBKeyRange.only(midiId))
    } else {
      logs = await this.db.getAll(STORES.OPERATION_LOGS)
    }
    
    return logs
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit)
  }

  async clearOperationLogs(midiId) {
    await this.init()
    
    if (midiId) {
      const tx = this.db.transaction(STORES.OPERATION_LOGS, 'readwrite')
      const index = tx.store.index('midi_id')
      let cursor = await index.openCursor(IDBKeyRange.only(midiId))
      while (cursor) {
        await cursor.delete()
        cursor = await cursor.continue()
      }
    } else {
      await this.db.clear(STORES.OPERATION_LOGS)
    }
  }

  async saveAnnotationSnapshot(midiId, annotations, version) {
    await this.init()
    
    const snapshot = {
      midi_id: midiId,
      annotations: JSON.parse(JSON.stringify(annotations)),
      version: version,
      timestamp: new Date().toISOString()
    }
    
    return this.db.add(STORES.ANNOTATION_HISTORY, snapshot)
  }

  async getAnnotationHistory(midiId) {
    await this.init()
    
    const index = this.db.transaction(STORES.ANNOTATION_HISTORY).store.index('midi_id')
    const snapshots = await index.getAll(IDBKeyRange.only(midiId))
    
    return snapshots.sort((a, b) => a.version - b.version)
  }

  async getSnapshotByVersion(midiId, version) {
    await this.init()
    
    const tx = this.db.transaction(STORES.ANNOTATION_HISTORY)
    const index = tx.store.index('midi_id')
    const snapshots = await index.getAll(IDBKeyRange.only(midiId))
    
    return snapshots.find(s => s.version === version) || null
  }

  async getLatestSnapshot(midiId) {
    await this.init()
    
    const index = this.db.transaction(STORES.ANNOTATION_HISTORY).store.index('midi_id')
    const snapshots = await index.getAll(IDBKeyRange.only(midiId))
    
    if (snapshots.length === 0) return null
    
    return snapshots.reduce((latest, current) => 
      current.version > latest.version ? current : latest
    )
  }

  async clearHistory(midiId, keepLatest = 10) {
    await this.init()
    
    const index = this.db.transaction(STORES.ANNOTATION_HISTORY, 'readwrite')
    const midiIndex = index.store.index('midi_id')
    let snapshots = await midiIndex.getAll(IDBKeyRange.only(midiId))
    
    if (snapshots.length <= keepLatest) return
    
    snapshots.sort((a, b) => a.version - b.version)
    const toDelete = snapshots.slice(0, snapshots.length - keepLatest)
    
    for (const snap of toDelete) {
      await index.store.delete(snap.history_id)
    }
  }

  async saveSetting(key, value) {
    await this.init()
    return this.db.put(STORES.SETTINGS, { key, value })
  }

  async getSetting(key, defaultValue = null) {
    await this.init()
    const result = await this.db.get(STORES.SETTINGS, key)
    return result ? result.value : defaultValue
  }

  async getAllSettings() {
    await this.init()
    const entries = await this.db.getAll(STORES.SETTINGS)
    return entries.reduce((acc, entry) => {
      acc[entry.key] = entry.value
      return acc
    }, {})
  }

  async close() {
    if (this.db) {
      await this.db.close()
      this.db = null
    }
  }
}

export const localDB = new LocalDB()
export default localDB
