import axios from 'axios';

const DB_NAME = 'spatial_anchors_db';
const DB_VERSION = 1;
const STORES = ['local_anchors', 'pending_anchor_ops', 'share_codes'];

const AZURE_CONFIG = {
  accountId: import.meta.env?.VITE_AZURE_SPATIAL_ANCHORS_ACCOUNT_ID || '',
  accountKey: import.meta.env?.VITE_AZURE_SPATIAL_ANCHORS_ACCOUNT_KEY || '',
  accountDomain: import.meta.env?.VITE_AZURE_SPATIAL_ANCHORS_ACCOUNT_DOMAIN || '',
};

const isASAConfigured = !!(AZURE_CONFIG.accountId && AZURE_CONFIG.accountKey && AZURE_CONFIG.accountDomain);

let db = null;
let session = null;
let sessionStatus = 'idle';
let errorListeners = [];
let statusListeners = [];
let anchorLocatedListeners = [];

function generateDeterministicId(position) {
  const x = Math.round((position.x || 0) * 1000);
  const y = Math.round((position.y || 0) * 1000);
  const z = Math.round((position.z || 0) * 1000);
  const hash = (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
  const hex = Math.abs(hash).toString(16).padStart(8, '0');
  return `anchor-${hex}-${Date.now().toString(36).substr(-4)}`;
}

function generateShareCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
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
          store.createIndex('anchorId', 'anchorId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('expiresAt', 'expiresAt', { unique: false });
          store.createIndex('shareCode', 'shareCode', { unique: true });
        }
      });
    };
  });
}

async function dbGetAll(storeName) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbGet(storeName, id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function dbPut(storeName, data) {
  await openDB();
  const item = {
    ...data,
    updatedAt: Date.now(),
  };
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(item);
    request.onsuccess = () => resolve(item);
    request.onerror = () => reject(request.error);
  });
}

async function dbDelete(storeName, id) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

