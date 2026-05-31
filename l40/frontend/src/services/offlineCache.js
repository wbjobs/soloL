import { createDefect } from './api';

const DB_NAME = 'mr_inspection_cache';
const DB_VERSION = 1;
const STORES = ['pending_defects', 'voice_recordings', 'speech_transcripts'];
const MAX_RETRIES = 5;

let db = null;
let isProcessing = false;
let retryTimers = new Map();
let onQueueChangeCallback = null;

function getBackoffDelay(attempt) {
  return Math.min(1000 * Math.pow(2, attempt), 30000);
}

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2);
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) {
      resolve(db);
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;

      STORES.forEach((storeName) => {
        if (!database.objectStoreNames.contains(storeName)) {
          const store = database.createObjectStore(storeName, { keyPath: 'id' });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('retryCount', 'retryCount', { unique: false });
        }
      });
    };
  });
}

async function getAll(storeName) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getByStatus(storeName, status) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index('status');
    const request = index.getAll(status);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function addItem(storeName, data) {
  await openDB();
  const item = {
    id: generateId(),
    data,
    status: 'pending',
    retryCount: 0,
    lastError: null,
    createdAt: Date.now(),
  };

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.add(item);

    request.onsuccess = () => {
      notifyQueueChange();
      resolve(item);
    };
    request.onerror = () => reject(request.error);
  });
}

async function updateItem(storeName, item) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);

    request.onsuccess = () => {
      notifyQueueChange();
      resolve(item);
    };
    request.onerror = () => reject(request.error);
  });
}

async function deleteItem(storeName, id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);

    request.onsuccess = () => {
      notifyQueueChange();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

function notifyQueueChange() {
  if (onQueueChangeCallback) {
    getPendingCount().then((count) => {
      getAllPendingItems().then((items) => {
        onQueueChangeCallback({ count, items });
      });
    });
  }
}

async function getAllPendingItems() {
  const [defects, recordings, transcripts] = await Promise.all([
    getByStatus('pending_defects', 'pending'),
    getByStatus('voice_recordings', 'pending'),
    getByStatus('speech_transcripts', 'pending'),
  ]);
  return [...defects, ...recordings, ...transcripts];
}

async function processDefectUpload(item) {
  try {
    await updateItem('pending_defects', { ...item, status: 'retrying' });

    const formData = new FormData();
    Object.entries(item.data).forEach(([key, value]) => {
      if (value instanceof Blob || value instanceof File) {
        formData.append(key, value, value.name || `${key}_${Date.now()}`);
      } else if (typeof value === 'object' && value !== null) {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, value);
      }
    });

    await createDefect(formData);
    await deleteItem('pending_defects', item.id);
    return { success: true, item };
  } catch (err) {
    const newRetryCount = item.retryCount + 1;
    const updatedItem = {
      ...item,
      status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending',
      retryCount: newRetryCount,
      lastError: err.message || 'Upload failed',
    };
    await updateItem('pending_defects', updatedItem);

    if (newRetryCount < MAX_RETRIES) {
      const delay = getBackoffDelay(newRetryCount);
      scheduleRetry('pending_defects', item.id, delay);
    }

    return { success: false, item: updatedItem, error: err };
  }
}

async function processVoiceRecording(item) {
  try {
    await updateItem('voice_recordings', { ...item, status: 'retrying' });
    await deleteItem('voice_recordings', item.id);
    return { success: true, item };
  } catch (err) {
    const newRetryCount = item.retryCount + 1;
    const updatedItem = {
      ...item,
      status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending',
      retryCount: newRetryCount,
      lastError: err.message || 'Upload failed',
    };
    await updateItem('voice_recordings', updatedItem);

    if (newRetryCount < MAX_RETRIES) {
      const delay = getBackoffDelay(newRetryCount);
      scheduleRetry('voice_recordings', item.id, delay);
    }

    return { success: false, item: updatedItem, error: err };
  }
}

async function processSpeechTranscript(item) {
  try {
    await updateItem('speech_transcripts', { ...item, status: 'retrying' });
    await deleteItem('speech_transcripts', item.id);
    return { success: true, item };
  } catch (err) {
    const newRetryCount = item.retryCount + 1;
    const updatedItem = {
      ...item,
      status: newRetryCount >= MAX_RETRIES ? 'failed' : 'pending',
      retryCount: newRetryCount,
      lastError: err.message || 'Upload failed',
    };
    await updateItem('speech_transcripts', updatedItem);

    if (newRetryCount < MAX_RETRIES) {
      const delay = getBackoffDelay(newRetryCount);
      scheduleRetry('speech_transcripts', item.id, delay);
    }

    return { success: false, item: updatedItem, error: err };
  }
}

function scheduleRetry(storeName, itemId, delay) {
  const timerKey = `${storeName}_${itemId}`;
  if (retryTimers.has(timerKey)) {
    clearTimeout(retryTimers.get(timerKey));
  }

  const timer = setTimeout(() => {
    retryTimers.delete(timerKey);
    if (navigator.onLine) {
      processItem(storeName, itemId);
    }
  }, delay);

  retryTimers.set(timerKey, timer);
}

