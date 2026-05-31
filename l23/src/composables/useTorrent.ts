import { ref, reactive, onUnmounted } from 'vue'
import type { DownloadProgress, SpeedRecord } from '@/types'
import { generatePeerId } from '@/utils/format'

export function useTorrent() {
  const client = ref<any>(null)
  const downloads = reactive<Map<string, DownloadProgress>>(new Map())
  const speedHistory = reactive<Map<string, SpeedRecord[]>>(new Map())
  const isClientReady = ref(false)

  const initClient = () => {
    if (client.value) return
    if (typeof window.WebTorrent === 'undefined') {
      console.error('WebTorrent not loaded yet')
      return
    }
    const peerId = generatePeerId()
    client.value = new window.WebTorrent({ peerId })
    client.value.on('error', (err: any) => {
      console.error('WebTorrent error:', err)
    })
    isClientReady.value = true
  }

  const downloadTorrent = (magnetUri: string): DownloadProgress => {
    if (!client.value) {
      initClient()
    }
    if (!client.value) {
      throw new Error('WebTorrent client not available')
    }

    const existing = downloads.get(magnetUri)
    if (existing && existing.status !== 'error') {
      return existing
    }

    const info: DownloadProgress = {
      info_hash: magnetUri,
      file_name: 'Loading...',
      progress: 0,
      download_speed: 0,
      upload_speed: 0,
      downloaded: 0,
      uploaded: 0,
      peers: 0,
      status: 'downloading',
      total_size: 0,
      chunks_status: [],
      torrent: null,
    }

    downloads.set(magnetUri, info)
    speedHistory.set(magnetUri, [])

    const torrent = client.value.add(magnetUri, {
      announce: ['http://localhost:8000/tracker/announce'],
    })

    torrent.on('infoHash', () => {
      info.info_hash = torrent.infoHash
    })

    torrent.on('metadata', () => {
      info.file_name = torrent.name
      info.total_size = torrent.length
      const numPieces = torrent.pieces.length
      info.chunks_status = Array(numPieces).fill('pending')
    })

    torrent.on('download', () => {
      updateStats(magnetUri)
    })

    torrent.on('upload', () => {
      updateStats(magnetUri)
    })

    torrent.on('done', () => {
      info.status = 'seeding'
      info.progress = 1
      updateStats(magnetUri)
    })

    torrent.on('wire', (wire: any) => {
      info.peers = torrent.numPeers
    })

    torrent.on('error', (err: any) => {
      info.status = 'error'
      info.error = err.message
    })

    info.torrent = torrent
    return info
  }

  const updateStats = (magnetUri: string) => {
    const info = downloads.get(magnetUri)
    if (!info || !info.torrent) return

    const torrent = info.torrent
    info.progress = torrent.progress
    info.downloaded = torrent.downloaded
    info.uploaded = torrent.uploaded
    info.download_speed = torrent.downloadSpeed
    info.upload_speed = torrent.uploadSpeed
    info.peers = torrent.numPeers

    if (torrent.pieces && torrent.pieces.length > 0) {
      for (let i = 0; i < torrent.pieces.length; i++) {
        if (torrent.bitfield && torrent.bitfield.get(i)) {
          if (info.chunks_status[i] !== 'verified') {
            info.chunks_status[i] = 'verified'
          }
        } else if (info.chunks_status[i] === 'pending') {
          info.chunks_status[i] = 'pending'
        }
      }
    }

    const history = speedHistory.get(magnetUri)
    if (history) {
      history.push({
        timestamp: Date.now(),
        download_speed: info.download_speed,
        upload_speed: info.upload_speed,
        peers_connected: info.peers,
      })
      if (history.length > 60) {
        history.shift()
      }
    }
  }

  const stopDownload = (magnetUri: string) => {
    const info = downloads.get(magnetUri)
    if (info && info.torrent) {
      info.torrent.destroy()
      info.status = 'paused'
    }
  }

  const destroyClient = () => {
    if (client.value) {
      client.value.destroy()
      client.value = null
      isClientReady.value = false
    }
  }

  onUnmounted(() => {
    destroyClient()
  })

  return {
    client,
    downloads,
    speedHistory,
    isClientReady,
    initClient,
    downloadTorrent,
    stopDownload,
    destroyClient,
  }
}
