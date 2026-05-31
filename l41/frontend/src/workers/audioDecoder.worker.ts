interface DecodeRequest {
  type: 'decode'
  file: File
}

interface DecodeProgress {
  type: 'progress'
  progress: number
  stage: string
}

interface DecodeResult {
  type: 'result'
  audioData: Float32Array
  sampleRate: number
  duration: number
  channels: number
}

interface DecodeError {
  type: 'error'
  error: string
}

type WorkerMessage = DecodeRequest | DecodeProgress | DecodeResult | DecodeError

let audioContext: OfflineAudioContext | null = null

async function getAudioContext(channels: number, sampleRate: number, length: number): Promise<OfflineAudioContext> {
  if (audioContext) {
    try {
      audioContext.close()
    } catch (_) {}
  }
  audioContext = new OfflineAudioContext(channels, length, sampleRate)
  return audioContext
}

async function decodeAudioFile(file: File): Promise<{
  audioData: Float32Array
  sampleRate: number
  duration: number
  channels: number
}> {
  postMessage({ type: 'progress', progress: 10, stage: '读取文件...' } as DecodeProgress)

  const arrayBuffer = await file.arrayBuffer()

  postMessage({ type: 'progress', progress: 20, stage: '探测音频格式...' } as DecodeProgress)

  const probeCtx = new OfflineAudioContext(1, 1, 44100)
  let audioBuffer: AudioBuffer
  try {
    audioBuffer = await probeCtx.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    probeCtx.close()
  }

  postMessage({ type: 'progress', progress: 40, stage: '解码音频...' } as DecodeProgress)

  const channels = audioBuffer.numberOfChannels
  const length = audioBuffer.length
  const originalSampleRate = audioBuffer.sampleRate

  const targetSampleRate = 44100
  const resampledLength = Math.ceil(length * targetSampleRate / originalSampleRate)

  const decodeCtx = await getAudioContext(channels, originalSampleRate, length)
  const decodedBuffer = await decodeCtx.startRendering()

  postMessage({ type: 'progress', progress: 60, stage: '混缩声道...' } as DecodeProgress)

  let mixedData: Float32Array

  if (channels === 1) {
    mixedData = decodedBuffer.getChannelData(0)
  } else {
    mixedData = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      let sum = 0
      for (let c = 0; c < channels; c++) {
        sum += decodedBuffer.getChannelData(c)[i]
      }
      mixedData[i] = sum / channels
    }
  }

  let finalData: Float32Array

  if (originalSampleRate !== targetSampleRate) {
    postMessage({ type: 'progress', progress: 75, stage: '重采样...' } as DecodeProgress)
    finalData = resampleChunked(mixedData, originalSampleRate, targetSampleRate)
  } else {
    finalData = mixedData
  }

  postMessage({ type: 'progress', progress: 100, stage: '完成' } as DecodeProgress)

  const duration = length / originalSampleRate

  return {
    audioData: finalData,
    sampleRate: targetSampleRate,
    duration,
    channels
  }
}

function resampleChunked(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  const ratio = toRate / fromRate
  const outputLength = Math.floor(input.length * ratio)
  const output = new Float32Array(outputLength)

  const CHUNK_SIZE = 65536
  for (let start = 0; start < outputLength; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, outputLength)

    for (let i = start; i < end; i++) {
      const position = i / ratio
      const index = Math.floor(position)
      const fraction = position - index

      if (index >= input.length - 1) {
        output[i] = input[input.length - 1]
      } else {
        output[i] = input[index] * (1 - fraction) + input[index + 1] * fraction
      }
    }

    if (end < outputLength) {
      const pct = Math.round((end / outputLength) * 20) + 75
      postMessage({ type: 'progress', progress: pct, stage: '重采样...' } as DecodeProgress)
    }
  }

  return output
}

self.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  if (e.data.type === 'decode') {
    try {
      const result = await decodeAudioFile(e.data.file)
      const transferable = result.audioData.buffer
      postMessage({
        type: 'result',
        audioData: result.audioData,
        sampleRate: result.sampleRate,
        duration: result.duration,
        channels: result.channels
      } as DecodeResult, [transferable])
    } catch (error) {
      postMessage({
        type: 'error',
        error: error instanceof Error ? error.message : '解码失败'
      } as DecodeError)
    }
  }
}