async function processItem(storeName, itemId) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(itemId);

    request.onsuccess = async () => {
      const item = request.result;
      if (!item) {
        resolve(null);
        return;
      }

      let result;
      switch (storeName) {
        case 'pending_defects':
          result = await processDefectUpload(item);
          break;
        case 'voice_recordings':
          result = await processVoiceRecording(item);
          break;
        case 'speech_transcripts':
          result = await processSpeechTranscript(item);
          break;
        default:
          result = { success: false, error: 'Unknown store' };
      }
      resolve(result);
    };

    request.onerror = () => reject(request.error);
  });
}

async function flushQueue() {
  if (isProcessing) return;
  if (!navigator.onLine) {
    console.log('[OfflineCache] Network offline, cannot flush queue');
    return;
  }

  isProcessing = true;

  try {
    const pendingDefects = await getByStatus('pending_defects', 'pending');
    const pendingRecordings = await getByStatus('voice_recordings', 'pending');
    const pendingTranscripts = await getByStatus('speech_transcripts', 'pending');

    const allPending = [
      ...pendingDefects.map((item) => ({ store: 'pending_defects', item })),
      ...pendingRecordings.map((item) => ({ store: 'voice_recordings', item })),
      ...pendingTranscripts.map((item) => ({ store: 'speech_transcripts', item })),
    ];

    for (const { store, item } of allPending) {
      if (!navigator.onLine) break;
      await processItem(store, item.id);
    }
  } catch (err) {
    console.error('[OfflineCache] Flush queue error:', err);
  } finally {
    isProcessing = false;
    notifyQueueChange();
  }
}

async function retryFailedItems() {
  const [failedDefects, failedRecordings, failedTranscripts] = await Promise.all([
    getByStatus('pending_defects', 'failed'),
    getByStatus('voice_recordings', 'failed'),
    getByStatus('speech_transcripts', 'failed'),
  ]);

  const allFailed = [
    ...failedDefects.map((item) => ({ ...item, status: 'pending', retryCount: 0, lastError: null })),
    ...failedRecordings.map((item) => ({ ...item, status: 'pending', retryCount: 0, lastError: null })),
    ...failedTranscripts.map((item) => ({ ...item, status: 'pending', retryCount: 0, lastError: null })),
  ];

  for (const item of allFailed) {
    const storeName = item.data.type === 'defect' ? 'pending_defects' :
      item.data.audioBlob ? 'voice_recordings' : 'speech_transcripts';
    await updateItem(storeName, { ...item, status: 'pending', retryCount: 0, lastError: null });
  }

  if (navigator.onLine) {
    flushQueue();
  }
}

async function getPendingCount() {
  const [defects, recordings, transcripts] = await Promise.all([
    getByStatus('pending_defects', 'pending'),
    getByStatus('voice_recordings', 'pending'),
    getByStatus('speech_transcripts', 'pending'),
  ]);
  return defects.length + recordings.length + transcripts.length;
}

async function getFailedCount() {
  const [defects, recordings, transcripts] = await Promise.all([
    getByStatus('pending_defects', 'failed'),
    getByStatus('voice_recordings', 'failed'),
    getByStatus('speech_transcripts', 'failed'),
  ]);
  return defects.length + recordings.length + transcripts.length;
}

async function getQueueStatus() {
  const [pendingDefects, failedDefects] = await Promise.all([
    getByStatus('pending_defects', 'pending'),
    getByStatus('pending_defects', 'failed'),
  ]);
  return {
    pending: pendingDefects.length,
    failed: failedDefects.length,
    items: [...pendingDefects, ...failedDefects],
    isOnline: navigator.onLine,
    isProcessing,
  };
}

function onQueueChange(callback) {
  onQueueChangeCallback = callback;
  notifyQueueChange();
  return () => {
    onQueueChangeCallback = null;
  };
}

async function addDefect(data) {
  return addItem('pending_defects', { ...data, type: 'defect' });
}

async function addVoiceRecording(data) {
  return addItem('voice_recordings', { ...data, type: 'voice' });
}

async function addSpeechTranscript(data) {
  return addItem('speech_transcripts', { ...data, type: 'transcript' });
}

async function clearAll() {
  await openDB();
  const promises = STORES.map((storeName) => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });
  await Promise.all(promises);
  notifyQueueChange();
}

function handleOnline() {
  console.log('[OfflineCache] Network online, flushing queue');
  flushQueue();
}

function handleOffline() {
  console.log('[OfflineCache] Network offline');
  notifyQueueChange();
}

function init() {
  openDB().then(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('online', handleOnline);
      window.addEventListener('offline', handleOffline);
    }
    if (navigator.onLine) {
      flushQueue();
    }
  }).catch((err) => {
    console.error('[OfflineCache] Failed to initialize:', err);
  });
}

if (typeof window !== 'undefined') {
  init();
}

export const offlineCache = {
  addDefect,
  addVoiceRecording,
  addSpeechTranscript,
  flushQueue,
  retryFailedItems,
  getPendingCount,
  getFailedCount,
  getQueueStatus,
  getAllPendingItems,
  onQueueChange,
  clearAll,
  get isOnline() {
    return typeof navigator !== 'undefined' ? navigator.onLine : true;
  },
  get isProcessing() {
    return isProcessing;
  },
};

export default offlineCache;
