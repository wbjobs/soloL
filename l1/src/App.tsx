import React, { useState, useEffect, useRef } from 'react';
import { SignalingClient } from './utils/webrtc';
import { FileUpload } from './components/FileUpload';
import { TransferProgress } from './components/TransferProgress';
import { BlockchainViewer } from './components/BlockchainViewer';

type Tab = 'transfer' | 'blockchain';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('transfer');
  const [connected, setConnected] = useState(false);
  const [peerId, setPeerId] = useState('');
  const [peers, setPeers] = useState<string[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const signalingRef = useRef<SignalingClient | null>(null);

  useEffect(() => {
    const client = new SignalingClient();
    signalingRef.current = client;

    client
      .connect()
      .then((id) => {
        setPeerId(id);
        setConnected(true);
      })
      .catch((e) => {
        addError('Failed to connect to signaling server: ' + e.message);
      });

    client.on('peer-list', (msg) => {
      setPeers(msg.payload.peers || []);
    });

    client.on('peer-update', (msg) => {
      setPeers(msg.payload.peers || []);
    });

    return () => {
      client.disconnect();
    };
  }, []);

  const addError = (error: string) => {
    setErrors((prev) => [...prev, error]);
    setTimeout(() => {
      setErrors((prev) => prev.slice(1));
    }, 5000);
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>🔗 WebRTC P2P File Transfer</h1>
        <div className="connection-status">
          <span className={`status-dot ${connected ? 'connected' : 'disconnected'}`} />
          <span>{connected ? 'Connected' : 'Disconnected'}</span>
          {peerId && (
            <span className="peer-id">
              Peer ID: <code>{peerId}</code>
            </span>
          )}
        </div>
      </header>

      <nav className="tab-nav">
        <button
          className={`tab-btn ${activeTab === 'transfer' ? 'active' : ''}`}
          onClick={() => setActiveTab('transfer')}
        >
          📡 Transfer
        </button>
        <button
          className={`tab-btn ${activeTab === 'blockchain' ? 'active' : ''}`}
          onClick={() => setActiveTab('blockchain')}
        >
          ⛓️ Blockchain
        </button>
      </nav>

      <main className="app-main">
        {activeTab === 'transfer' && (
          <div className="transfer-view">
            <div className="peers-panel">
              <h3>Available Peers</h3>
              {peers.length === 0 ? (
                <p className="no-peers">No other peers connected. Open another browser tab to create a second peer.</p>
              ) : (
                <ul className="peer-list">
                  {peers.map((p) => (
                    <li key={p} className="peer-item">
                      <span className="peer-dot" />
                      <code>{p}</code>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="transfer-panels">
              {signalingRef.current && (
                <>
                  <FileUpload
                    signalingClient={signalingRef.current}
                    onError={addError}
                  />
                  <TransferProgress signalingClient={signalingRef.current} />
                </>
              )}
            </div>
          </div>
        )}

        {activeTab === 'blockchain' && <BlockchainViewer />}
      </main>

      <div className="error-toast">
        {errors.map((err, i) => (
          <div key={i} className="toast-item error">
            {err}
          </div>
        ))}
      </div>
    </div>
  );
};
