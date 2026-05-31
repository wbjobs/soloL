import React, { useState, useRef, useEffect } from 'react'
import { extractFingerprint, fingerprintToHex } from '../wasm/fingerprintWrapper'

interface RealtimeRecorderProps {
  onFingerprintExtracted: (fingerprint: Uint8Array, audioData: Float32Array) => void
}

const RealtimeRecorder: React.FC<RealtimeRecorderProps> = ({ onFingerprintExtracted }) => {
  const [isRecording, setIsRecording] = useState(false)
  const [hasPermission, setHasPermission] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [volumeLevel, setVolumeLevel] = useState(0)
  const [recordingDuration, setRecordingDuration] = useState(0)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animFrameRef = useRef<number>(0)
  const chunksRef = useRef<Blob[]>([])
  const startTimeRef = useRef<number>(0)
  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    return () => {
      stopRecording()
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current)
      }
      if (durationTimerRef.current) {
        clearInterval(durationTimerRef.current)
      }
    }
  }, [])

  const requestMicrophone = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: 44100,
          echoCancellation: true,
          noiseSuppression: true
        }
      })

      const audioCtx = new AudioContext({ sampleRate: 44100 })
      const source = audioCtx.createMediaStreamSource(stream)
      const analyser = audioCtx.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)

      audioContextRef.current = audioCtx
      analyserRef.current = analyser
      mediaRecorderRef.current = new MediaRecorder(stream)

      setHasPermission(true)
      startVolumeMonitor()
    } catch (err) {
      setHasPermission(false)
      setError('麦克风权限被拒绝，请在浏览器设置中允许麦克风访问')
    }
  }

  const startVolumeMonitor = () => {
    const analyser = analyserRef.current
    if (!analyser) return

    const dataArray = new Uint8Array(analyser.frequencyBinCount)

    const update = () => {
      analyser.getByteFrequencyData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i]
      }
      const avg = sum / dataArray.length
      setVolumeLevel(avg / 255)
      animFrameRef.current = requestAnimationFrame(update)
    }

    update()
  }

  const startRecording = async () => {
    if (!mediaRecorderRef.current) {
      await requestMicrophone()
      if (!mediaRecorderRef.current) return
    }

    chunksRef.current = []
    startTimeRef.current = Date.now()
    setRecordingDuration(0)

    mediaRecorderRef.current.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data)
      }
    }

    mediaRecorderRef.current.onstop = async () => {
      const blob = new Blob(chunksRef.current, { type: 'audio/webm' })
      await processRecording(blob)
    }

    mediaRecorderRef.current.start(1000)
    setIsRecording(true)

    durationTimerRef.current = setInterval(() => {
      setRecordingDuration(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 1000)
  }

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }

    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current)
      durationTimerRef.current = null
    }

    setIsRecording(false)
  }

  const processRecording = async (blob: Blob) => {
    try {
      const arrayBuffer = await blob.arrayBuffer()
      const audioCtx = audioContextRef.current || new AudioContext({ sampleRate: 44100 })
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer)

      const channelData = audioBuffer.getChannelData(0)

      const fingerprint = extractFingerprint(channelData)
      onFingerprintExtracted(fingerprint, channelData)
    } catch (err) {
      setError('录音处理失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = seconds % 60
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  return (
    <div className="recorder-container">
      <h2>实时录音</h2>

      {hasPermission === false && (
        <div className="error-message">{error}</div>
      )}

      {hasPermission === null && (
        <button onClick={requestMicrophone} className="permission-button">
          授权麦克风
        </button>
      )}

      {hasPermission && (
        <>
          <div className="volume-meter">
            <div className="volume-bar">
              <div
                className={`volume-fill ${isRecording ? 'recording' : ''}`}
                style={{ width: `${volumeLevel * 100}%` }}
              />
            </div>
            {isRecording && (
              <span className="recording-duration">{formatDuration(recordingDuration)}</span>
            )}
          </div>

          <div className="recorder-controls">
            {!isRecording ? (
              <button
                onClick={startRecording}
                className="record-button start"
              >
                ⏺ 开始录音
              </button>
            ) : (
              <button
                onClick={stopRecording}
                className="record-button stop"
              >
                ⏹ 停止录音并提取指纹
              </button>
            )}
          </div>

          {isRecording && (
            <div className="recording-indicator">
              <span className="recording-dot"></span>
              录音中...
            </div>
          )}
        </>
      )}

      {error && hasPermission !== false && (
        <div className="error-message">{error}</div>
      )}
    </div>
  )
}

export default RealtimeRecorder
