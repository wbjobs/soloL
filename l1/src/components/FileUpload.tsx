import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  prepareFileMetadata,
  saveTransferProgress,
  loadTransferProgress,
  clearTransferProgress,
  getChunkFromFile,
  FilePreparationResult,
} from '../utils/fileChunker';
import { SignalingClient, WebRTCPeer, BandwidthStats } from '../utils/webrtc';
import { ChunkPriority } from '../utils/priorityQueue';
import { transferDb, initDb } from '../utils/indexedDb';
import { TransferRecord } from '../utils/indexedDb';
import { formatBytes } from '../utils/bandwidth';

interface FileUploadProps {
  signalingClient: SignalingClient;
  onTransferStart?: (fileId: string, fileName: string, totalChunks: number) => void;
  onChunkSent?: (fileId: string, chunkIndex: number, totalChunks: number) => void;
  onTransferComplete?: (fileId: string) => void;
  onError?: (error: string) => void;
}

type SendState =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'negotiating-resume'
  | 'connecting'
  | 'sending'
  | 'paused'
  | 'completed'
  | 'error';

interface PendingTransfer {
  metadata: FilePreparationResult;
  file: File;
}

interface ChunkHeatData {
  index: number;
  duration: number;
  size: number;
  priority: ChunkPriority;
}

