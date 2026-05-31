import React, { useRef, useEffect } from 'react'

interface FingerprintVisualizerProps {
  fingerprint: Uint8Array
  audioData?: Float32Array
  sampleRate?: number
}

const FingerprintVisualizer: React.FC<FingerprintVisualizerProps> = ({
  fingerprint,
  audioData,
  sampleRate
}) => {
  const heatmapCanvasRef = useRef<HTMLCanvasElement>(null)
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    drawHeatmap()
  }, [fingerprint])

  useEffect(() => {
    if (audioData && sampleRate) {
      drawSpectrum()
    }
  }, [audioData, sampleRate])

  const drawHeatmap = () => {
    const canvas = heatmapCanvasRef.current
    if (!canvas || fingerprint.length === 0) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const cols = 8
    const rows = 4
    const cellWidth = canvas.width / cols
    const cellHeight = canvas.height / rows

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    for (let byteIdx = 0; byteIdx < fingerprint.length; byteIdx++) {
      const col = byteIdx % cols
      const row = Math.floor(byteIdx / cols)
      const byteVal = fingerprint[byteIdx]

      const cellX = col * cellWidth
      const cellY = row * cellHeight
      const bitCellW = cellWidth / 8
      const bitCellH = cellHeight

      for (let bit = 0; bit < 8; bit++) {
        const isSet = (byteVal >> bit) & 1
        const bitX = cellX + bit * bitCellW

        if (isSet) {
          const intensity = 0.5 + (bit / 8) * 0.5
          const r = Math.round(102 * intensity)
          const g = Math.round(126 * intensity)
          const b = Math.round(234 * intensity)
          ctx.fillStyle = `rgb(${r}, ${g}, ${b})`
        } else {
          ctx.fillStyle = '#1e293b'
        }

        const padding = 1
        ctx.fillRect(bitX + padding, cellY + padding, bitCellW - padding * 2, bitCellH - padding * 2)
      }

      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 0.5
      ctx.strokeRect(cellX, cellY, cellWidth, cellHeight)
    }

    ctx.fillStyle = '#94a3b8'
    ctx.font = '9px monospace'
    for (let i = 0; i < fingerprint.length; i++) {
      const col = i % cols
      const row = Math.floor(i / cols)
      const x = col * cellWidth + 2
      const y = row * cellHeight + cellHeight - 3
      ctx.fillText(`B${i}`, x, y)
    }
  }

  const drawSpectrum = () => {
    const canvas = spectrumCanvasRef.current
    if (!canvas || !audioData || !sampleRate) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    const fftSize = 1024
    const numBins = fftSize / 2

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, width, height)

    const numFrames = Math.min(200, Math.floor((audioData.length - fftSize) / 512) + 1)
    const frameWidth = width / numFrames

    for (let frame = 0; frame < numFrames; frame++) {
      const offset = frame * 512
      if (offset + fftSize > audioData.length) break

      const spectrum = computeFrameSpectrum(audioData, offset, fftSize)
      const barHeight = height / numBins

      for (let bin = 0; bin < numBins; bin++) {
        const magnitude = spectrum[bin]
        const normalized = Math.min(1, magnitude / 50)

        const hue = 240 - normalized * 240
        const lightness = 10 + normalized * 50

        ctx.fillStyle = `hsl(${hue}, 80%, ${lightness}%)`
        ctx.fillRect(
          frame * frameWidth,
          height - (bin + 1) * barHeight,
          frameWidth + 0.5,
          barHeight + 0.5
        )
      }
    }

    ctx.fillStyle = '#94a3b8'
    ctx.font = '10px sans-serif'
    const freqLabels = [100, 500, 1000, 5000, 10000, 20000]
    for (const freq of freqLabels) {
      const bin = Math.round(freq / (sampleRate / fftSize))
      const y = height - (bin / numBins) * height
      if (y > 10 && y < height - 5) {
        ctx.fillText(`${freq >= 1000 ? freq / 1000 + 'k' : freq}Hz`, 2, y)
      }
    }
  }

  const computeFrameSpectrum = (audio: Float32Array, offset: number, fftSize: number): Float32Array => {
    const real = new Float32Array(fftSize)
    const imag = new Float32Array(fftSize)
    const window = new Float32Array(fftSize)

    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)))
    }

    for (let i = 0; i < fftSize && offset + i < audio.length; i++) {
      real[i] = audio[offset + i] * window[i]
    }

    let stageSize = 2
    while (stageSize <= fftSize) {
      const halfStage = stageSize / 2
      const step = fftSize / stageSize

      for (let group = 0; group < fftSize; group += stageSize) {
        for (let pair = 0; pair < halfStage; pair++) {
          const idx1 = group + pair
          const idx2 = group + pair + halfStage

          const angle = -2 * Math.PI * pair / stageSize
          const twiddleRe = Math.cos(angle)
          const twiddleIm = Math.sin(angle)

          const tRe = real[idx2] * twiddleRe - imag[idx2] * twiddleIm
          const tIm = real[idx2] * twiddleIm + imag[idx2] * twiddleRe

          real[idx2] = real[idx1] - tRe
          imag[idx2] = imag[idx1] - tIm
          real[idx1] = real[idx1] + tRe
          imag[idx1] = imag[idx1] + tIm
        }
      }

      stageSize *= 2
    }

    const magnitude = new Float32Array(fftSize / 2)
    for (let i = 0; i < fftSize / 2; i++) {
      magnitude[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
    }
    return magnitude
  }

  return (
    <div className="visualizer-container">
      <div className="visualizer-section">
        <h3>指纹热力图</h3>
        <canvas
          ref={heatmapCanvasRef}
          width={640}
          height={160}
          className="visualizer-canvas"
        />
        <div className="heatmap-legend">
          <span className="legend-item">
            <span className="legend-color" style={{ background: '#1e293b' }}></span>
            0 (off)
          </span>
          <span className="legend-item">
            <span className="legend-color" style={{ background: '#667eea' }}></span>
            1 (on)
          </span>
        </div>
      </div>

      {audioData && sampleRate && (
        <div className="visualizer-section">
          <h3>频谱图</h3>
          <canvas
            ref={spectrumCanvasRef}
            width={640}
            height={240}
            className="visualizer-canvas"
          />
          <div className="heatmap-legend">
            <span className="legend-item">
              <span className="legend-color" style={{ background: 'hsl(240, 80%, 10%)' }}></span>
              低能量
            </span>
            <span className="legend-item">
              <span className="legend-color" style={{ background: 'hsl(120, 80%, 60%)' }}></span>
              高能量
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default FingerprintVisualizer
