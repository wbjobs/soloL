import { useRef } from 'react'
import useStore from '../store/useStore'

function MidiUpload() {
  const fileInputRef = useRef(null)
  const { uploadMidi, loading } = useStore()

  const handleClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (file) {
      try {
        await uploadMidi(file)
      } catch (error) {
        console.error('Upload failed:', error)
      }
    }
    e.target.value = ''
  }

  const handleDrop = async (e) => {
    e.preventDefault()
    e.stopPropagation()
    
    const file = e.dataTransfer.files?.[0]
    if (file && (file.name.endsWith('.mid') || file.name.endsWith('.midi'))) {
      try {
        await uploadMidi(file)
      } catch (error) {
        console.error('Upload failed:', error)
      }
    }
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className="sidebar-section">
      <h3>上传 MIDI</h3>
      <div
        className="upload-area"
        onClick={handleClick}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".mid,.midi"
          onChange={handleFileChange}
        />
        <div className="upload-icon">🎵</div>
        <div className="upload-text">
          {loading ? '上传中...' : '点击或拖拽上传 MIDI 文件'}
        </div>
      </div>
    </div>
  )
}

export default MidiUpload
