class WebSocketService {
  constructor() {
    this.ws = null
    this.midiId = null
    this.userId = null
    this.username = null
    this.listeners = {}
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectDelay = 1000
    this.annotationVersion = 0
    this.pendingDeltas = []
    this.lastSyncTime = 0
  }

  connect(midiId, userId, username, clientVersion = 0) {
    this.midiId = midiId
    this.userId = userId
    this.username = username
    this.annotationVersion = clientVersion

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/ws/${midiId}?user_id=${encodeURIComponent(userId)}&username=${encodeURIComponent(username)}&client_version=${clientVersion}`

    this.ws = new WebSocket(wsUrl)

    this.ws.onopen = () => {
      console.log('WebSocket connected, version:', this.annotationVersion)
      this.reconnectAttempts = 0
      this.emit('connected')
      this.sendSyncRequest()
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        
        if (data.version && data.version > this.annotationVersion) {
          this.annotationVersion = data.version
        }

        if (data.type === 'annotation_delta') {
          this.handleAnnotationDelta(data.data)
        } else if (data.type === 'annotation_sync') {
          this.handleSyncResponse(data.data)
        }
        
        this.emit(data.type, data)
      } catch (e) {
        console.error('Failed to parse WebSocket message:', e)
      }
    }

    this.ws.onclose = (event) => {
      console.log('WebSocket disconnected:', event.code, event.reason)
      this.emit('disconnected', { code: event.code, reason: event.reason })
      
      if (event.code !== 4004 && this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++
        setTimeout(() => {
          this.connect(this.midiId, this.userId, this.username, this.annotationVersion)
        }, this.reconnectDelay * this.reconnectAttempts)
      }
    }

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      this.emit('error', error)
    }
  }

  handleAnnotationDelta(delta) {
    if (!delta || !delta.id) return

    const { id, operation, version, data } = delta

    if (version <= this.annotationVersion && this.pendingDeltas.length === 0) {
      return
    }

    this.pendingDeltas.push({ id, operation, version, data })
    
    this.pendingDeltas.sort((a, b) => a.version - b.version)
    
    const toApply = []
    while (this.pendingDeltas.length > 0) {
      const next = this.pendingDeltas[0]
      if (next.version === this.annotationVersion + 1) {
        toApply.push(this.pendingDeltas.shift())
        this.annotationVersion = next.version
      } else if (next.version <= this.annotationVersion) {
        this.pendingDeltas.shift()
      } else {
        break
      }
    }

    if (toApply.length > 0) {
      this.emit('annotations_updated', { deltas: toApply, version: this.annotationVersion })
    }
  }

  handleSyncResponse(data) {
    const { server_version, deltas } = data
    
    if (server_version > this.annotationVersion) {
      deltas.sort((a, b) => a.version - b.version)
      
      for (const delta of deltas) {
        if (delta.version > this.annotationVersion) {
          this.handleAnnotationDelta(delta)
        }
      }
      
      this.annotationVersion = server_version
    }
    
    this.lastSyncTime = Date.now()
    this.emit('sync_complete', { version: this.annotationVersion })
  }

  sendSyncRequest() {
    if (this.isConnected()) {
      this.send('sync_request', { version: this.annotationVersion })
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.reconnectAttempts = 0
    this.pendingDeltas = []
  }

  send(type, data, clientVersion = null) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type,
        data,
        user_id: this.userId,
        client_version: clientVersion !== null ? clientVersion : this.annotationVersion,
        timestamp: new Date().toISOString()
      }))
    }
  }

  sendCursorUpdate(position, time) {
    this.send('cursor_update', { position, time })
  }

  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = []
    }
    this.listeners[event].push(callback)
  }

  off(event, callback) {
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback)
    }
  }

  emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data))
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN
  }

  getVersion() {
    return this.annotationVersion
  }

  setVersion(version) {
    this.annotationVersion = version
  }
}

export const wsService = new WebSocketService()
export default wsService
