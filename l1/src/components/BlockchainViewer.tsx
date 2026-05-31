import React, { useState, useEffect, useCallback } from 'react';
import { BlockchainBlock, getBlockchain, getFileBlocks } from '../utils/blockchain';

export const BlockchainViewer: React.FC = () => {
  const [chain, setChain] = useState<BlockchainBlock[]>([]);
  const [selectedFileId, setSelectedFileId] = useState('');
  const [fileBlocks, setFileBlocks] = useState<BlockchainBlock[]>([]);
  const [isValid, setIsValid] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchChain = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getBlockchain();
      setChain(data.chain);
      setIsValid(data.valid);
    } catch (e) {
      console.error('Failed to fetch blockchain:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchChain();
    const interval = setInterval(fetchChain, 10000);
    return () => clearInterval(interval);
  }, [fetchChain]);

  const searchFile = useCallback(async () => {
    if (!selectedFileId) return;
    setLoading(true);
    try {
      const data = await getFileBlocks(selectedFileId);
      setFileBlocks(data.blocks);
    } catch (e) {
      console.error('Failed to fetch file blocks:', e);
    }
    setLoading(false);
  }, [selectedFileId]);

  const fileIds = [...new Set(chain.filter((b) => b.data.fileId).map((b) => b.data.fileId))];

  return (
    <div className="blockchain-viewer">
      <h2>⛓️ Blockchain Ledger</h2>

      <div className="blockchain-status">
        <div className="status-item">
          <span className="label">Chain Length</span>
          <span className="value">{chain.length}</span>
        </div>
        <div className="status-item">
          <span className="label">Valid</span>
          <span className={`value ${isValid ? 'valid' : 'invalid'}`}>
            {isValid ? '✅ Yes' : '❌ No'}
          </span>
        </div>
        <div className="status-item">
          <span className="label">Files Recorded</span>
          <span className="value">{fileIds.length}</span>
        </div>
        <button onClick={fetchChain} className="btn-secondary" disabled={loading}>
          🔄 Refresh
        </button>
      </div>

      <div className="file-search">
        <h3>Search by File ID</h3>
        <div className="search-row">
          <select value={selectedFileId} onChange={(e) => setSelectedFileId(e.target.value)}>
            <option value="">Select a file...</option>
            {fileIds.map((id) => (
              <option key={id} value={id}>{id.substring(0, 40)}...</option>
            ))}
          </select>
          <button onClick={searchFile} disabled={!selectedFileId || loading} className="btn-secondary">
            Search
          </button>
        </div>
      </div>

      {fileBlocks.length > 0 && (
        <div className="file-blocks">
          <h3>Blocks for File</h3>
          <div className="blocks-list">
            {fileBlocks.map((block) => (
              <div key={block.index} className="block-card">
                <div className="block-header">
                  <span className="block-index">Block #{block.index}</span>
                  <span className="block-time">{new Date(block.timestamp).toLocaleTimeString()}</span>
                </div>
                <div className="block-body">
                  <p><strong>Chunk:</strong> {block.data.chunkIndex}/{block.data.totalChunks}</p>
                  <p><strong>Hash:</strong> <code>{block.data.chunkHash.substring(0, 16)}...</code></p>
                  <p><strong>Prev Hash:</strong> <code>{block.previousHash.substring(0, 16)}...</code></p>
                  <p><strong>Block Hash:</strong> <code>{block.hash.substring(0, 16)}...</code></p>
                  <p><strong>Nonce:</strong> {block.nonce}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="full-chain">
        <h3>Full Chain (Genesis + {chain.length - 1} blocks)</h3>
        <div className="chain-visual">
          {chain.slice(-20).map((block, i) => (
            <div key={block.index} className="chain-block">
              <div className="chain-block-index">#{block.index}</div>
              <div className="chain-block-hash">{block.hash.substring(0, 8)}...</div>
              {block.data.fileId && (
                <div className="chain-block-file">{block.data.fileName?.substring(0, 10)}</div>
              )}
              {i < chain.slice(-20).length - 1 && <div className="chain-link">→</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
