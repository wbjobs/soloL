export interface TransferRecord {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  merkleRoot: string;
  chunkHashes: string[];
  completedChunks: number[];
  peerId: string;
  direction: 'send' | 'receive';
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
}

export interface ChunkRecord {
  fileId: string;
  chunkIndex: number;
  hash: string;
  size: number;
  data?: ArrayBuffer;
  transferredAt: number;
}

const DB_NAME = 'webrtc_transfer_db';
const DB_VERSION = 1;
const STORE_TRANSFERS = 'transfers';
const STORE_CHUNKS = 'chunks';

class TransferDatabase {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.db) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains(STORE_TRANSFERS)) {
          const transferStore = db.createObjectStore(STORE_TRANSFERS, { keyPath: 'fileId' });
          transferStore.createIndex('peerId', 'peerId', { unique: false });
          transferStore.createIndex('status', 'status', { unique: false });
          transferStore.createIndex('updatedAt', 'updatedAt', { unique: false });
        }

        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          const chunkStore = db.createObjectStore(STORE_CHUNKS, { keyPath: ['fileId', 'chunkIndex'] });
          chunkStore.createIndex('fileId', 'fileId', { unique: false });
          chunkStore.createIndex('chunkIndex', 'chunkIndex', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = (event.target as IDBOpenDBRequest).result;
        resolve();
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });

    return this.initPromise;
  }

  private async ensureDb(): Promise<IDBDatabase> {
    if (!this.db) {
      await this.init();
    }
    if (!this.db) throw new Error('Database not initialized');
    return this.db;
  }

  async saveTransfer(transfer: TransferRecord): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readwrite');
      const store = tx.objectStore(STORE_TRANSFERS);
      const request = store.put({ ...transfer, updatedAt: Date.now() });
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getTransfer(fileId: string): Promise<TransferRecord | null> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readonly');
      const store = tx.objectStore(STORE_TRANSFERS);
      const request = store.get(fileId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getTransfersByPeer(peerId: string): Promise<TransferRecord[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readonly');
      const store = tx.objectStore(STORE_TRANSFERS);
      const index = store.index('peerId');
      const request = index.getAll(peerId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async getIncompleteTransfers(): Promise<TransferRecord[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readonly');
      const store = tx.objectStore(STORE_TRANSFERS);
      const request = store.getAll();
      request.onsuccess = () => {
        const transfers = request.result || [];
        resolve(transfers.filter((t: TransferRecord) => t.status === 'pending' || t.status === 'in-progress'));
      };
      request.onerror = () => reject(request.error);
    });
  }

  async updateTransferProgress(fileId: string, completedChunks: number[]): Promise<void> {
    const transfer = await this.getTransfer(fileId);
    if (transfer) {
      transfer.completedChunks = completedChunks;
      if (completedChunks.length === transfer.totalChunks) {
        transfer.status = 'completed';
      } else if (completedChunks.length > 0) {
        transfer.status = 'in-progress';
      }
      await this.saveTransfer(transfer);
    }
  }

  async deleteTransfer(fileId: string): Promise<void> {
    const db = await this.ensureDb();

    const tx1 = db.transaction(STORE_CHUNKS, 'readwrite');
    const chunkStore = tx1.objectStore(STORE_CHUNKS);
    const chunkIndex = chunkStore.index('fileId');
    const chunkRequest = chunkIndex.getAllKeys(fileId);

    await new Promise<void>((resolve, reject) => {
      chunkRequest.onsuccess = () => {
        const keys = chunkRequest.result || [];
        keys.forEach((key) => chunkStore.delete(key));
        tx1.oncomplete = () => resolve();
        tx1.onerror = () => reject(tx1.error);
      };
      chunkRequest.onerror = () => reject(chunkRequest.error);
    });

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TRANSFERS, 'readwrite');
      const store = tx.objectStore(STORE_TRANSFERS);
      const request = store.delete(fileId);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async saveChunk(chunk: ChunkRecord): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      const store = tx.objectStore(STORE_CHUNKS);
      const request = store.put(chunk);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getChunk(fileId: string, chunkIndex: number): Promise<ChunkRecord | null> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const store = tx.objectStore(STORE_CHUNKS);
      const request = store.get([fileId, chunkIndex]);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  async getChunksByFile(fileId: string): Promise<ChunkRecord[]> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readonly');
      const store = tx.objectStore(STORE_CHUNKS);
      const index = store.index('fileId');
      const request = index.getAll(fileId);
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  }

  async chunkExists(fileId: string, chunkIndex: number): Promise<boolean> {
    const chunk = await this.getChunk(fileId, chunkIndex);
    return chunk !== null;
  }

  async deleteChunksByFile(fileId: string): Promise<void> {
    const db = await this.ensureDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHUNKS, 'readwrite');
      const store = tx.objectStore(STORE_CHUNKS);
      const index = store.index('fileId');
      const request = index.getAllKeys(fileId);
      request.onsuccess = () => {
        const keys = request.result || [];
        keys.forEach((key) => store.delete(key));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
    }
  }
}

export const transferDb = new TransferDatabase();

export async function initDb(): Promise<void> {
  await transferDb.init();
}
