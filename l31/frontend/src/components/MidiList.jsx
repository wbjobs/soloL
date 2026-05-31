import { useEffect } from 'react'
import useStore from '../store/useStore'

function MidiList() {
  const { midiFiles, selectedMidiId, loadMidiFiles, selectMidi, loading } = useStore()

  useEffect(() => {
    loadMidiFiles()
  }, [])

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  if (loading && midiFiles.length === 0) {
    return (
      <div className="sidebar-section">
        <h3>MIDI 文件</h3>
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="sidebar-section">
        <h3>MIDI 文件 ({midiFiles.length})</h3>
      </div>
      <div className="midi-list">
        {midiFiles.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📂</div>
            <div className="empty-state-text">暂无文件</div>
            <div className="empty-state-subtext">上传一个 MIDI 文件开始</div>
          </div>
        ) : (
          midiFiles.map((file) => (
            <div
              key={file.midi_id}
              className={`midi-item ${selectedMidiId === file.midi_id ? 'active' : ''}`}
              onClick={() => selectMidi(file.midi_id)}
            >
              <div className="midi-item-name" title={file.filename}>
                {file.filename}
              </div>
              <div className="midi-item-meta">
                <span>🎹 {file.total_notes} 音符</span>
                <span>⏱️ {formatDuration(file.total_duration)}</span>
                <span>🎼 {file.track_count} 轨道</span>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  )
}

export default MidiList