async function dbGetByIndex(storeName, indexName, value) {
  await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const index = store.index(indexName);
    const request = index.getAll(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function setSessionStatus(status) {
  sessionStatus = status;
  statusListeners.forEach((cb) => cb(status));
}

function notifyError(error) {
  errorListeners.forEach((cb) => cb(error));
}

function notifyAnchorLocated(anchor) {
  anchorLocatedListeners.forEach((cb) => cb(anchor));
}

async function initASASession() {
  if (!isASAConfigured) {
    console.log('[SpatialAnchors] ASA not configured, using demo mode');
    setSessionStatus('ready');
    return;
  }

  try {
    setSessionStatus('initializing');

    if (typeof window !== 'undefined' && window.Microsoft && window.Microsoft.SpatialAnchors) {
      const SpatialAnchors = window.Microsoft.SpatialAnchors;
      session = new SpatialAnchors.CloudSpatialAnchorSession();
      session.configuration.accountId = AZURE_CONFIG.accountId;
      session.configuration.accountKey = AZURE_CONFIG.accountKey;
      session.configuration.accountDomain = AZURE_CONFIG.accountDomain;

      session.error = (s, args) => {
        console.error('[SpatialAnchors] Session error:', args.errorMessage);
        notifyError(new Error(args.errorMessage));
      };

      session.anchorLocated = (s, args) => {
        console.log('[SpatialAnchors] Anchor located:', args.anchor?.identifier);
        if (args.anchor) {
          notifyAnchorLocated({
            id: args.anchor.identifier,
            status: 'located',
            anchor: args.anchor,
          });
        }
      };

      await session.startAsync();
      setSessionStatus('ready');
      console.log('[SpatialAnchors] ASA session started successfully');
    } else {
      console.log('[SpatialAnchors] ASA SDK not available, using demo mode');
      setSessionStatus('ready');
    }
  } catch (err) {
    console.error('[SpatialAnchors] Failed to initialize ASA session:', err);
    setSessionStatus('error');
    notifyError(err);
    throw err;
  }
}

async function createASASession() {
  await initASASession();
  return session;
}

async function startSession() {
  if (sessionStatus === 'ready') {
    return;
  }
  await initASASession();
}

async function stopSession() {
  try {
    if (session && session.stopAsync) {
      await session.stopAsync();
    }
    session = null;
    setSessionStatus('idle');
  } catch (err) {
    console.error('[SpatialAnchors] Error stopping session:', err);
  }
}

async function destroySession() {
  await stopSession();
  if (db) {
    db.close();
    db = null;
  }
}

async function createCloudAnchorASA(position, rotation) {
  if (!session || !session.createAnchorAsync) {
    throw new Error('ASA session not available');
  }

  const SpatialAnchors = window.Microsoft.SpatialAnchors;
  const localAnchor = new SpatialAnchors.CloudSpatialAnchor();

  localAnchor.localAnchor = {
    position: { x: position.x, y: position.y, z: position.z },
    rotation: rotation || { x: 0, y: 0, z: 0, w: 1 },
  };

  localAnchor.expiration = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const cloudAnchor = await session.createAnchorAsync(localAnchor);
  return {
    id: cloudAnchor.identifier,
    anchorData: JSON.stringify({
      identifier: cloudAnchor.identifier,
      expiration: cloudAnchor.expiration,
    }),
  };
}

async function createCloudAnchorDemo(position, rotation, equipmentId) {
  const anchorId = generateDeterministicId(position);

  const anchorData = {
    id: anchorId,
    position: { x: position.x, y: position.y, z: position.z },
    rotation: rotation || { x: 0, y: 0, z: 0, w: 1 },
    equipmentId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    isDemo: true,
  };

  await dbPut('local_anchors', {
    id: anchorId,
    anchorId,
    ...anchorData,
    status: 'synced',
    isLocal: true,
  });

  return {
    id: anchorId,
    anchorData: JSON.stringify(anchorData),
  };
}

async function createAnchor(position, rotation, options = {}) {
  const { equipmentId, creator = 'anonymous', saveToBackend = true } = options;

  try {
    setSessionStatus('creating');

    let cloudResult;

    if (isASAConfigured && session && session.createAnchorAsync) {
      cloudResult = await createCloudAnchorASA(position, rotation);
    } else {
      cloudResult = await createCloudAnchorDemo(position, rotation, equipmentId);
    }

    const anchor = {
      id: cloudResult.id,
      anchor_id: cloudResult.id,
      position: { x: position.x, y: position.y, z: position.z },
      rotation: rotation || { x: 0, y: 0, z: 0, w: 1 },
      equipment_id: equipmentId || null,
      creator,
      shared: false,
      anchor_data: cloudResult.anchorData,
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      created_at: new Date().toISOString(),
      status: 'located',
      isLocal: true,
      isDemo: !isASAConfigured,
    };

    await dbPut('local_anchors', {
      id: anchor.id,
      ...anchor,
      status: 'synced',
    });

    if (saveToBackend && navigator.onLine) {
      try {
        const response = await axios.post('/api/spatial-anchors', anchor);
        if (response.data) {
          Object.assign(anchor, response.data);
          await dbPut('local_anchors', {
            id: anchor.id,
            ...anchor,
            status: 'synced',
          });
        }
      } catch (err) {
        console.warn('[SpatialAnchors] Failed to save anchor to backend, queuing for later:', err);
        await dbPut('pending_anchor_ops', {
          id: `create_${anchor.id}_${Date.now()}`,
          type: 'create',
          data: anchor,
          status: 'pending',
          retryCount: 0,
          createdAt: Date.now(),
        });
      }
    }

    setSessionStatus('ready');
    notifyAnchorLocated(anchor);
    return anchor;
  } catch (err) {
    console.error('[SpatialAnchors] Failed to create anchor:', err);
    setSessionStatus('error');
    notifyError(err);
    throw err;
  }
}

async function locateAnchorASA(anchorId) {
  if (!session || !session.createWatcher) {
    throw new Error('ASA session not available');
  }

  const SpatialAnchors = window.Microsoft.SpatialAnchors;
  const criteria = new SpatialAnchors.AnchorLocateCriteria();
  criteria.identifiers = [anchorId];

  const watcher = session.createWatcher(criteria);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      watcher.stop();
      reject(new Error('Anchor locate timeout'));
    }, 30000);

    const handleLocated = (s, args) => {
      if (args.anchor && args.anchor.identifier === anchorId) {
        clearTimeout(timeout);
        watcher.stop();
        session.anchorLocated.remove(handleLocated);
        resolve({
          id: args.anchor.identifier,
          status: 'located',
          anchor: args.anchor,
        });
      }
    };

    session.anchorLocated.add(handleLocated);
  });
}

