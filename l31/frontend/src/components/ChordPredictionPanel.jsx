import { useState, useEffect } from 'react'
import useStore from '../store/useStore'
import { detectChordFromNotes, CHORD_TYPES, NOTE_NAMES } from '../utils/chordUtils'

export default function ChordPredictionPanel() {
  const {
    selectedMidi,
    selectedTimeRange,
    selectionNotes,
    modelTrained,
    modelTraining,
    predictedChord,
    chordPredictions,
    annotations,
    trainChordModel,
    predictChord,
    saveModel,
    loadModel,
    resetModel,
    setSelectedTimeRange,
    clearSelection,
    createAnnotation,
    logOperation,
    saveAnnotationSnapshot
  } = useStore()

  const [ruleBasedChord, setRuleBasedChord] = useState(null)
  const [trainingProgress, setTrainingProgress] = useState({ epoch: 0, total: 50 })

  useEffect(() => {
    if (selectionNotes.length > 0) {
      const detected = detectChordFromNotes(selectionNotes)
      setRuleBasedChord(detected)
    } else {
      setRuleBasedChord(null)
    }
  }, [selectionNotes])

  const handleTrainModel = async () => {
    try {
      await trainChordModel(30)
      await saveModel()
      await logOperation('train_model', { examples: annotations.filter(a => a.type === 'chord').length })
    } catch (error) {
      alert(error.message)
    }
  }

  const handlePredict = async () => {
    await predictChord()
    await logOperation('predict_chord', {
      timeRange: selectedTimeRange,
      noteCount: selectionNotes.length
    })
  }

  const handleApplyPrediction = async (chord) => {
    if (!selectedTimeRange) return
    
    try {
      await createAnnotation({
        midi_id: selectedMidi._id,
        start_time: selectedTimeRange.start,
        end_time: selectedTimeRange.end,
        type: 'chord',
        label: chord.label,
        description: `Auto-predicted ${chord.type} chord`
      })
      await saveAnnotationSnapshot()
      await logOperation('apply_prediction', { chord: chord.label })
      clearSelection()
    } catch (error) {
      console.error('Failed to apply prediction:', error)
    }
  }

  if (!selectedMidi) return null

  const chordCount = annotations.filter(a => a.type === 'chord').length

  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>🎵 智能和弦预测</h3>

      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>模型训练</h4>
        <div style={styles.stats}>
          <span style={styles.stat}>和弦标注: {chordCount}</span>
          <span style={styles.stat}>状态: {modelTrained ? '✅ 已训练' : modelTraining ? '⏳ 训练中...' : '❌ 未训练'}</span>
        </div>
        <div style={styles.buttonRow}>
          <button
            onClick={handleTrainModel}
            disabled={modelTraining || chordCount < 5}
            style={{
              ...styles.button,
              ...(modelTraining || chordCount < 5 ? styles.buttonDisabled : {})
            }}
          >
            {modelTraining ? '训练中...' : '训练LSTM模型'}
          </button>
          <button onClick={loadModel} style={styles.buttonSecondary}>
            加载模型
          </button>
          <button onClick={resetModel} style={styles.buttonDanger}>
            重置
          </button>
        </div>
        {chordCount < 5 && (
          <p style={styles.hint}>需要至少5个和弦标注才能训练模型</p>
        )}
      </div>

      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>
          选区预测
          {selectedTimeRange && (
            <span style={styles.rangeBadge}>
              {selectedTimeRange.start.toFixed(1)}s - {selectedTimeRange.end.toFixed(1)}s
            </span>
          )}
        </h4>
        
        {!selectedTimeRange ? (
          <p style={styles.hint}>在3D视图中拖动选择时间区域来预测和弦</p>
        ) : (
          <>
            <div style={styles.noteCount}>
              选区音符数: {selectionNotes.length}
            </div>

            <div style={styles.predictionSection}>
              <h5 style={styles.subTitle}>规则匹配:</h5>
              {ruleBasedChord ? (
                <div style={styles.chordResult}>
                  <span style={styles.chordName}>{ruleBasedChord.label}</span>
                  <span style={styles.chordType}>{CHORD_TYPES[ruleBasedChord.type]?.name}</span>
                  <span style={styles.confidence}>
                    置信度: {(ruleBasedChord.confidence * 100).toFixed(0)}%
                  </span>
                  <button
                    onClick={() => handleApplyPrediction(ruleBasedChord)}
                    style={styles.applyButton}
                  >
                    应用
                  </button>
                </div>
              ) : (
                <span style={styles.noResult}>无法识别</span>
              )}
            </div>

            {modelTrained && (
              <div style={styles.predictionSection}>
                <h5 style={styles.subTitle}>LSTM模型预测:</h5>
                <button
                  onClick={handlePredict}
                  disabled={modelTraining || selectionNotes.length === 0}
                  style={styles.predictButton}
                >
                  预测和弦
                </button>
                
                {chordPredictions.length > 0 && (
                  <div style={styles.predictionList}>
                    {chordPredictions.map((chord, i) => (
                      <div key={i} style={{
                        ...styles.predictionItem,
                        ...(i === 0 ? styles.topPrediction : {})
                      }}>
                        <span style={styles.rank}>{i + 1}.</span>
                        <span style={styles.chordName}>{chord.label}</span>
                        <span style={styles.confidenceBar}>
                          <span style={{
                            ...styles.confidenceFill,
                            width: `${chord.confidence * 100}%`
                          }} />
                        </span>
                        <span style={styles.confidence}>
                          {(chord.confidence * 100).toFixed(1)}%
                        </span>
                        <button
                          onClick={() => handleApplyPrediction(chord)}
                          style={styles.applyButton}
                        >
                          应用
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <button onClick={clearSelection} style={styles.clearButton}>
              清除选区
            </button>
          </>
        )}
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
  section: {
    marginBottom: '16px'
  },
  sectionTitle: {
    margin: '0 0 8px 0',
    fontSize: '14px',
    color: '#4a4a6a',
    display: 'flex',
    alignItems: 'center',
    gap: '8px'
  },
  subTitle: {
    margin: '0 0 8px 0',
    fontSize: '12px',
    color: '#666'
  },
  stats: {
    display: 'flex',
    gap: '16px',
    marginBottom: '8px',
    fontSize: '12px',
    color: '#666'
  },
  stat: {},
  buttonRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap'
  },
  button: {
    padding: '6px 12px',
    backgroundColor: '#6366f1',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  buttonSecondary: {
    padding: '6px 12px',
    backgroundColor: '#e0e7ff',
    color: '#4338ca',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  buttonDanger: {
    padding: '6px 12px',
    backgroundColor: '#fee2e2',
    color: '#dc2626',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  },
  buttonDisabled: {
    backgroundColor: '#cbd5e1',
    cursor: 'not-allowed'
  },
  hint: {
    margin: '8px 0 0 0',
    fontSize: '11px',
    color: '#9ca3af'
  },
  rangeBadge: {
    backgroundColor: '#e0e7ff',
    color: '#4338ca',
    padding: '2px 8px',
    borderRadius: '10px',
    fontSize: '11px'
  },
  noteCount: {
    fontSize: '12px',
    color: '#666',
    marginBottom: '8px'
  },
  predictionSection: {
    marginTop: '12px',
    padding: '10px',
    backgroundColor: '#f8fafc',
    borderRadius: '6px'
  },
  chordResult: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '8px'
  },
  chordName: {
    fontWeight: 'bold',
    fontSize: '16px',
    color: '#1a1a2e',
    minWidth: '60px'
  },
  chordType: {
    fontSize: '12px',
    color: '#666'
  },
  confidence: {
    fontSize: '11px',
    color: '#666',
    minWidth: '50px'
  },
  confidenceBar: {
    flex: 1,
    height: '6px',
    backgroundColor: '#e5e7eb',
    borderRadius: '3px',
    overflow: 'hidden',
    maxWidth: '100px'
  },
  confidenceFill: {
    height: '100%',
    backgroundColor: '#6366f1',
    display: 'block'
  },
  applyButton: {
    padding: '4px 10px',
    backgroundColor: '#10b981',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '11px'
  },
  noResult: {
    color: '#9ca3af',
    fontStyle: 'italic'
  },
  predictButton: {
    width: '100%',
    padding: '8px',
    backgroundColor: '#8b5cf6',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px',
    marginBottom: '10px'
  },
  predictionList: {
    display: 'flex',
    flexDirection: 'column',
    gap: '6px'
  },
  predictionItem: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '6px 8px',
    backgroundColor: 'white',
    borderRadius: '4px',
    fontSize: '12px'
  },
  topPrediction: {
    backgroundColor: '#ede9fe',
    border: '1px solid #a78bfa'
  },
  rank: {
    color: '#9ca3af',
    width: '20px'
  },
  clearButton: {
    marginTop: '12px',
    padding: '6px 12px',
    backgroundColor: 'transparent',
    color: '#6b7280',
    border: '1px solid #d1d5db',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '12px'
  }
}
