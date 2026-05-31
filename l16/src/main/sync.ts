import { WebSocketServer, WebSocket } from 'ws'
import { Bonjour } from 'bonjour-service'
import os from 'os'
import crypto from 'crypto'
import { db } from './database'
import { imageStore } from './imageStore'
import type { ClipboardItem, Snippet, PeerInfo, SyncMessage } from '../types'

type SnippetAction = 'create' | 'update' | 'delete'

class SyncService {
  private wss: WebSocketServer | null = null
  private bonjour: any = null
  private service: any = null
  private peers: Map<string, WebSocket> = new Map()
  private deviceId: string = ''
  private deviceName: string = os.hostname()
  private isEnabled: boolean = false
  private onNewItemCallback: ((item: ClipboardItem) => void) | null = null
  private onPeerChangeCallback: (() => void) | null = null
  private onSnippetChangeCallback: (() => void) | null = null

  init() {
    this.deviceId = crypto.createHash('md5')
      .update(os.hostname() + os.platform() + os.arch())
      .digest('hex')
  }

  setOnNewItemCallback(callback: (item: ClipboardItem) => void) {
    this.onNewItemCallback = callback
  }

  setOnPeerChangeCallback(callback: () => void) {
    this.onPeerChangeCallback = callback
  }

  setOnSnippetChangeCallback(callback: () => void) {
    this.onSnippetChangeCallback = callback
  }

  async enable(port: number = 8972): Promise<boolean> {
    if (this.isEnabled) return true

    try {
      this.wss = new WebSocketServer({ port })

      this.wss.on('connection', (ws, req) => {
        const ip = req.socket.remoteAddress || ''
        this.handleConnection(ws, ip)
      })

      this.bonjour = new Bonjour()
      this.service = this.bonjour.publish({
        name: `ClipMaster-${this.deviceName}`,
        type: 'clipmaster',
        port,
        txt: {
          deviceId: this.deviceId,
          deviceName: this.deviceName
        }
      })

      const browser = this.bonjour.find({ type: 'clipmaster' })
      browser.on('up', (service: any) => {
        if (service.txt?.deviceId !== this.deviceId) {
          this.connectToPeer(service)
        }
      })

      this.isEnabled = true
      return true
    } catch (error) {
      console.error('Sync service enable error:', error)
      return false
    }
  }

  disable(): boolean {
    try {
      this.peers.forEach(ws => ws.close())
      this.peers.clear()

      if (this.wss) {
        this.wss.close()
        this.wss = null
      }

      if (this.service) {
        this.service.stop()
        this.service = null
      }

      if (this.bonjour) {
        this.bonjour.destroy()
        this.bonjour = null
      }

      this.isEnabled = false
      return true
    } catch (error) {
      console.error('Sync service disable error:', error)
      return false
    }
  }

  private handleConnection(ws: WebSocket, ip: string) {
    let peerDeviceId: string | null = null

    ws.on('message', (data) => {
      try {
        const message: SyncMessage = JSON.parse(data.toString())

        if (message.type === 'hello') {
          peerDeviceId = message.deviceId
          this.peers.set(message.deviceId, ws)

          const peer: PeerInfo = {
            deviceId: message.deviceId,
            deviceName: message.deviceName,
            ipAddress: ip,
            port: 0,
            isOnline: true
          }
          db.upsertPeer(peer)

          this.sendHello(ws)
          this.onPeerChangeCallback?.()
        } else if (message.type === 'new-item') {
          this.handleSyncItem(message.payload).catch(error => {
            console.error('Handle sync item error:', error)
          })
        } else if (message.type === 'new-snippet' || message.type === 'update-snippet' || message.type === 'delete-snippet') {
          this.handleSyncSnippet(message.type, message.payload).catch(error => {
            console.error('Handle sync snippet error:', error)
          })
        }
      } catch (error) {
        console.error('Sync message parse error:', error)
      }
    })

    ws.on('close', () => {
      if (peerDeviceId) {
        this.peers.delete(peerDeviceId)
        db.updatePeerStatus(peerDeviceId, false)
        this.onPeerChangeCallback?.()
      }
    })

    this.sendHello(ws)
  }

  private sendHello(ws: WebSocket) {
    const message: SyncMessage = {
      type: 'hello',
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      timestamp: Date.now()
    }
    ws.send(JSON.stringify(message))
  }

  private connectToPeer(service: any) {
    const address = service.addresses?.[0] || service.host
    if (!address) return

    const port = service.port
    const wsUrl = `ws://${address}:${port}`

    try {
      const ws = new WebSocket(wsUrl)

      ws.on('open', () => {
        this.handleConnection(ws, address)
      })

      ws.on('error', (error) => {
        console.error('Peer connection error:', error)
      })
    } catch (error) {
      console.error('Connect to peer error:', error)
    }
  }

  async broadcastItem(item: ClipboardItem) {
    if (!this.isEnabled || this.peers.size === 0) return

    let itemToSend: any = { ...item }

    if (item.type === 'image' && item.imagePath) {
      const imageBuffer = imageStore.getImageBuffer(item.imagePath)
      if (imageBuffer) {
        itemToSend.imageData = imageBuffer.toString('base64')
      }
      delete itemToSend.imagePath
    }

    const message: SyncMessage = {
      type: 'new-item',
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      payload: itemToSend,
      timestamp: Date.now()
    }

    const data = JSON.stringify(message)
    this.peers.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })
  }

  private async handleSyncItem(item: any) {
    if (!item.type) return

    let imagePath: string | undefined

    if (item.type === 'image' && item.imageData) {
      const imageBuffer = Buffer.from(item.imageData, 'base64')
      const result = await imageStore.saveImage(imageBuffer)
      imagePath = result.filePath
    }

    const id = db.insertClipboardItem({
      type: item.type,
      content: item.content,
      imagePath: imagePath,
      ocrText: item.ocrText,
      isFavorite: false
    })

    const savedItem = db.getClipboardById(id)
    if (savedItem) {
      this.onNewItemCallback?.(savedItem)
    }
  }

  broadcastSnippet(action: SnippetAction, snippet: Snippet | { id: string }) {
    if (!this.isEnabled || this.peers.size === 0) return

    const messageType = action === 'create' ? 'new-snippet' :
                       action === 'update' ? 'update-snippet' : 'delete-snippet'

    const message: SyncMessage = {
      type: messageType,
      deviceId: this.deviceId,
      deviceName: this.deviceName,
      payload: snippet,
      timestamp: Date.now()
    }

    const data = JSON.stringify(message)
    this.peers.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      }
    })
  }

  private async handleSyncSnippet(messageType: string, payload: any) {
    const snippetId = payload.id

    if (messageType === 'delete-snippet') {
      db.deleteSnippet(snippetId)
      this.onSnippetChangeCallback?.()
      return
    }

    const existingSnippet = db.getSnippetById(snippetId)

    if (messageType === 'new-snippet') {
      if (!existingSnippet) {
        db.insertSnippet(payload, payload.lastModifiedBy)
        this.onSnippetChangeCallback?.()
      }
      return
    }

    if (messageType === 'update-snippet') {
      if (!existingSnippet || payload.version >= existingSnippet.version) {
        db.updateSnippet(payload, payload.lastModifiedBy)
        this.onSnippetChangeCallback?.()
      }
      return
    }
  }

  getPeers(): PeerInfo[] {
    return db.getPeers().map(peer => ({
      ...peer,
      isOnline: this.peers.has(peer.deviceId)
    }))
  }

  isSyncEnabled(): boolean {
    return this.isEnabled
  }

  getDeviceId(): string {
    return this.deviceId
  }
}

export const syncService = new SyncService()
