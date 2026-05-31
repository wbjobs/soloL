import React, { useState, useRef } from 'react'
import { extractFingerprint, fingerprintToHex } from '../wasm/fingerprintWrapper'
import FingerprintVisualizer from './FingerprintVisualizer'

const AudioUploader: React.FC = () => {
  const [file, setFile] = useState<File | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressStage, setProgressStage] = useState('')
  const [fingerprint, setFingerprint] = useState<Uint8Array | null>(null)
  const [audioData, setAudioData] = useState<Float32Array | null>(null)
  const [sampleRate, setSampleRate] = useState<number>(44100)
  const [audioInfo, setAudioInfo] = useState<{
    duration: number
    sampleRate: number
    channels: number
  } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const workerRef = useRef<Worker | null>(null)

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      setFile(selectedFile)
      setFingerprint(null)
      setAudioData(null)
      setError(null)
      setAudioInfo(null)
    }
  }

  const processAudio = async () => {
    if (!file) return

    setIsProcessing(true)
    setError(null)
    setProgress(0)
    setProgressStage('准备中...')

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/audioDecoder.worker.ts', import.meta.url)
      )
    }

    const worker = workerRef.current

    worker.onmessage = async (e) => {
      const msg = e.data

      if (msg.type === 'progress') {
        setProgress(msg.progress)
        setProgressStage(msg.stage)
      } else if (msg.type === 'result') {
        setProgress(90)
        setProgressStage('提取指纹...')
        setAudioInfo({
          duration: msg.duration,
          sampleRate: msg.sampleRate,
          channels: msg.channels
        })
        setSampleRate(msg.sampleRate)

        setTimeout(async () => {
          try {
            const fp = extractFingerprint(msg.audioData)
            setFingerprint(fp)
            setAudioData(msg.audioData)
            setProgress(100)
            setProgressStage('完成')
          } catch (err) {
            setError('指纹提取失败')
          } finally {
            setIsProcessing(false)
          }
        }, 100)
      } else if (msg.type === 'error') {
        setError(msg.error)
        setIsProcessing(false)
      }
    }

    worker.postMessage({ type: 'decode', file })
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  return (
    <div className="uploader-container">
      <h2>音频指纹提取</h2>
      
      <div className="file-input-wrapper">
        <input
          type="file"
          accept=".mp3,.wav,.ogg,.flac"
          onChange={handleFileChange}
          disabled={isProcessing}
        />
      </div>

      {file && (
        <div className="file-info">
          <p><strong>文件名:</strong> {file.name}</p>
          <p><strong>大小:</strong> {formatFileSize(file.size)}</p>
          <p><strong>类型:</strong> {file.type || '未知'}</p>
        </div>
      )}

      {file && !isProcessing && (
        <button
          onClick={processAudio}
          className="process-button"
        >
          提取指纹
        </button>
      )}

      {isProcessing && (
        <div className="progress-container">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="progress-text">{progressStage} ({progress}%)</p>
        </div>
      )}

      {audioInfo && (
        <div className="audio-info">
          <h3>音频信息</h3>
          <p><strong>时长:</strong> {formatDuration(audioInfo.duration)}</p>
          <p><strong>采样率:</strong> {audioInfo.sampleRate} Hz</p>
          <p><strong>声道:</strong> {audioInfo.channels}</p>
        </div>
      )}

      {fingerprint && (
        <div className="fingerprint-result">
          <h3>指纹结果</h3>
          <div className="fingerprint-hex">
            <code>{fingerprintToHex(fingerprint)}</code>
          </div>
          <p className="fingerprint-size">大小: {fingerprint.length} 字节 ({fingerprint.length * 8} 位)</p>
          <div className="fingerprint-binary">
            {Array.from(fingerprint).map((byte, i) => (
              <span key={i} className="byte-block">
              {byte.toString(2).padStart(8, '0')}
              </span>
            ))}
          </div>
        </div>
      )}

      {fingerprint && (
        <FingerprintVisualizer
          fingerprint={fingerprint}
          audioData={audioData || undefined}
          sampleRate={sampleRate}
        />
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}
    </div>
  )
}

export default AudioUploader
