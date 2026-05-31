import { useRef, useEffect } from 'react'
import useStore from '../store/useStore'

function SpectrumView() {
  const canvasRef = useRef(null)
  const { spectrumData, loading, selectedMidi, timePosition, setTimePosition } = useStore()

  useEffect(() => {
    if (!canvasRef.current || !spectrumData || !selectedMidi) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const width = canvas.width = canvas.offsetWidth * window.devicePixelRatio
    const height = canvas.height = canvas.offsetHeight * window.devicePixelRatio
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio)

    const spec = spectrumData.spectrogram
    const times = spectrumData.times
    const numRows = spec.length
    const numCols = spec[0].length

    const imageData = ctx.createImageData(width, height)
    const data = imageData.data

    const colormap = (value) => {
      if (value < 0.25) {
        const t = value / 0.25
        return [0, 0, Math.floor(55 + 200 * t), 255]
      } else if (value < 0.5) {
        const t = (value - 0.25) / 0.25
        return [0, Math.floor(100 + 155 * t), 255, 255]
      } else if (value < 0.75) {
        const t = (value - 0.5) / 0.25
        return [Math.floor(100 + 155 * t), 255, Math.floor(255 - 255 * t), 255]
      } else {
        const t = (value - 0.75) / 0.25
        return [255, Math.floor(255 - 255 * t), 0, 255]
      }
    }

    for (let y = 0; y < height; y++) {
      const rowIdx = Math.floor((1 - y / height) * (numRows - 1))
      for (let x = 0; x < width; x++) {
        const colIdx = Math.floor((x / width) * (numCols - 1))
        const value = spec[rowIdx][colIdx]
        const [r, g, b, a] = colormap(value)
        const idx = (y * width + x) * 4
        data[idx] = r
        data[idx + 1] = g
        data[idx + 2] = b
        data[idx + 3] = a
      }
    }

    ctx.putImageData(imageData, 0, 0)

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.lineWidth = 1
    for (let octave = 0; octave < 9; octave++) {
      const y = height - (octave / 8) * height
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }

    for (let sec = 0; sec <= selectedMidi.total_duration; sec += 10) {
      const x = (sec / selectedMidi.total_duration) * width
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }

    const indicatorX = (timePosition / selectedMidi.total_duration) * width
    ctx.strokeStyle = 'rgba(236, 72, 153, 0.9)'
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(indicatorX, 0)
    ctx.lineTo(indicatorX, height)
    ctx.stroke()

    ctx.fillStyle = '#8080c0'
    ctx.font = '11px sans-serif'
    for (let octave = 1; octave <= 8; octave++) {
      const y = height - ((octave - 1) / 7) * height
      ctx.fillText(`C${octave}`, 5, y - 2)
    }

    for (let sec = 0; sec <= selectedMidi.total_duration; sec += 30) {
      const x = (sec / selectedMidi.total_duration) * width
      ctx.fillText(`${sec}s`, x + 3, height - 5)
    }

  }, [spectrumData, selectedMidi, timePosition])

  const handleClick = (e) => {
    if (!canvasRef.current || !selectedMidi) return
    const rect = canvasRef.current.getBoundingClientRect()
    const x = e.clientX - rect.left
    const ratio = x / rect.width
    setTimePosition(ratio * selectedMidi.total_duration)
  }

  if (!selectedMidi) {
    return (
      <div className="spectrum-container">
        <div className="empty-state">
          <div className="empty-state-icon">📊</div>
          <div className="empty-state-text">选择一个 MIDI 文件</div>
          <div className="empty-state-subtext">加载后将显示频谱瀑布图</div>
        </div>
      </div>
    )
  }

  if (loading || !spectrumData) {
    return (
      <div className="spectrum-container">
        <div className="loading">
          <div className="spinner"></div>
        </div>
      </div>
    )
  }

  return (
    <div className="spectrum-container">
      <h3 style={{ fontSize: '14px', color: '#a0a0d0', marginBottom: '12px' }}>
        频谱瀑布图 - {selectedMidi.filename}
      </h3>
      <canvas
        ref={canvasRef}
        style={{
          width: '100%',
          height: 'calc(100% - 40px)',
          border: '1px solid #2a2a5a',
          borderRadius: '8px',
          cursor: 'pointer'
        }}
        onClick={handleClick}
      />
    </div>
  )
}

export default SpectrumView
