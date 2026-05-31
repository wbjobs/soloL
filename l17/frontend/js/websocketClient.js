class WebSocketClient {
    constructor(url) {
        this.url = url;
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.reconnectDelay = 1000;
        this.isConnected = false;
        this.listeners = {};
    }

    connect() {
        return new Promise((resolve, reject) => {
            try {
                this.ws = new WebSocket(this.url);

                this.ws.onopen = () => {
                    console.log('WebSocket connected to', this.url);
                    this.isConnected = true;
                    this.reconnectAttempts = 0;
                    this.emit('connected');
                    resolve();
                };

                this.ws.onmessage = (event) => {
                    try {
                        const data = JSON.parse(event.data);
                        this.handleMessage(data);
                    } catch (err) {
                        console.error('Error parsing WebSocket message:', err);
                    }
                };

                this.ws.onerror = (err) => {
                    console.error('WebSocket error:', err);
                    this.emit('error', err);
                    if (!this.isConnected) {
                        reject(err);
                    }
                };

                this.ws.onclose = () => {
                    console.log('WebSocket disconnected');
                    this.isConnected = false;
                    this.emit('disconnected');
                    this.attemptReconnect();
                };
            } catch (err) {
                console.error('Error creating WebSocket:', err);
                reject(err);
            }
        });
    }

    handleMessage(data) {
        switch (data.type) {
            case 'welcome':
                console.log('Server welcome:', data);
                this.emit('welcome', data);
                break;
            case 'data':
                if (data.dataType === 'aggregated') {
                    this.emit('aggregatedData', data);
                }
                break;
            case 'stats':
                this.emit('stats', data);
                break;
            case 'pong':
                this.emit('pong', data);
                break;
            case 'status':
                this.emit('status', data);
                break;
            case 'anomaly':
                this.emit('anomaly', data);
                break;
            default:
                console.log('Unknown message type:', data.type);
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('Max reconnect attempts reached');
            this.emit('reconnectFailed');
            return;
        }

        this.reconnectAttempts++;
        const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
        
        console.log(`Attempting reconnect ${this.reconnectAttempts}/${this.maxReconnectAttempts} in ${delay}ms`);
        
        setTimeout(() => {
            this.emit('reconnecting', { attempt: this.reconnectAttempts, delay });
            this.connect().catch(() => {});
        }, delay);
    }

    send(message) {
        if (this.isConnected && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            return true;
        }
        return false;
    }

    ping() {
        return this.send({ type: 'ping', timestamp: Date.now() });
    }

    on(event, callback) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(callback);
    }

    off(event, callback) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
        }
    }

    emit(event, data) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(callback => {
                try {
                    callback(data);
                } catch (err) {
                    console.error(`Error in ${event} listener:`, err);
                }
            });
        }
    }

    disconnect() {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
        this.isConnected = false;
    }
}
