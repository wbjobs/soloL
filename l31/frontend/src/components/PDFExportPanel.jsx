import { useState, useRef } from 'react'
import useStore from '../store/useStore'
import { downloadReport } from '../services/pdfReport'

export default function PDFExportPanel() {
  const {
    selectedMidi,
    annotations,
    getAllNotes,
    logOperation
  } = useStore()

  const [exporting, setExporting] = useState(false)
  const [includeSpectrum, setIncludeSpectrum] = useState(true)
  const spectrumCanvasRef = useRef(null)

  const captureSpectrum = () => {
    const canvas = document.querySelector('canvas')
    if (canvas) {
      return canvas.toDataURL('image/png')
    }
    return null
  }

  const handleExport = async () => {
    if (!selectedMidi) return

    setExporting(true)
    try {
      let spectrumDataUrl = null
      if (includeSpectrum) {
        spectrumDataUrl = captureSpectrum()
      }

      const notes = getAllNotes()
      const filename = `${selectedMidi.filename?.replace('.mid', '') || 'midi'}-annotation-report.pdf`
      
      downloadReport(
        {
          ...selectedMidi,
          num_tracks: selectedMidi.tracks?.length || 0,
          num_notes: selectedMidi.notes?.length || notes.length,
          duration: selectedMidi.total_duration,
          tempo: selectedMidi.tempo || 120,
          time_signature: selectedMidi.time_signature || '4/4'
        },
        annotations,
        notes,
        spectrumDataUrl,
        filename
      )

      await logOperation('export_report', {
        filename,
        annotationCount: annotations.length,
        includeSpectrum
      })

    } catch (error) {
      console.error('Export failed:', error)
      alert('导出失败: ' + error.message)
    } finally {
      setExporting(false)
    }
  }

  if (!selectedMidi) return null

  const chordCount = annotations.filter(a => a.type === 'chord').length
  const melodyCount = annotations.filter(a => a.type === 'melody').length
  const otherCount = annotations.length - chordCount - melodyCount

  return (
    <div style={styles.panel}>
      <h3 style={styles.title}>📄 导出PDF报告</h3>

      <div style={styles.stats}>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{annotations.length}</span>
          <span style={styles.statLabel}>总标注</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{chordCount}</span>
          <span style={styles.statLabel}>和弦</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{melodyCount}</span>
          <span style={styles.statLabel}>旋律</span>
        </div>
        <div style={styles.statItem}>
          <span style={styles.statValue}>{otherCount}</span>
          <span style={styles.statLabel}>其他</span>
        </div>
      </div>

      <div style={styles.options}>
        <h4 style={styles.optionTitle}>导出选项</h4>
        <label style={styles.checkboxLabel}>
          <input
            type="checkbox"
            checked={includeSpectrum}
            onChange={(e) => setIncludeSpectrum(e.target.checked)}
            style={styles.checkbox}
          />
          <span>包含频谱截图</span>
        </label>
      </div>

      <div style={styles.previewInfo}>
        <h4 style={styles.optionTitle}>报告包含</h4>
        <ul style={styles.featureList}>
          <li>✅ MIDI文件基本信息</li>
          <li>✅ 频谱瀑布图（可选）</li>
          <li>✅ 标注统计数据</li>
          <li>✅ 和弦分布统计</li>
          <li>✅ 标注覆盖率分析</li>
          <li>✅ 详细标注列表</li>
        </ul>
      </div>

      <button
        onClick={handleExport}
        disabled={exporting || annotations.length === 0}
        style={{
          ...styles.exportButton,
          ...(exporting || annotations.length === 0 ? styles.buttonDisabled : {})
        }}
      >
        {exporting ? '导出中...' : '📥 导出PDF报告'}
      </button>

      {annotations.length === 0 && (
        <p style={styles.hint}>需要至少一个标注才能生成报告</p>
      )}
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
  stats: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '16px',
    padding: '12px',
    backgroundColor: '#f8fafc',
    borderRadius: '6px'
  },
  statItem: {
    textAlign: 'center'
  },
  statValue: {
    display: 'block',
    fontSize: '20px',
    fontWeight: 'bold',
    color: '#6366f1'
  },
  statLabel: {
    fontSize: '11px',
    color: '#6b7280'
  },
  options: {
    marginBottom: '12px'
  },
  optionTitle: {
    margin: '0 0 8px 0',
    fontSize: '12px',
    color: '#4b5563'
  },
  checkboxLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '12px',
    color: '#374151',
    cursor: 'pointer'
  },
  checkbox: {
    cursor: 'pointer'
  },
  previewInfo: {
    marginBottom: '16px'
  },
  featureList: {
    margin: 0,
    paddingLeft: '20px',
    fontSize: '11px',
    color: '#6b7280',
    lineHeight: '1.8'
  },
  exportButton: {
    width: '100%',
    padding: '10px',
    backgroundColor: '#059669',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '14px',
    fontWeight: '600'
  },
  buttonDisabled: {
    backgroundColor: '#9ca3af',
    cursor: 'not-allowed'
  },
  hint: {
    margin: '8px 0 0 0',
    fontSize: '11px',
    color: '#f59e0b',
    textAlign: 'center'
  }
}
