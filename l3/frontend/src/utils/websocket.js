class WebSocketClient {
  constructor() {
    this.ws = null
    this.taskId = null
    this.listeners = new Map()
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = 5
    this.reconnectInterval = 3000
  }

  connect(taskId) {
    this.taskId = taskId
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const wsUrl = `${protocol}//${window.location.host}/api/ws/${taskId}`

    try {
      this.ws = new WebSocket(wsUrl)

      this.ws.onopen = () => {
        console.log(`WebSocket 连接成功: ${taskId}`)
        this.reconnectAttempts = 0
        this.emit('connected', { taskId })
      }

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data)
          this.emit(message.type, message.data)
        } catch (error) {
          console.error('解析WebSocket消息失败:', error)
        }
      }

      this.ws.onclose = (event) => {
        console.log(`WebSocket 连接关闭: ${taskId}`, event.code, event.reason)
        this.emit('disconnected', { taskId, code: event.code, reason: event.reason })

        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++
          console.log(`尝试重连 (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`)
          setTimeout(() => this.connect(taskId), this.reconnectInterval)
        }
      }

      this.ws.onerror = (error) => {
        console.error('WebSocket 错误:', error)
        this.emit('error', error)
      }
    } catch (error) {
      console.error('创建WebSocket连接失败:', error)
      this.emit('error', error)
    }
  }

  disconnect() {
    if (this.ws) {
      this.ws.close(1000, '用户主动断开')
      this.ws = null
    }
    this.taskId = null
    this.reconnectAttempts = 0
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, [])
    }
    this.listeners.get(event).push(callback)
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event)
      const index = callbacks.indexOf(callback)
      if (index > -1) {
        callbacks.splice(index, 1)
      }
    }
  }

  emit(event, data) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach((callback) => {
        try {
          callback(data)
        } catch (error) {
          console.error(`执行 ${event} 监听器出错:`, error)
        }
      })
    }
  }

  send(type, data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }))
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN
  }
}

export default new WebSocketClient()
