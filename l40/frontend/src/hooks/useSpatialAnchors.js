import { useState, useEffect, useCallback, useRef } from 'react';
import spatialAnchors from '../services/spatialAnchors';
import { offlineCache } from '../services/offlineCache';

export function useSpatialAnchors(options = {}) {
  const { autoInitialize = true, equipmentId, radius = 50 } = options;

  const [anchors, setAnchors] = useState([]);
  const [sessionStatus, setSessionStatus] = useState('idle');
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDemoMode, setIsDemoMode] = useState(true);
  const [isConfigured, setIsConfigured] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [cameraPosition, setCameraPosition] = useState({ x: 0, y: 0, z: 0 });

  const cleanupRef = useRef([]);
  const initializedRef = useRef(false);

  const loadAnchors = useCallback(async () => {
    setIsLoading(true);
    try {
      const nearbyAnchors = await spatialAnchors.listNearbyAnchors(cameraPosition, radius);
      setAnchors(nearbyAnchors);
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to load anchors:', err);
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, [cameraPosition, radius]);

  const createAnchor = useCallback(async (position, rotation, createOptions = {}) => {
    setIsLoading(true);
    setError(null);
    try {
      const newAnchor = await spatialAnchors.createAnchor(position, rotation, {
        equipmentId,
        ...createOptions,
      });

      setAnchors((prev) => {
        const exists = prev.find((a) => a.id === newAnchor.id);
        if (exists) {
          return prev.map((a) => (a.id === newAnchor.id ? newAnchor : a));
        }
        return [...prev, newAnchor];
      });

      return newAnchor;
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to create anchor:', err);
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [equipmentId]);

  const locateAnchor = useCallback(async (anchorId) => {
    setIsLoading(true);
    setError(null);
    try {
      const located = await spatialAnchors.locateAnchor(anchorId);

      setAnchors((prev) => {
        const exists = prev.find((a) => a.id === anchorId || a.anchor_id === anchorId);
        if (exists) {
          return prev.map((a) =>
            (a.id === anchorId || a.anchor_id === anchorId) ? { ...a, ...located, status: 'located' } : a
          );
        }
        return [...prev, located];
      });

      return located;
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to locate anchor:', err);
      setError(err);

      setAnchors((prev) =>
        prev.map((a) =>
          (a.id === anchorId || a.anchor_id === anchorId) ? { ...a, status: 'failed' } : a
        )
      );

      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const deleteAnchor = useCallback(async (anchorId) => {
    setIsLoading(true);
    setError(null);
    try {
      await spatialAnchors.deleteAnchor(anchorId);
      setAnchors((prev) => prev.filter((a) => a.id !== anchorId && a.anchor_id !== anchorId));
      return true;
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to delete anchor:', err);
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const shareAnchor = useCallback(async (anchorId, shareOptions = {}) => {
    setIsLoading(true);
    setError(null);
    try {
      const shareInfo = await spatialAnchors.getAnchorShareUrl(anchorId);

      if (shareOptions.markAsShared !== false) {
        await spatialAnchors.updateAnchor(anchorId, { shared: true });
        setAnchors((prev) =>
          prev.map((a) =>
            (a.id === anchorId || a.anchor_id === anchorId) ? { ...a, shared: true } : a
          )
        );
      }

      return shareInfo;
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to share anchor:', err);
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const importAnchor = useCallback(async (shareCode) => {
    setIsLoading(true);
    setError(null);
    try {
      const imported = await spatialAnchors.importAnchorByShareCode(shareCode);

      setAnchors((prev) => {
        const exists = prev.find((a) => a.id === imported.id);
        if (exists) {
          return prev.map((a) => (a.id === imported.id ? { ...a, ...imported } : a));
        }
        return [...prev, imported];
      });

      return imported;
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to import anchor:', err);
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const updateAnchor = useCallback(async (anchorId, data) => {
    setIsLoading(true);
    setError(null);
    try {
      const updated = await spatialAnchors.updateAnchor(anchorId, data);

      setAnchors((prev) =>
        prev.map((a) =>
          (a.id === anchorId || a.anchor_id === anchorId) ? { ...a, ...updated } : a
        )
      );

      return updated;
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to update anchor:', err);
      setError(err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const retryPendingOperations = useCallback(async () => {
    try {
      await spatialAnchors.retryFailedOperations();
      await offlineCache.retryFailedItems();
      await loadAnchors();
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to retry operations:', err);
    }
  }, [loadAnchors]);

  const handleAnchorLocated = useCallback((anchor) => {
    setAnchors((prev) => {
      const exists = prev.find((a) => a.id === anchor.id || a.anchor_id === anchor.id);
      if (exists) {
        return prev.map((a) =>
          (a.id === anchor.id || a.anchor_id === anchor.id) ? { ...a, ...anchor, status: 'located' } : a
        );
      }
      return [...prev, anchor];
    });
  }, []);

  const handleStatusChange = useCallback((status) => {
    setSessionStatus(status);
  }, []);

  const handleError = useCallback((err) => {
    setError(err);
  }, []);

  const getPendingCount = useCallback(async () => {
    try {
      const pending = await spatialAnchors.getPendingOperations();
      const offlinePending = await offlineCache.getPendingCount();
      setPendingCount(pending.length + offlinePending);
    } catch (err) {
      console.error('[useSpatialAnchors] Failed to get pending count:', err);
    }
  }, []);

  useEffect(() => {
    if (!autoInitialize || initializedRef.current) return;
    initializedRef.current = true;

    const init = async () => {
      try {
        setIsConfigured(spatialAnchors.isConfigured());
        setIsDemoMode(spatialAnchors.isDemoMode());
        setSessionStatus(spatialAnchors.getSessionStatus());

        await spatialAnchors.startSession();

        const removeErrorListener = spatialAnchors.addErrorListener(handleError);
        const removeStatusListener = spatialAnchors.addStatusListener(handleStatusChange);
        const removeAnchorListener = spatialAnchors.addAnchorLocatedListener(handleAnchorLocated);

        cleanupRef.current.push(
          removeErrorListener,
          removeStatusListener,
          removeAnchorListener
        );

        await loadAnchors();
        await getPendingCount();

        const queueInterval = setInterval(() => {
          getPendingCount();
        }, 5000);

        cleanupRef.current.push(() => clearInterval(queueInterval));

        const removeQueueListener = offlineCache.onQueueChange(() => {
          getPendingCount();
        });

        cleanupRef.current.push(removeQueueListener);
      } catch (err) {
        console.error('[useSpatialAnchors] Initialization error:', err);
        setError(err);
      }
    };

    init();

    return () => {
      cleanupRef.current.forEach((cleanup) => cleanup());
      cleanupRef.current = [];
      initializedRef.current = false;
    };
  }, [autoInitialize, handleAnchorLocated, handleError, handleStatusChange, loadAnchors, getPendingCount]);

  useEffect(() => {
    let interval;
    if (sessionStatus === 'ready') {
      interval = setInterval(() => {
        loadAnchors();
      }, 30000);
    }
    return () => clearInterval(interval);
  }, [sessionStatus, loadAnchors]);

  return {
    anchors,
    sessionStatus,
    error,
    isLoading,
    isDemoMode,
    isConfigured,
    pendingCount,
    cameraPosition,
    createAnchor,
    locateAnchor,
    deleteAnchor,
    shareAnchor,
    importAnchor,
    updateAnchor,
    loadAnchors,
    retryPendingOperations,
    setCameraPosition,
    setError,
  };
}

export default useSpatialAnchors;
