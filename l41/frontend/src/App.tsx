import React, { useState, useEffect } from 'react'
import { initWasm, isWasmReady, fingerprintToHex } from './wasm/fingerprintWrapper'
import AudioUploader from './components/AudioUploader'
import RealtimeRecorder from './components/RealtimeRecorder'
import FingerprintVisualizer from './components/FingerprintVisualizer'
import './App.css'

const App: React.FC = () => {
  const [wasmReady, setWasmReady] = useState(false)
  const [wasmLoading, setWasmLoading] = useState(true)
  const [wasmError, setWasmError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'upload' | 'record'>('upload')
  const [liveFingerprint, setLiveFingerprint] = useState<Uint8Array | null>(null)
  const [liveAudioData, setLiveAudioData] = useState<Float32Array | null>(null)

  useEffect(() => {
    const loadWasm = async () => {
      try {
        await initWasm()
        setWasmReady(true)
      } catch (err) {
        setWasmError(err instanceof Error ? err.message : 'WASM加载失败')
      } finally {
        setWasmLoading(false)
      }
    }

    loadWasm()
  }, [])

  const handleFingerprintExtracted = (fingerprint: Uint8Array, audioData: Float32Array) => {
    setLiveFingerprint(fingerprint)
    setLiveAudioData(audioData)
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>音频指纹提取与匹配服务</h1>
        <p className="subtitle">基于 WebAssembly 的实时音频指纹系统</p>
        
        <div className={`status-badge ${wasmReady ? 'ready' : wasmLoading ? 'loading' : 'error'}`}>
          {wasmLoading ? 'WASM加载中...' : wasmReady ? 'WASM已就绪' : 'WASM加载失败'}
        </div>
      </header>

      <main className="app-main">
        {wasmError ? (
          <div className="error-panel">
            <h3>模块加载失败</h3>
            <p>{wasmError}</p>
            <p className="hint">请确保已运行 `npm run build:wasm` 编译 WebAssembly 模块</p>
          </div>
        ) : (
          <>
            <div className="tab-container">
              <button
                className={`tab-button ${activeTab === 'upload' ? 'active' : ''}`}
                onClick={() => setActiveTab('upload')}
              >
                文件上传
              </button>
              <button
                className={`tab-button ${activeTab === 'record' ? 'active' : ''}`}
                onClick={() => setActiveTab('record')}
              >
                实时录音
              </button>
            </div>

            {activeTab === 'upload' && <AudioUploader />}
            {activeTab === 'record' && (
              <>
                <RealtimeRecorder onFingerprintExtracted={handleFingerprintExtracted} />
                {liveFingerprint && (
                  <div className="live-fingerprint-result">
                    <h3>录音指纹</h3>
                    <div className="fingerprint-hex">
                      <code>{fingerprintToHex(liveFingerprint)}</code>
                    </div>
                    <FingerprintVisualizer
                      fingerprint={liveFingerprint}
                      audioData={liveAudioData || undefined}
                      sampleRate={44100}
                    />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <footer className="app-footer">
        <p>技术栈: React + WebAssembly (C++) + Go gRPC + PostgreSQL (GiST索引) + Redis</p>
      </footer>
    </div>
  )
}

export default App
