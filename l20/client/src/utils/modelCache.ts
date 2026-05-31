const DB_NAME = 'mediapipe-model-cache';
const DB_VERSION = 1;
const STORE_NAME = 'model-files';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'url' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function getCachedModel(url: string): Promise<ArrayBuffer | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(url);
      request.onsuccess = () => {
        const result = request.result;
        if (result && result.data) {
          if (result.expiry && Date.now() > result.expiry) {
            deleteCachedModel(url);
            resolve(null);
          } else {
            resolve(result.data);
          }
        } else {
          resolve(null);
        }
      };
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

export async function setCachedModel(
  url: string,
  data: ArrayBuffer,
  ttlMs: number = 7 * 24 * 60 * 60 * 1000
): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put({
        url,
        data,
        timestamp: Date.now(),
        expiry: Date.now() + ttlMs
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silent fail for caching
  }
}

export async function deleteCachedModel(url: string): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(url);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silent fail
  }
}

export async function clearModelCache(): Promise<void> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // silent fail
  }
}

export async function fetchWithCache(url: string): Promise<ArrayBuffer> {
  const cached = await getCachedModel(url);
  if (cached) {
    return cached;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  const data = await response.arrayBuffer();
  await setCachedModel(url, data);
  return data;
}

export function createCachedLocateFile(baseUrl: string) {
  return async (file: string): Promise<string | undefined> => {
    const url = `${baseUrl}/${file}`;
    try {
      const data = await fetchWithCache(url);
      const blob = new Blob([data]);
      const objectUrl = URL.createObjectURL(blob);
      return objectUrl;
    } catch {
      return undefined;
    }
  };
}
