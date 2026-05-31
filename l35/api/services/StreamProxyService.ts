import { LRUCache } from 'lru-cache'
import ffmpeg from 'fluent-ffmpeg'
import { PassThrough } from 'stream'

export interface KeyframeData {
  data: Buffer
  timestamp: number
  isKeyframe: boolean
  size: number
}

export interface StreamState {
  sourceId: string
  rtspUrl: string
  ffmpegProcess: any
  cache: LRUCache<number, KeyframeData>
  status: 'stopped' | 'starting' | 'running' | 'error'
  reconnectAttempts: number
  lastKeyframeAt: number
}

const MAX_RECONNECT_DELAY = 30000
const CACHE_MAX_ENTRIES = 50
const CACHE_TTL = 5000

class StreamProxyService {
  private streams: Map<string, StreamState> = new Map()
  private reconnectTimers: Map<string, NodeJS.Timeout> = new Map()

  async startStream(sourceId: string, rtspUrl: string): Promise<void> {
    if (this.streams.has(sourceId)) {
      const existing = this.streams.get(sourceId)!
      if (existing.status === 'running' || existing.status === 'starting') {
        return
      }
      this.stopStream(sourceId)
    }

    const cache = new LRUCache<number, KeyframeData>({
      max: CACHE_MAX_ENTRIES,
      ttl: CACHE_TTL,
    })

    const state: StreamState = {
      sourceId,
      rtspUrl,
      ffmpegProcess: null,
      cache,
      status: 'starting',
      reconnectAttempts: 0,
      lastKeyframeAt: 0,
    }

    this.streams.set(sourceId, state)
    await this.spawnFFmpeg(sourceId, rtspUrl)
  }

  private async spawnFFmpeg(sourceId: string, rtspUrl: string): Promise<void> {
    const state = this.streams.get(sourceId)
    if (!state) return

    state.status = 'starting'

    try {
      const outputStream = new PassThrough()

      const proc = ffmpeg(rtspUrl)
        .inputOptions([
          '-rtsp_transport', 'tcp',
          '-analyzeduration', '1000000',
          '-probesize', '1000000',
        ])
        .outputOptions([
          '-vf', "select='eq(pict_type\\,I)'",
          '-vsync', 'vfr',
          '-f', 'h264',
          '-vcodec', 'copy',
          '-an',
        ])
        .on('start', () => {
          const s = this.streams.get(sourceId)
          if (s) {
            s.status = 'running'
            s.reconnectAttempts = 0
          }
        })
        .on('stderr', (line: string) => {
        })
        .on('error', (err: Error) => {
          const s = this.streams.get(sourceId)
          if (s) {
            s.status = 'error'
          }
          this.scheduleReconnect(sourceId, rtspUrl)
        })
        .on('end', () => {
          const s = this.streams.get(sourceId)
          if (s && s.status === 'running') {
            s.status = 'error'
            this.scheduleReconnect(sourceId, rtspUrl)
          }
        })

      proc.pipe(outputStream, { end: true })

      outputStream.on('data', (chunk: Buffer) => {
        const s = this.streams.get(sourceId)
        if (!s) return

        const now = Date.now()
        const keyframe: KeyframeData = {
          data: Buffer.from(chunk),
          timestamp: now,
          isKeyframe: true,
          size: chunk.length,
        }

        s.cache.set(now, keyframe)
        s.lastKeyframeAt = now
      })

      outputStream.on('error', () => {
      })

      state.ffmpegProcess = proc
    } catch (err) {
      state.status = 'error'
      this.scheduleReconnect(sourceId, rtspUrl)
    }
  }

  private scheduleReconnect(sourceId: string, rtspUrl: string): void {
    const state = this.streams.get(sourceId)
    if (!state) return

    const existingTimer = this.reconnectTimers.get(sourceId)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    state.reconnectAttempts++
    const delay = Math.min(
      1000 * Math.pow(2, state.reconnectAttempts - 1),
      MAX_RECONNECT_DELAY
    )

    const timer = setTimeout(() => {
      const s = this.streams.get(sourceId)
      if (s) {
        s.cache.clear()
        this.spawnFFmpeg(sourceId, rtspUrl)
      }
    }, delay)

    this.reconnectTimers.set(sourceId, timer)
  }

  stopStream(sourceId: string): void {
    const state = this.streams.get(sourceId)
    if (!state) return

    const timer = this.reconnectTimers.get(sourceId)
    if (timer) {
      clearTimeout(timer)
      this.reconnectTimers.delete(sourceId)
    }

    if (state.ffmpegProcess) {
      try {
        state.ffmpegProcess.kill('SIGTERM')
      } catch (err) {
      }
    }

    state.cache.clear()
    state.status = 'stopped'
    state.ffmpegProcess = null
    this.streams.delete(sourceId)
  }

  getLatestKeyframes(sourceId: string, count: number = 5): KeyframeData[] {
    const state = this.streams.get(sourceId)
    if (!state) return []

    const entries = Array.from(state.cache.entries())
      .sort((a, b) => b[0] - a[0])
      .slice(0, count)
      .map(([, value]) => value)

    return entries.reverse()
  }

  getStreamState(sourceId: string): StreamState | null {
    return this.streams.get(sourceId) || null
  }

  getCachedDuration(sourceId: string): number {
    const state = this.streams.get(sourceId)
    if (!state) return 0

    const entries = Array.from(state.cache.keys()).sort((a, b) => a - b)
    if (entries.length < 2) return 0

    return (entries[entries.length - 1] - entries[0]) / 1000
  }

  stopAll(): void {
    const sourceIds = Array.from(this.streams.keys())
    for (let i = 0; i < sourceIds.length; i++) {
      this.stopStream(sourceIds[i])
    }
  }
}

export const streamProxy = new StreamProxyService()
export default StreamProxyService