async function locateAnchorDemo(anchorId) {
  const localAnchor = await dbGet('local_anchors', anchorId);
  if (localAnchor) {
    return {
      ...localAnchor,
      status: 'located',
    };
  }

  try {
    const response = await axios.get(`/api/spatial-anchors/${anchorId}`);
    if (response.data) {
      const anchor = {
        ...response.data,
        status: 'located',
        isLocal: false,
      };
      await dbPut('local_anchors', {
        id: anchor.id,
        ...anchor,
        status: 'synced',
      });
      return anchor;
    }
  } catch (err) {
    console.warn('[SpatialAnchors] Failed to fetch anchor from backend:', err);
  }

  throw new Error(`Anchor ${anchorId} not found`);
}

async function locateAnchor(anchorId) {
  try {
    setSessionStatus('locating');

    let result;
    if (isASAConfigured && session && session.createWatcher) {
      result = await locateAnchorASA(anchorId);
    } else {
      result = await locateAnchorDemo(anchorId);
    }

    setSessionStatus('ready');
    notifyAnchorLocated(result);
    return result;
  } catch (err) {
    console.error('[SpatialAnchors] Failed to locate anchor:', err);
    setSessionStatus('error');
    notifyError(err);
    throw err;
  }
}

async function listNearbyAnchors(position, radius = 50) {
  try {
    const localAnchors = await dbGetAll('local_anchors');

    let backendAnchors = [];
    if (navigator.onLine) {
      try {
        const params = {};
        if (position && position.lat !== undefined) {
          params.lat = position.lat;
          params.lon = position.lon;
          params.radius = radius;
        }
        const response = await axios.get('/api/spatial-anchors', { params });
        backendAnchors = response.data || [];
      } catch (err) {
        console.warn('[SpatialAnchors] Failed to fetch anchors from backend:', err);
      }
    }

    const anchorMap = new Map();

    localAnchors.forEach((a) => {
      anchorMap.set(a.id || a.anchor_id, { ...a, status: a.status || 'located' });
    });

    backendAnchors.forEach((a) => {
      const id = a.id || a.anchor_id;
      if (anchorMap.has(id)) {
        anchorMap.set(id, { ...anchorMap.get(id), ...a, status: 'located' });
      } else {
        anchorMap.set(id, { ...a, status: 'located', isLocal: false });
      }
    });

    const allAnchors = Array.from(anchorMap.values());

    if (position && position.x !== undefined) {
      return allAnchors
        .map((a) => {
          const dx = (a.position?.x || 0) - position.x;
          const dy = (a.position?.y || 0) - position.y;
          const dz = (a.position?.z || 0) - position.z;
          const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
          return { ...a, distance };
        })
        .filter((a) => a.distance <= radius)
        .sort((a, b) => a.distance - b.distance);
    }

    return allAnchors.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch (err) {
    console.error('[SpatialAnchors] Failed to list nearby anchors:', err);
    throw err;
  }
}

async function deleteAnchor(anchorId) {
  try {
    setSessionStatus('deleting');

    if (session && session.deleteAnchorAsync) {
      try {
        await session.deleteAnchorAsync(anchorId);
      } catch (err) {
        console.warn('[SpatialAnchors] Failed to delete from ASA:', err);
      }
    }

    await dbDelete('local_anchors', anchorId);

    if (navigator.onLine) {
      try {
        await axios.delete(`/api/spatial-anchors/${anchorId}`);
      } catch (err) {
        console.warn('[SpatialAnchors] Failed to delete from backend, queuing:', err);
        await dbPut('pending_anchor_ops', {
          id: `delete_${anchorId}_${Date.now()}`,
          type: 'delete',
          anchorId,
          status: 'pending',
          retryCount: 0,
          createdAt: Date.now(),
        });
      }
    }

    setSessionStatus('ready');
    return true;
  } catch (err) {
    console.error('[SpatialAnchors] Failed to delete anchor:', err);
    setSessionStatus('error');
    notifyError(err);
    throw err;
  }
}

async function getAnchorShareUrl(anchorId) {
  try {
    const shareCode = generateShareCode();
    const anchor = await dbGet('local_anchors', anchorId);

    if (!anchor) {
      throw new Error(`Anchor ${anchorId} not found`);
    }

    const shareRecord = {
      id: shareCode,
      shareCode,
      anchorId,
      anchorData: anchor.anchor_data || JSON.stringify(anchor),
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    };

    await dbPut('share_codes', shareRecord);

    if (navigator.onLine) {
      try {
        const response = await axios.post(`/api/spatial-anchors/${anchorId}/share`, {
          shareCode,
          expiresAt: shareRecord.expiresAt,
        });
        if (response.data?.shareCode) {
          return {
            shareCode: response.data.shareCode,
            shareUrl: `${window.location.origin}/anchor/${response.data.shareCode}`,
            expiresAt: response.data.expiresAt || shareRecord.expiresAt,
          };
        }
      } catch (err) {
        console.warn('[SpatialAnchors] Failed to create share on backend:', err);
      }
    }

    return {
      shareCode,
      shareUrl: `${window.location.origin}/anchor/${shareCode}`,
      expiresAt: shareRecord.expiresAt,
      isLocal: true,
    };
  } catch (err) {
    console.error('[SpatialAnchors] Failed to get share URL:', err);
    throw err;
  }
}

async function importAnchorByShareCode(shareCode) {
  try {
    const normalizedCode = shareCode.toUpperCase().trim();

    if (navigator.onLine) {
      try {
        const response = await axios.post('/api/spatial-anchors/import', {
          shareCode: normalizedCode,
        });
        if (response.data) {
          const anchor = {
            ...response.data,
            status: 'located',
            isLocal: false,
            importedAt: new Date().toISOString(),
          };
          await dbPut('local_anchors', {
            id: anchor.id,
            ...anchor,
            status: 'synced',
          });
          notifyAnchorLocated(anchor);
          return anchor;
        }
      } catch (err) {
        console.warn('[SpatialAnchors] Failed to import from backend:', err);
      }
    }

    const localShare = await dbGet('share_codes', normalizedCode);
    if (localShare && localShare.expiresAt > Date.now()) {
      const anchorData = typeof localShare.anchorData === 'string'
        ? JSON.parse(localShare.anchorData)
        : localShare.anchorData;

      const anchor = {
        ...anchorData,
        id: localShare.anchorId,
        anchor_id: localShare.anchorId,
        status: 'located',
        isLocal: true,
        importedAt: new Date().toISOString(),
      };

      await dbPut('local_anchors', {
        id: anchor.id,
        ...anchor,
        status: 'synced',
      });

      notifyAnchorLocated(anchor);
      return anchor;
    }

    throw new Error('Share code not found or expired');
  } catch (err) {
    console.error('[SpatialAnchors] Failed to import anchor:', err);
    throw err;
  }
}

async function getNearbyAnchorsFromBackend(lat, lon, radius) {
  try {
    const response = await axios.get('/api/spatial-anchors/nearby', {
      params: { lat, lon, radius },
    });
    return response.data || [];
  } catch (err) {
    console.error('[SpatialAnchors] Failed to get nearby anchors from backend:', err);
    throw err;
  }
}

async function processPendingOperations() {
  if (!navigator.onLine) return;

  try {
    const pendingOps = await dbGetByIndex('pending_anchor_ops', 'status', 'pending');

    for (const op of pendingOps) {
      try {
        if (op.type === 'create') {
          await axios.post('/api/spatial-anchors', op.data);
          await dbDelete('pending_anchor_ops', op.id);
        } else if (op.type === 'delete') {
          await axios.delete(`/api/spatial-anchors/${op.anchorId}`);
          await dbDelete('pending_anchor_ops', op.id);
        } else if (op.type === 'update') {
          await axios.put(`/api/spatial-anchors/${op.anchorId}`, op.data);
          await dbDelete('pending_anchor_ops', op.id);
        }
      } catch (err) {
        const newRetryCount = (op.retryCount || 0) + 1;
        if (newRetryCount < 5) {
          await dbPut('pending_anchor_ops', {
            ...op,
            retryCount: newRetryCount,
            lastError: err.message,
          });
        } else {
          await dbPut('pending_anchor_ops', {
            ...op,
            status: 'failed',
            lastError: err.message,
          });
        }
      }
    }
  } catch (err) {
    console.error('[SpatialAnchors] Error processing pending operations:', err);
  }
}

function addErrorListener(callback) {
  errorListeners.push(callback);
  return () => {
    errorListeners = errorListeners.filter((cb) => cb !== callback);
  };
}

function addStatusListener(callback) {
  statusListeners.push(callback);
  return () => {
    statusListeners = statusListeners.filter((cb) => cb !== callback);
  };
}

function addAnchorLocatedListener(callback) {
  anchorLocatedListeners.push(callback);
  return () => {
    anchorLocatedListeners = anchorLocatedListeners.filter((cb) => cb !== callback);
  };
}

function getSessionStatus() {
  return sessionStatus;
}

function isConfigured() {
  return isASAConfigured;
}

function isDemoMode() {
  return !isASAConfigured || !session || !session.createAnchorAsync;
}

async function updateAnchor(anchorId, data) {
  try {
    if (navigator.onLine) {
      const response = await axios.put(`/api/spatial-anchors/${anchorId}`, data);
      if (response.data) {
        const existing = await dbGet('local_anchors', anchorId);
        if (existing) {
          await dbPut('local_anchors', {
            ...existing,
            ...response.data,
            status: 'synced',
          });
        }
        return response.data;
      }
    } else {
      await dbPut('pending_anchor_ops', {
        id: `update_${anchorId}_${Date.now()}`,
        type: 'update',
        anchorId,
        data,
        status: 'pending',
        retryCount: 0,
        createdAt: Date.now(),
      });

      const existing = await dbGet('local_anchors', anchorId);
      if (existing) {
        await dbPut('local_anchors', {
          ...existing,
          ...data,
          status: 'pending',
        });
      }
      return { ...existing, ...data };
    }
  } catch (err) {
    console.error('[SpatialAnchors] Failed to update anchor:', err);
    throw err;
  }
}

async function getPendingOperations() {
  return dbGetByIndex('pending_anchor_ops', 'status', 'pending');
}

async function retryFailedOperations() {
  const failed = await dbGetByIndex('pending_anchor_ops', 'status', 'failed');
  for (const op of failed) {
    await dbPut('pending_anchor_ops', {
      ...op,
      status: 'pending',
      retryCount: 0,
      lastError: null,
    });
  }
  if (navigator.onLine) {
    processPendingOperations();
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    console.log('[SpatialAnchors] Network online, processing pending operations');
    processPendingOperations();
  });

  openDB().catch((err) => {
    console.error('[SpatialAnchors] Failed to initialize IndexedDB:', err);
  });
}

export const spatialAnchors = {
  createASASession,
  startSession,
  stopSession,
  destroySession,
  createAnchor,
  locateAnchor,
  listNearbyAnchors,
  deleteAnchor,
  getAnchorShareUrl,
  importAnchorByShareCode,
  getNearbyAnchorsFromBackend,
  updateAnchor,
  getSessionStatus,
  isConfigured,
  isDemoMode,
  addErrorListener,
  addStatusListener,
  addAnchorLocatedListener,
  processPendingOperations,
  getPendingOperations,
  retryFailedOperations,
};

export default spatialAnchors;
