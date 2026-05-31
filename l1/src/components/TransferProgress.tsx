import React, { useState, useEffect, useCallback, useRef } from 'react';
import { computeHash } from '../utils/fileChunker';
import { MerkleTree, buildMerkleTreeFromHashes } from '../utils/merkleTree';
import { WebRTCPeer, SignalingClient, BandwidthStats } from '../utils/webrtc';
import { saveTransferProgress, loadTransferProgress, clearTransferProgress } from '../utils/fileChunker';
import { transferDb, initDb } from '../utils/indexedDb';
import { TransferRecord } from '../utils/indexedDb';
import { formatBytes } from '../utils/bandwidth';
import { TransferHeatmap, HeatmapChunkData } from './TransferHeatmap';

interface ReceivedChunk {
  index: number;
  data: ArrayBuffer;
  hash: string;
  verified: boolean;
  receivedAt: number;
  duration: number;
}

interface IncomingFileInfo {
  fileId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  merkleRoot: string;
  chunkHashes: string[];
  fromPeer: string;
}

interface TransferProgressProps {
  signalingClient: SignalingClient;
}

export const TransferProgress: React.FC<TransferProgressProps> = ({ signalingClient }) => {
  const [receivedChunks, setReceivedChunks] = useState<Map<string, ReceivedChunk>>(new Map());
  const [incomingFile, setIncomingFile] = useState<IncomingFileInfo | null>(null);
  const [verificationResults, setVerificationResults] = useState<Map<number, boolean>>(new Map());
  const [transferStatus, setTransferStatus] = useState<'idle' | 'receiving' | 'verifying' | 'complete' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [incompleteTransfers, setIncompleteTransfers] = useState<TransferRecord[]>([]);
  const [bandwidthStats, setBandwidthStats] = useState<BandwidthStats | null>(null);
  const [heatmapData, setHeatmapData] = useState<Map<number, HeatmapChunkData>>(new Map());

  const peerRef = useRef<WebRTCPeer | null>(null);
  const incomingFileRef = useRef<IncomingFileInfo | null>(null);
  const receivedChunksRef = useRef<Map<string, ReceivedChunk>>(new Map());
  const completedChunksRef = useRef<number[]>([]);
  const chunkStartTimesRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    const setup = async () => {
      await initDb();
      const transfers = await transferDb.getIncompleteTransfers();
      setIncompleteTransfers(transfers.filter((t) => t.direction === 'receive'));
    };
    setup();
  }, []);

  useEffect(() => {
    const handleFileInfo = async (msg: any) => {
      const info: IncomingFileInfo = {
        fileId: msg.payload.fileId,
        fileName: msg.payload.fileName,
        fileSize: msg.payload.fileSize,
        totalChunks: msg.payload.totalChunks,
        merkleRoot: msg.payload.merkleRoot,
        chunkHashes: msg.payload.chunkHashes,
        fromPeer: msg.from,
      };
      setIncomingFile(info);
      incomingFileRef.current = info;
      setTransferStatus('receiving');
      setHeatmapData(new Map());

      const saved = await loadTransferProgress(info.fileId);
      let initialCompleted: number[] = [];
      const negotiatedCompleted = msg.payload.completedChunks || [];

      if (saved && saved.completedChunks.length > 0) {
        initialCompleted = [...new Set([...saved.completedChunks, ...negotiatedCompleted])];
      } else {
        initialCompleted = negotiatedCompleted;
      }

      const existing = await transferDb.getTransfer(info.fileId);
      if (!existing) {
        await transferDb.saveTransfer({
          fileId: info.fileId,
          fileName: info.fileName,
          fileSize: info.fileSize,
          totalChunks: info.totalChunks,
          merkleRoot: info.merkleRoot,
          chunkHashes: info.chunkHashes,
          completedChunks: initialCompleted,
          peerId: info.fromPeer,
          direction: 'receive',
          status: initialCompleted.length > 0 ? 'in-progress' : 'pending',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      } else {
        existing.completedChunks = initialCompleted;
        existing.updatedAt = Date.now();
        existing.peerId = info.fromPeer;
        await transferDb.saveTransfer(existing);
      }

      completedChunksRef.current = initialCompleted;

      const chunkMap = new Map<string, ReceivedChunk>();
      const heatMap = new Map<number, HeatmapChunkData>();
      initialCompleted.forEach((idx) => {
        chunkMap.set(String(idx), {
          index: idx,
          data: new ArrayBuffer(0),
          hash: info.chunkHashes[idx],
          verified: true,
          receivedAt: Date.now(),
          duration: 0,
        });
        heatMap.set(idx, {
          index: idx,
          duration: 0,
          size: 1024 * 1024,
          verified: true,
          priority: 'normal',
        });
      });
      setReceivedChunks(chunkMap);
      receivedChunksRef.current = chunkMap;
      setHeatmapData(heatMap);

      const newResults = new Map<number, boolean>();
      initialCompleted.forEach((idx) => newResults.set(idx, true));
      setVerificationResults(newResults);
    };

    const handleTransferComplete = (msg: any) => {
      verifyTransfer(msg.fileId || incomingFileRef.current?.fileId || '');
    };

    const handleRequestStatus = async (msg: any) => {
      const fileId = msg.fileId;
      const saved = await loadTransferProgress(fileId);

      signalingClient.send({
        type: 'resume-info',
        to: msg.from,
        fileId,
        payload: {
          completedChunks: saved?.completedChunks || [],
          totalChunks: saved?.totalChunks || 0,
          fileName: msg.payload?.fileName,
        },
      });
    };

    const handlePeerStatusRequest = async (msg: any) => {
      const incomplete = await transferDb.getIncompleteTransfers();
      const transfers = incomplete
        .filter((t) => t.direction === 'receive')
        .map((t) => ({
          fileId: t.fileId,
          fileName: t.fileName,
          fileSize: t.fileSize,
          totalChunks: t.totalChunks,
          merkleRoot: t.merkleRoot,
          completedChunks: t.completedChunks,
        }));

      signalingClient.send({
        type: 'peer-status-response',
        to: msg.from,
        payload: { transfers },
      });
    };

    const handleResumeAccepted = async (msg: any) => {
      const fileId = msg.fileId;
      const completed = msg.payload?.completedChunks || [];

      const existing = incomingFileRef.current;
      if (!existing || existing.fileId !== fileId) return;

      const existingRecord = await transferDb.getTransfer(fileId);
      if (existingRecord) {
        existingRecord.completedChunks = completed;
        existingRecord.updatedAt = Date.now();
        await transferDb.saveTransfer(existingRecord);
      }

      completedChunksRef.current = completed;

      const chunkMap = new Map<string, ReceivedChunk>();
      const heatMap = new Map<number, HeatmapChunkData>();
      completed.forEach((idx: number) => {
        chunkMap.set(String(idx), {
          index: idx,
          data: new ArrayBuffer(0),
          hash: existing.chunkHashes[idx],
          verified: true,
          receivedAt: Date.now(),
          duration: 0,
        });
        heatMap.set(idx, {
          index: idx,
          duration: 0,
          size: 1024 * 1024,
          verified: true,
        });
      });
      setReceivedChunks(chunkMap);
      receivedChunksRef.current = chunkMap;
      setHeatmapData(heatMap);
    };

    signalingClient.on('file-info', handleFileInfo);
    signalingClient.on('transfer-complete', handleTransferComplete);
    signalingClient.on('request-status', handleRequestStatus);
    signalingClient.on('peer-status-request', handlePeerStatusRequest);
    signalingClient.on('resume-accepted', handleResumeAccepted);

    return () => {
      signalingClient.off('file-info', handleFileInfo);
      signalingClient.off('transfer-complete', handleTransferComplete);
      signalingClient.off('request-status', handleRequestStatus);
      signalingClient.off('peer-status-request', handlePeerStatusRequest);
      signalingClient.off('resume-accepted', handleResumeAccepted);
    };
  }, [signalingClient]);

  useEffect(() => {
    if (!incomingFile) return;

    const webrtcPeer = new WebRTCPeer(signalingClient);
    peerRef.current = webrtcPeer;

    webrtcPeer.setOnBandwidthUpdate((stats) => {
      setBandwidthStats(stats);
    });

    webrtcPeer.setOnChunkReceived(async (chunkIndex: number, data: ArrayBuffer, hash: string) => {
      const startTime = chunkStartTimesRef.current.get(chunkIndex) || Date.now();
      const duration = Date.now() - startTime;

      const computedHash = await computeHash(data);
      const verified = computedHash === hash;
      const expectedHash = incomingFileRef.current?.chunkHashes[chunkIndex];
      const fullyVerified = verified && computedHash === expectedHash;

      const chunk: ReceivedChunk = {
        index: chunkIndex,
        data,
        hash: computedHash,
        verified: fullyVerified,
        receivedAt: Date.now(),
        duration,
      };

      setReceivedChunks((prev) => {
        const next = new Map(prev);
        next.set(String(chunkIndex), chunk);
        receivedChunksRef.current = next;
        return next;
      });

      setHeatmapData((prev) => {
        const next = new Map(prev);
        next.set(chunkIndex, {
          index: chunkIndex,
          duration,
          size: data.byteLength,
          verified: fullyVerified,
        });
        return next;
      });

      setVerificationResults((prev) => {
        const next = new Map(prev);
        next.set(chunkIndex, fullyVerified);
        return next;
      });

      if (incomingFileRef.current) {
        const completed = [...completedChunksRef.current];
        if (!completed.includes(chunkIndex)) {
          completed.push(chunkIndex);
          completed.sort((a, b) => a - b);
          completedChunksRef.current = completed;
        }

        await saveTransferProgress(incomingFileRef.current.fileId, completed, incomingFileRef.current.totalChunks);

        signalingClient.send({
          type: 'chunk-status',
          to: incomingFileRef.current.fromPeer,
          fileId: incomingFileRef.current.fileId,
          payload: { chunkIndex, chunkHash: computedHash },
        });
      }
    });

    return () => {
      webrtcPeer.close();
    };
  }, [incomingFile, signalingClient]);

  const verifyTransfer = useCallback(async (fileId: string) => {
    if (!incomingFile) return;

    setTransferStatus('verifying');

    const hashes: string[] = [];
    for (let i = 0; i < incomingFile.totalChunks; i++) {
      const chunk = receivedChunksRef.current.get(String(i));
      hashes.push(chunk?.hash || '');
    }

    const merkleTree = await buildMerkleTreeFromHashes(hashes.filter((h) => h !== ''));
    const computedRoot = merkleTree.getRoot();
    const rootMatches = computedRoot === incomingFile.merkleRoot;

    let allVerified = true;
    const newResults = new Map<number, boolean>();
    for (let i = 0; i < incomingFile.totalChunks; i++) {
      const chunk = receivedChunksRef.current.get(String(i));
      const verified = chunk?.verified ?? false;
      newResults.set(i, verified);
      if (!verified) allVerified = false;
    }
    setVerificationResults(newResults);

    if (allVerified && rootMatches) {
      setTransferStatus('complete');
      await clearTransferProgress(fileId);
      await transferDb.deleteTransfer(fileId);

      const transfers = await transferDb.getIncompleteTransfers();
      setIncompleteTransfers(transfers.filter((t) => t.direction === 'receive'));
    } else {
      setTransferStatus('error');
      setErrorMessage(rootMatches ? 'Some chunks failed verification' : 'Merkle root mismatch');
    }
  }, [incomingFile]);

  const downloadFile = useCallback(() => {
    if (!incomingFile) return;

    const chunks: ArrayBuffer[] = [];
    for (let i = 0; i < incomingFile.totalChunks; i++) {
      const chunk = receivedChunksRef.current.get(String(i));
      if (chunk?.data) {
        chunks.push(chunk.data);
      }
    }

    const blob = new Blob(chunks);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = incomingFile.fileName;
    a.click();
    URL.revokeObjectURL(url);
  }, [incomingFile]);

  if (!incomingFile && transferStatus === 'idle') {
    return (
      <div className="transfer-progress">
        <h2>📥 Receive File</h2>

        {incompleteTransfers.length > 0 && (
          <div className="incomplete-transfers" style={{ marginBottom: '16px' }}>
            <h3>🔄 Paused Downloads</h3>
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
              </div>
            ))}
          </div>
        )}

        <p className="idle-message">Waiting for incoming file transfer...</p>
      </div>
    );
  }

  return (
    <div className="transfer-progress">
      <h2>📥 Receiving: {incomingFile?.fileName}</h2>

      <div className="file-info">
        <p><strong>From:</strong> {incomingFile?.fromPeer}</p>
        <p><strong>Size:</strong> {incomingFile ? (incomingFile.fileSize / (1024 * 1024)).toFixed(2) : 0} MB</p>
        <p><strong>Total Chunks:</strong> {incomingFile?.totalChunks}</p>
        <p><strong>Merkle Root:</strong> <code>{incomingFile?.merkleRoot.substring(0, 24)}...</code></p>
      </div>

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

      <div className="progress-bar">
        <div
          className="progress-fill"
          style={{ width: `${incomingFile ? (receivedChunks.size / incomingFile.totalChunks) * 100 : 0}%` }}
        />
        <span>{receivedChunks.size}/{incomingFile?.totalChunks} chunks received</span>
      </div>

      {incomingFile && (
        <div className="heatmap-section">
          <h3>Transfer Heatmap</h3>
          <TransferHeatmap
            totalChunks={incomingFile.totalChunks}
            completedChunks={heatmapData}
            showPriority={false}
            showLegend={true}
          />
        </div>
      )}

      <div className="status-display">
        <span className={`status-badge status-${transferStatus}`}>
          {transferStatus === 'idle' && '⏳ Idle'}
          {transferStatus === 'receiving' && '📡 Receiving'}
          {transferStatus === 'verifying' && '🔍 Verifying'}
          {transferStatus === 'complete' && '✅ Complete'}
          {transferStatus === 'error' && '❌ Error'}
        </span>
        {errorMessage && <p className="error-message">{errorMessage}</p>}
      </div>

      {transferStatus === 'complete' && (
        <button onClick={downloadFile} className="btn-primary">
          💾 Download File
        </button>
      )}
    </div>
  );
};