export const FileUpload: React.FC<FileUploadProps> = ({
  signalingClient,
  onTransferStart,
  onChunkSent,
  onTransferComplete,
  onError,
}) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [targetPeer, setTargetPeer] = useState('');
  const [sendState, setSendState] = useState<SendState>('idle');
  const [progress, setProgress] = useState(0);
  const [metadata, setMetadata] = useState<FilePreparationResult | null>(null);
  const [sentChunks, setSentChunks] = useState<number[]>([]);
  const [incompleteTransfers, setIncompleteTransfers] = useState<TransferRecord[]>([]);
  const [pendingTransfer, setPendingTransfer] = useState<PendingTransfer | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [bandwidthStats, setBandwidthStats] = useState<BandwidthStats | null>(null);
  const [chunkHeatData, setChunkHeatData] = useState<Map<number, ChunkHeatData>>(new Map());
  const [priorityMode, setPriorityMode] = useState(false);
  const [selectedPriority, setSelectedPriority] = useState<ChunkPriority>('high');
  const [prioritySelection, setPrioritySelection] = useState<Set<number>>(new Set());
  const [chunkPriorities, setChunkPriorities] = useState<Map<number, ChunkPriority>>(new Map());

  const fileRef = useRef<File | null>(null);
  const peerRef = useRef<WebRTCPeer | null>(null);
  const metadataRef = useRef<FilePreparationResult | null>(null);
  const sentChunksRef = useRef<number[]>([]);
  const abortRef = useRef(false);

  useEffect(() => {
    const setup = async () => {
      await initDb();
      const transfers = await transferDb.getIncompleteTransfers();
      setIncompleteTransfers(transfers);
    };
    setup();
  }, []);

  useEffect(() => {
    const handlePeerList = (msg: any) => {
      if (msg.payload?.peers?.includes(targetPeer)) {
        if (pendingTransfer) {
          initiateResumeNegotiation(targetPeer, pendingTransfer);
        }
      }
    };

    const handleResumeInfo = async (msg: any) => {
      if (!pendingTransfer) return;

      const fileId = msg.fileId;
      const remoteCompleted = msg.payload?.completedChunks || [];
      const localSaved = await loadTransferProgress(fileId);

      const intersection = [...new Set([...remoteCompleted, ...(localSaved?.completedChunks || [])])];

      if (intersection.length > 0) {
        signalingClient.send({
          type: 'resume-accepted',
          to: msg.from,
          fileId,
          payload: { completedChunks: intersection },
        });

        startSending(pendingTransfer.file, pendingTransfer.metadata, intersection);
      } else {
        signalingClient.send({
          type: 'resume-accepted',
          to: msg.from,
          fileId,
          payload: { completedChunks: [] },
        });
        startSending(pendingTransfer.file, pendingTransfer.metadata, []);
      }
    };

    const handleResumeRejected = (msg: any) => {
      if (!pendingTransfer) return;
      setSendState('ready');
      setErrorMessage('Resume rejected by peer. Starting fresh transfer.');
    };

    signalingClient.on('peer-list', handlePeerList);
    signalingClient.on('resume-info', handleResumeInfo);
    signalingClient.on('resume-rejected', handleResumeRejected);

    return () => {
      signalingClient.off('peer-list', handlePeerList);
      signalingClient.off('resume-info', handleResumeInfo);
      signalingClient.off('resume-rejected', handleResumeRejected);
    };
  }, [signalingClient, targetPeer, pendingTransfer]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    fileRef.current = file;
    setSendState('preparing');
    setProgress(0);
    setErrorMessage('');
    setMetadata(null);
    setSentChunks([]);
    setChunkPriorities(new Map());
    setPrioritySelection(new Set());
    setChunkHeatData(new Map());

    try {
      const result = await prepareFileMetadata(file, (p) => setProgress(p));
      setMetadata(result);
      metadataRef.current = result;

      const existing = await transferDb.getTransfer(result.fileId);
      if (!existing) {
        await transferDb.saveTransfer({
          fileId: result.fileId,
          fileName: result.fileName,
          fileSize: result.fileSize,
          totalChunks: result.totalChunks,
          merkleRoot: result.merkleRoot,
          chunkHashes: result.chunkHashes,
          completedChunks: [],
          peerId: '',
          direction: 'send',
          status: 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      } else {
        setSentChunks(existing.completedChunks);
        sentChunksRef.current = existing.completedChunks;
      }

      setSendState('ready');

      const transfers = await transferDb.getIncompleteTransfers();
      setIncompleteTransfers(transfers);
    } catch (e: any) {
      onError?.(e.message || 'Failed to prepare file');
      setSendState('error');
      setErrorMessage(e.message || 'Failed to prepare file');
    }
  }, [onError]);

  const initiateResumeNegotiation = useCallback(
    async (peerId: string, pending: PendingTransfer) => {
      setSendState('negotiating-resume');
      signalingClient.send({
        type: 'request-status',
        to: peerId,
        fileId: pending.metadata.fileId,
        payload: {
          fileName: pending.metadata.fileName,
          fileSize: pending.metadata.fileSize,
          merkleRoot: pending.metadata.merkleRoot,
        },
      });
    },
    [signalingClient]
  );

  const startTransfer = useCallback(async () => {
    if (!metadata || !targetPeer || !fileRef.current) return;

    const saved = await loadTransferProgress(metadata.fileId);
    const initialCompleted = saved?.completedChunks || [];

    setPendingTransfer({ metadata, file: fileRef.current });
    setSentChunks(initialCompleted);
    sentChunksRef.current = initialCompleted;

    signalingClient.send({
      type: 'peer-status-request',
      to: targetPeer,
      payload: { fileId: metadata.fileId },
    });

    const handlePeerStatusResponse = async (msg: any) => {
      if (msg.from !== targetPeer) return;

      signalingClient.off('peer-status-response', handlePeerStatusResponse);

      const remoteTransfers = msg.payload?.transfers || [];
      const matching = remoteTransfers.find((t: any) => t.fileId === metadata.fileId);

      if (matching && matching.completedChunks?.length > 0) {
        const intersection = [...new Set([...initialCompleted, ...matching.completedChunks])].sort((a, b) => a - b);

        await transferDb.updateTransferProgress(metadata.fileId, intersection);

        signalingClient.send({
          type: 'file-info',
          to: targetPeer,
          payload: {
            fileId: metadata.fileId,
            fileName: metadata.fileName,
            fileSize: metadata.fileSize,
            totalChunks: metadata.totalChunks,
            merkleRoot: metadata.merkleRoot,
            chunkHashes: metadata.chunkHashes,
            completedChunks: intersection,
          },
        });

        startSending(fileRef.current!, metadata, intersection);
      } else {
        signalingClient.send({
          type: 'file-info',
          to: targetPeer,
          payload: {
            fileId: metadata.fileId,
            fileName: metadata.fileName,
            fileSize: metadata.fileSize,
            totalChunks: metadata.totalChunks,
            merkleRoot: metadata.merkleRoot,
            chunkHashes: metadata.chunkHashes,
            completedChunks: [],
          },
        });

        startSending(fileRef.current!, metadata, []);
      }
    };

    signalingClient.on('peer-status-response', handlePeerStatusResponse);

    setTimeout(() => {
      signalingClient.off('peer-status-response', handlePeerStatusResponse);
      if (sendState !== 'sending') {
        signalingClient.send({
          type: 'file-info',
          to: targetPeer,
          payload: {
            fileId: metadata.fileId,
            fileName: metadata.fileName,
            fileSize: metadata.fileSize,
            totalChunks: metadata.totalChunks,
            merkleRoot: metadata.merkleRoot,
            chunkHashes: metadata.chunkHashes,
            completedChunks: initialCompleted,
          },
        });

        startSending(fileRef.current!, metadata, initialCompleted);
      }
    }, 3000);
  }, [metadata, targetPeer, signalingClient, sendState]);

  const startSending = useCallback(
    async (file: File, meta: FilePreparationResult, completedChunks: number[]) => {
      setSendState('sending');
      setSentChunks(completedChunks);
      sentChunksRef.current = [...completedChunks];

      try {
        const webrtcPeer = new WebRTCPeer(signalingClient);
        peerRef.current = webrtcPeer;

        webrtcPeer.setOnBandwidthUpdate((stats) => {
          setBandwidthStats(stats);
        });

        webrtcPeer.setOnChannelOpen(async () => {
          const totalChunks = meta.totalChunks;
          const allChunks = [...completedChunks];
          const heatData = new Map<number, ChunkHeatData>();

          for (let i = 0; i < totalChunks; i++) {
            const priority = chunkPriorities.get(i) || 'normal';
            webrtcPeer.queueChunk(i, priority);
          }

          onTransferStart?.(meta.fileId, meta.fileName, totalChunks);

          try {
            while (webrtcPeer.hasQueuedChunks() && !abortRef.current) {
              const chunkIndex = webrtcPeer.getNextQueuedChunk();
              if (chunkIndex === null) break;
              if (allChunks.includes(chunkIndex)) {
                webrtcPeer.markChunkCompleted(chunkIndex, 0, 0, chunkPriorities.get(chunkIndex) || 'normal');
                continue;
              }

              const chunk = await getChunkFromFile(file, chunkIndex);
              const priority = chunkPriorities.get(chunkIndex) || 'normal';

              const startTime = Date.now();
              await webrtcPeer.sendChunk(chunkIndex, chunk.data, chunk.hash, priority);
              const duration = Date.now() - startTime;

              heatData.set(chunkIndex, {
                index: chunkIndex,
                duration,
                size: chunk.data.byteLength,
                priority,
              });
              setChunkHeatData(new Map(heatData));

              allChunks.push(chunkIndex);
              allChunks.sort((a, b) => a - b);

              setSentChunks([...allChunks]);
              sentChunksRef.current = [...allChunks];

              await saveTransferProgress(meta.fileId, allChunks, totalChunks);

              signalingClient.send({
                type: 'chunk-status',
                to: targetPeer,
                fileId: meta.fileId,
                payload: { chunkIndex, chunkHash: chunk.hash },
              });

              onChunkSent?.(meta.fileId, chunkIndex, totalChunks);

              setProgress(Math.round((allChunks.length / totalChunks) * 100));
            }

            if (!abortRef.current) {
              signalingClient.send({
                type: 'transfer-complete',
                to: targetPeer,
                fileId: meta.fileId,
              });

              await clearTransferProgress(meta.fileId);
              await transferDb.deleteTransfer(meta.fileId);

              setSendState('completed');
              onTransferComplete?.(meta.fileId);

              const transfers = await transferDb.getIncompleteTransfers();
              setIncompleteTransfers(transfers);
            }
          } catch (e: any) {
            if (!abortRef.current) {
              onError?.(`Transfer failed: ${e.message}`);
              setSendState('error');
              setErrorMessage(e.message);
            }
          }
        });

        await webrtcPeer.initiateConnection(targetPeer);
      } catch (e: any) {
        onError?.(e.message || 'Failed to establish connection');
        setSendState('error');
        setErrorMessage(e.message);
      }
    },
    [signalingClient, targetPeer, chunkPriorities, onTransferStart, onChunkSent, onTransferComplete, onError]
  );

  const resumeTransfer = useCallback(
    async (transfer: TransferRecord) => {
      setTargetPeer(transfer.peerId);
      setSendState('negotiating-resume');

      signalingClient.send({
        type: 'request-status',
        to: transfer.peerId,
        fileId: transfer.fileId,
        payload: {
          fileName: transfer.fileName,
          fileSize: transfer.fileSize,
          merkleRoot: transfer.merkleRoot,
        },
      });
    },
    [signalingClient]
  );

  const cancelTransfer = useCallback(() => {
    abortRef.current = true;
    if (peerRef.current) {
      peerRef.current.close();
      peerRef.current = null;
    }
    setSendState('ready');
  }, []);

  const handleChunkClick = useCallback((index: number) => {
    if (!priorityMode || sentChunks.includes(index)) return;

    setPrioritySelection((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, [priorityMode, sentChunks]);

  const applyPriority = useCallback(() => {
    const newPriorities = new Map(chunkPriorities);
    prioritySelection.forEach((index) => {
      newPriorities.set(index, selectedPriority);
    });
    setChunkPriorities(newPriorities);
    setPrioritySelection(new Set());
    setPriorityMode(false);
  }, [chunkPriorities, prioritySelection, selectedPriority]);

  const getHeatColor = (duration: number): string => {
    const maxDuration = 3000;
    const ratio = Math.min(1, duration / maxDuration);
    const r = Math.round(ratio * 200);
    const g = Math.round((1 - ratio) * 150);
    return `rgb(${r}, ${g}, 100)`;
  };

  const getPriorityColor = (priority: ChunkPriority): string => {
    switch (priority) {
      case 'urgent': return '#ef4444';
      case 'high': return '#f59e0b';
      case 'normal': return '#3b82f6';
      case 'low': return '#64748b';
      default: return '#3b82f6';
    }
  };

  return (
    <div className="file-upload">
      <h2>📤 Send File</h2>

      {incompleteTransfers.length > 0 && (
        <div className="incomplete-transfers">
          <h3>🔄 Paused Transfers</h3>
          {incompleteTransfers.map((t) => (
            <div key={t.fileId} className="transfer-card">
              <div className="transfer-info">
                <p className="transfer-name">{t.fileName}</p>
                <p className="transfer-progress">
                  {t.completedChunks.length}/{t.totalChunks} chunks
                </p>
                <div className="progress-bar small">
                  <div
                    className="progress-fill"
                    style={{ width: `${(t.completedChunks.length / t.totalChunks) * 100}%` }}
                  />
                </div>
              </div>
              <button className="btn-secondary small" onClick={() => resumeTransfer(t)}>
                Resume
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="upload-area">
        <input
          type="file"
          onChange={handleFileSelect}
          disabled={sendState === 'preparing' || sendState === 'sending'}
        />
        {selectedFile && (
          <div className="file-info">
            <p>
              <strong>File:</strong> {selectedFile.name}
            </p>
            <p>
              <strong>Size:</strong> {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
            </p>
          </div>
        )}
      </div>

      {sendState === 'preparing' && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progress}%` }} />
          <span>Preparing: {progress}%</span>
        </div>
      )}

      {bandwidthStats && (
        <div className="bandwidth-stats">
          <div className="stat-item">
            <span className="stat-label">Bandwidth</span>
            <span className="stat-value">{bandwidthStats.formatted}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">RTT</span>
            <span className="stat-value">{bandwidthStats.rtt.toFixed(0)} ms</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Trend</span>
            <span className={`stat-value trend-${bandwidthStats.trend}`}>
              {bandwidthStats.trend === 'increasing' ? '↑' : bandwidthStats.trend === 'decreasing' ? '↓' : '→'}
            </span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Chunk Size</span>
            <span className="stat-value">{formatBytes(bandwidthStats.currentChunkSize)}</span>
          </div>
        </div>
      )}

      {metadata && sendState === 'ready' && (
        <div className="priority-controls">
          <div className="priority-header">
            <span className="priority-label">Priority Marking</span>
            <button
              className={`btn-toggle ${priorityMode ? 'active' : ''}`}
              onClick={() => setPriorityMode(!priorityMode)}
            >
              {priorityMode ? 'Exit Selection' : 'Select Chunks'}
            </button>
          </div>
          {priorityMode && (
            <div className="priority-selector">
              <div className="priority-options">
                {(['urgent', 'high', 'normal', 'low'] as ChunkPriority[]).map((p) => (
                  <label key={p} className="priority-option">
                    <input
                      type="radio"
                      name="priority"
                      checked={selectedPriority === p}
                      onChange={() => setSelectedPriority(p)}
                    />
                    <span style={{ color: getPriorityColor(p) }}>{p}</span>
                  </label>
                ))}
              </div>
              <p>Selected: {prioritySelection.size} chunks</p>
              <button
                onClick={applyPriority}
                disabled={prioritySelection.size === 0}
                className="btn-secondary small"
              >
                Apply Priority
              </button>
            </div>
          )}
        </div>
      )}

      {metadata && (sendState === 'ready' || sendState === 'sending') && (
        <div className="chunk-heatmap">
          <h3>Chunks {sendState === 'sending' && '(Heatmap)'}</h3>
          <div className="chunk-grid">
            {Array.from({ length: metadata.totalChunks }, (_, i) => {
              const isSent = sentChunks.includes(i);
              const heatData = chunkHeatData.get(i);
              const priority = chunkPriorities.get(i) || 'normal';
              const isSelected = prioritySelection.has(i);

              return (
                <div
                  key={i}
                  className={`chunk-cell ${isSent ? 'sent' : 'pending'} ${isSelected ? 'selected' : ''}`}
                  style={{
                    backgroundColor: heatData ? getHeatColor(heatData.duration) : undefined,
                    borderLeft: `3px solid ${getPriorityColor(priority)}`,
                  }}
                  onClick={() => handleChunkClick(i)}
                  title={`Chunk ${i} - ${priority}${heatData ? ` - ${heatData.duration}ms` : ''}`}
                >
                  {i}
                </div>
              );
            })}
          </div>
          {sendState === 'sending' && chunkHeatData.size > 0 && (
            <div className="heatmap-legend">
              <span>Fast</span>
              <div className="legend-gradient" />
              <span>Slow</span>
            </div>
          )}
          <div className="priority-legend">
            <span style={{ color: '#ef4444' }}>■ Urgent</span>
            <span style={{ color: '#f59e0b' }}>■ High</span>
            <span style={{ color: '#3b82f6' }}>■ Normal</span>
            <span style={{ color: '#64748b' }}>■ Low</span>
          </div>
        </div>
      )}

      {metadata && (sendState === 'ready' || sendState === 'error') && (
        <div className="metadata-display">
          <h3>File Metadata</h3>
          <p>
            <strong>File ID:</strong> <code>{metadata.fileId.substring(0, 30)}...</code>
          </p>
          <p>
            <strong>Total Chunks:</strong> {metadata.totalChunks}
          </p>
          <p>
            <strong>Merkle Root:</strong>{' '}
            <code>{metadata.merkleRoot.substring(0, 24)}...</code>
          </p>

          <div className="target-peer">
            <label>Target Peer ID:</label>
            <input
              type="text"
              value={targetPeer}
              onChange={(e) => setTargetPeer(e.target.value)}
              placeholder="Enter peer ID to send to"
              disabled={sendState === 'sending'}
            />
          </div>

          {sentChunks.length > 0 && (
            <p className="resume-info">
              🔄 {sentChunks.length} chunks already sent
            </p>
          )}

          {errorMessage && <p className="error-message">{errorMessage}</p>}

          <button
            onClick={startTransfer}
            disabled={!targetPeer || sendState !== 'ready'}
            className="btn-primary"
          >
            {sendState === 'negotiating-resume'
              ? 'Negotiating resume...'
              : sentChunks.length > 0
              ? 'Resume Transfer'
              : 'Start Transfer'}
          </button>
        </div>
      )}

      {sendState === 'sending' && metadata && (
        <div className="transfer-progress">
          <h3>Transfer Progress</h3>
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${(sentChunks.length / metadata.totalChunks) * 100}%` }}
            />
            <span>
              {sentChunks.length}/{metadata.totalChunks} chunks
            </span>
          </div>
          <button onClick={cancelTransfer} className="btn-secondary" style={{ marginTop: '8px' }}>
            Cancel
          </button>
        </div>
      )}

      {sendState === 'completed' && (
        <div className="completion-message">
          <p className="success-message">✅ Transfer completed successfully!</p>
        </div>
      )}
    </div>
  );
};
