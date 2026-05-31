import { ref, onUnmounted } from 'vue'
import { fetchStats } from '@/utils/api'
import type { SpeedRecord } from '@/types'

export function useStats() {
  const speedRecords = ref<SpeedRecord[]>([])
  const historyRecords = ref<SpeedRecord[]>([])
  let pollInterval: ReturnType<typeof setInterval> | null = null

  const startPolling = (fileId: string, intervalMs = 2000) => {
    stopPolling()
    pollInterval = setInterval(async () => {
      try {
        const stats = await fetchStats(fileId)
        const record: SpeedRecord = {
          timestamp: Date.now(),
          download_speed: stats.download_speed || 0,
          upload_speed: stats.upload_speed || 0,
          peers_connected: stats.peers_connected || 0,
        }
        speedRecords.value.push(record)
        if (speedRecords.value.length > 60) {
          speedRecords.value.shift()
        }
        historyRecords.value.push(record)
      } catch (err) {
        console.error('Poll stats error:', err)
      }
    }, intervalMs)
  }

  const stopPolling = () => {
    if (pollInterval) {
      clearInterval(pollInterval)
      pollInterval = null
    }
  }

  const clearRecords = () => {
    stopPolling()
    speedRecords.value = []
  }

  const addWebTorrentRecord = (
    downloadSpeed: number,
    uploadSpeed: number,
    peers: number
  ) => {
    const record: SpeedRecord = {
      timestamp: Date.now(),
      download_speed: downloadSpeed,
      upload_speed: uploadSpeed,
      peers_connected: peers,
    }
    speedRecords.value.push(record)
    if (speedRecords.value.length > 60) {
      speedRecords.value.shift()
    }
    historyRecords.value.push(record)
  }

  const getSummary = () => {
    if (speedRecords.value.length === 0) {
      return {
        total_download: 0,
        total_upload: 0,
        avg_download_speed: 0,
        avg_upload_speed: 0,
        peak_download_speed: 0,
        peak_upload_speed: 0,
      }
    }

    const downloadSpeeds = speedRecords.value.map(r => r.download_speed)
    const uploadSpeeds = speedRecords.value.map(r => r.upload_speed)

    const avgDownload = downloadSpeeds.reduce((a, b) => a + b, 0) / downloadSpeeds.length
    const avgUpload = uploadSpeeds.reduce((a, b) => a + b, 0) / uploadSpeeds.length
    const peakDownload = Math.max(...downloadSpeeds)
    const peakUpload = Math.max(...uploadSpeeds)

    const durationMs = speedRecords.value.length > 1
      ? speedRecords.value[speedRecords.value.length - 1].timestamp - speedRecords.value[0].timestamp
      : 0
    const durationSec = durationMs / 1000

    return {
      total_download: avgDownload * durationSec,
      total_upload: avgUpload * durationSec,
      avg_download_speed: avgDownload,
      avg_upload_speed: avgUpload,
      peak_download_speed: peakDownload,
      peak_upload_speed: peakUpload,
    }
  }

  onUnmounted(() => {
    stopPolling()
  })

  return {
    speedRecords,
    historyRecords,
    startPolling,
    stopPolling,
    clearRecords,
    addWebTorrentRecord,
    getSummary,
  }
}
