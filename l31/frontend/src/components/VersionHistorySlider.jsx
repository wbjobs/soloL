import { useState, useEffect } from 'react'
import useStore from '../store/useStore'

export default function VersionHistorySlider() {
  const {
    selectedMidi,
    annotationHistory,
    isTimeTravelMode,
    historyVersion,
    annotationVersion,
    loadAnnotationHistory,
    jumpToHistoryVersion,
    exitTimeTravelMode,
    saveAnnotationSnapshot
  } = useStore()

  const [sliderValue, setSliderValue] = useState(0)

  useEffect(() => {
    if (selectedMidi) {
      loadAnnotationHistory()
    }
  }, [selectedMidi?._id])

  useEffect(() => {
    if (annotationHistory.length > 0) {
      const idx = annotationHistory.findIndex(h => h.version === historyVersion)
      setSliderValue(idx >= 0 ? idx : annotationHistory.length - 1)
    }
  }, [annotationHistory, historyVersion])

  const handleSliderChange = (e) => {
    const idx = parseInt(e.target.value)
    setSliderValue(idx)
    if (annotationHistory[idx]) {
      jumpToHistoryVersion(annotationHistory[idx].version)
    }
  }

  const handleSaveSnapshot = async () => {
    await saveAnnotationSnapshot()
  }

  const handleExit = () => {
    exitTimeTravelMode()
    setSliderValue(annotationHistory.length - 1)
  }

  if (!selectedMidi || annotationHistory.length === 0) {
    return (
      <div style={styles.panel}>
        <h3 style={styles.title}>⏱️ 版本历史</h3>
        <p style={styles.emptyText}>暂无历史版本</p>
        <button onClick={handleSaveSnapshot} style={styles.saveButton}>
          保存当前快照
        </button>
      </div>
    )
  }

  const currentSnapshot = annotationHistory[sliderValue]

  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>⏱️ 版本历史 - 时间旅行</h3>

      {isTimeTravelMode && (
        <div style={styles.banner}>
          <span>🔮 时间旅行模式 - 查看版本 v{historyVersion}</span>
          <button onClick={handleExit} style={styles.exitButton}>
            返回最新
          </button>
        </div>
      )}

      <div style={styles.sliderContainer}>
        <div style={styles.sliderHeader}>
          <span style={styles.versionLabel}>
            v{annotationHistory[0]?.version}
          </span>
          <span style={styles.versionInfo}>
            {currentSnapshot ? (
              <>
                版本 v{currentSnapshot.version} · 
                {currentSnapshot.annotations.length} 个标注 · 
                {new Date(currentSnapshot.timestamp).toLocaleString()}
              </>
            ) : '-'}
          </span>
          <span style={styles.versionLabel}>
            v{annotationHistory[annotationHistory.length - 1]?.version}
          </span>
        </div>
        
        <input
          type="range"
          min="0"
          max={annotationHistory.length - 1}
          value={sliderValue}
          onChange={handleSliderChange}
          style={styles.slider}
        />
        
        <div style={styles.tickMarks}>
          {annotationHistory.map((snap, i) => (
            <div
              key={i}
              style={{
                ...styles.tick,
                ...(i === sliderValue ? styles.activeTick : {})
              }}
              title={`v${snap.version}`}
            />
          ))}
        </div>
      </div>

      <div style={styles.buttonRow}>
        <button onClick={handleSaveSnapshot} style={styles.saveButton}>
          保存快照
        </button>
        <span style={styles.count}>
          {annotationHistory.length} 个历史版本
        </span>
      </div>

      <div style={styles.snapshotInfo}>
        <h4 style={styles.infoTitle}>当前快照详情</h4>
        {currentSnapshot && (
          <div style={styles.infoGrid}>
            <div>
              <span style={styles.infoLabel}>版本号:</span>
              <span style={styles.infoValue}>v{currentSnapshot.version}</span>
            </div>
            <div>
              <span style={styles.infoLabel}>标注数:</span>
              <span style={styles.infoValue}>{currentSnapshot.annotations.length}</span>
            </div>
            <div>
              <span style={styles.infoLabel}>保存时间:</span>
              <span style={styles.infoValue}>
                {new Date(currentSnapshot.timestamp).toLocaleString()}
              </span>
            </div>
          </div>
        )}
      </div>

      <div style={styles.legend}>
        <div style={styles.legendItem}>
          <span style={styles.legendDot} />
          <span>拖动画块浏览历史版本</span>
        </div>
        <div style={styles.legendItem}>
          <span style={styles.legendDotActive} />
          <span>当前查看的版本</span>
        </div>
      </div>
    </div>
  )
}

const styles = {
  panel: {
    padding: '16px',
    borderBottom: '1px solid #e0e0e0'
  },
  title: {
    margin: '0 0 12px 0',
    fontSize: '16px',
    color: '#1a1a2e'
  },
  banner: {
    backgroundColor: '#fef3c7',
    border: '1px solid #f59e0b',
    borderRadius: '6px',
    padding: '8px 12px',
    marginBottom: '12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    fontSize: '12px',
    color: '#92400e'
  },
  exitButton: {
    padding: '4px 10px',
    backgroundColor: '#f59e0b',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '11px'
  },
  emptyText: {
    fontSize: '12px',
    color: '#9ca3af',
    fontStyle: 'italic',
    marginBottom: '12px'
  },
  sliderContainer: {
    marginBottom: '12px'
  },
  sliderHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '8px',
    fontSize: '11px',
    color: '#6b7280'
  },
  versionLabel: {
    fontWeight: 'bold',
    color: '#4b5563'
  },
  versionInfo: {
    flex: 1,
    textAlign: 'center',
    fontSize: '11px'
  },
  slider: {
    width: '100%',
    height: '6px',
    borderRadius: '3px',
    background: '#e5e7eb',
    outline: 'none',
    cursor: 'pointer',
    appearance: 'none'
  },
  tickMarks: {
    display: 'flex',
    justifyContent: 'space-between',
    marginTop: '4px',
    padding: '0 4px'
  },
  tick: {
    width: '4px',
    height: '4px',
    borderRadius: '50%',
    backgroundColor: '#d1d5db'
  },
  activeTick: {
    backgroundColor: '#6366f1',
    transform: 'scale(1.5)'
  },
  buttonRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '12px'
  },
  saveButton: {
    padding: '6px 16px',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  count: {
    fontSize: '11px',
    color: '#6b7280'
  },
  snapshotInfo: {
    backgroundColor: '#f8fafc',
    borderRadius: '6px',
    padding: '10px',
    marginBottom: '12px'
  },
  infoTitle: {
    margin: '0 0 8px 0',
    fontSize: '12px',
    color: '#4b5563'
  },
  infoGrid: {
    display: 'grid',
    gap: '6px',
    fontSize: '11px'
  },
  infoLabel: {
    color: '#6b7280',
    marginRight: '8px'
  },
  infoValue: {
    color: '#1f2937',
    fontWeight: '500'
  },
  legend: {
    display: 'flex',
    gap: '16px',
    fontSize: '11px',
    color: '#6b7280'
  },
  legendItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px'
  },
  legendDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#d1d5db'
  },
  legendDotActive: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    backgroundColor: '#6366f1'
  }
}
