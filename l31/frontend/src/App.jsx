import { useEffect, useState } from 'react'
import useStore from './store/useStore'
import MidiUpload from './components/MidiUpload'
import MidiList from './components/MidiList'
import ThreeJSVisualizer from './components/ThreeJSVisualizer'
import SpectrumView from './components/SpectrumView'
import AnnotationPanel from './components/AnnotationPanel'
import ChordPredictionPanel from './components/ChordPredictionPanel'
import VersionHistorySlider from './components/VersionHistorySlider'
import OperationLogViewer from './components/OperationLogViewer'
import PDFExportPanel from './components/PDFExportPanel'
import './styles/main.css'

function App() {
  const {
    username,
    setUsername,
    activeTab,
    setActiveTab,
    error,
    clearError,
    selectedMidi
  } = useStore()

  useEffect(() => {
    if (error) {
      console.error('Error:', error)
      const timer = setTimeout(clearError, 5000)
      return () => clearTimeout(timer)
    }
  }, [error])

  return (
    <div className="app-container">
      <header className="header">
        <h1>🎵 MIDI 可视化与协作标注平台</h1>
        <div className="header-right">
          <div className="user-info">
            <span style={{ fontSize: '13px', color: '#a0a0d0' }}>用户:</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="输入用户名"
              style={{ width: '120px' }}
            />
          </div>
          {selectedMidi && (
            <div style={{ fontSize: '12px', color: '#8080c0' }}>
              📁 {selectedMidi.filename}
            </div>
          )}
        </div>
      </header>

      <div className="main-content">
        <aside className="sidebar">
          <MidiUpload />
          <MidiList />
        </aside>

        <main className="content-area">
          <div className="tabs">
            <div
              className={`tab ${activeTab === '3d' ? 'active' : ''}`}
              onClick={() => setActiveTab('3d')}
            >
              🎸 3D 音符视图
            </div>
            <div
              className={`tab ${activeTab === 'spectrum' ? 'active' : ''}`}
              onClick={() => setActiveTab('spectrum')}
            >
              📊 频谱瀑布图
            </div>
          </div>

          <div className="tab-content">
            {activeTab === '3d' && <ThreeJSVisualizer />}
            {activeTab === 'spectrum' && <SpectrumView />}
          </div>
        </main>

        <aside className="right-sidebar">
          <AnnotationPanel />
          <VersionHistorySlider />
          <ChordPredictionPanel />
          <PDFExportPanel />
          <OperationLogViewer />
        </aside>
      </div>

      {error && (
        <div style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          background: 'rgba(239, 68, 68, 0.9)',
          color: 'white',
          padding: '12px 20px',
          borderRadius: '8px',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span>⚠️ {error}</span>
          <button
            onClick={clearError}
            style={{
              background: 'none',
              border: 'none',
              color: 'white',
              cursor: 'pointer',
              fontSize: '16px'
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  )
}

export default App
