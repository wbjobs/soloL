const WebSocket = require('ws');
const EventEmitter = require('events');
const config = require('./config');

class WebSocketServer extends EventEmitter {
  constructor() {
    super();
    this.port = config.websocket.port;
    this.server = null;
    this.clients = new Set();
    this.clientStats = {
      messagesSent: 0,
      bytesSent: 0,
      startTime: null
    };
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = new WebSocket.Server({ port: this.port });
      this.clientStats.startTime = Date.now();

      this.server.on('listening', () => {
        console.log(`WebSocket Server listening on port ${this.port}`);
        resolve();
      });

      this.server.on('error', (err) => {
        console.error(`WebSocket Server error: ${err.message}`);
        reject(err);
      });

      this.server.on('connection', (ws, req) => {
        const clientId = this.generateClientId(req);
        console.log(`WebSocket client connected: ${clientId}`);
        
        this.clients.add(ws);
        
        ws.send(JSON.stringify({
          type: 'welcome',
          clientId,
          timestamp: Date.now(),
          serverStatus: this.getStatus()
        }));

        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleClientMessage(ws, message, clientId);
          } catch (err) {
            console.error('Error parsing WebSocket message:', err.message);
          }
        });

        ws.on('close', () => {
          console.log(`WebSocket client disconnected: ${clientId}`);
          this.clients.delete(ws);
        });

        ws.on('error', (err) => {
          console.error(`WebSocket client error (${clientId}):`, err.message);
          this.clients.delete(ws);
        });
      });
    });
  }

  generateClientId(req) {
    const ip = req.socket.remoteAddress || 'unknown';
    return `${ip}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  handleClientMessage(ws, message, clientId) {
    switch (message.type) {
      case 'ping':
        ws.send(JSON.stringify({
          type: 'pong',
          timestamp: Date.now(),
          clientTimestamp: message.timestamp
        }));
        break;
      case 'status':
        ws.send(JSON.stringify({
          type: 'status',
          timestamp: Date.now(),
          serverStatus: this.getStatus()
        }));
        break;
      case 'subscribe':
        console.log(`Client ${clientId} subscribed to: ${message.channels || 'all'}`);
        break;
      default:
        console.log(`Received unknown message type from ${clientId}:`, message.type);
    }
  }

  broadcast(data) {
    const message = JSON.stringify(data);
    const messageBytes = Buffer.byteLength(message, 'utf8');
    
    let sentCount = 0;
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message, (err) => {
          if (err) {
            console.error('Error sending WebSocket message:', err.message);
          }
        });
        sentCount++;
      }
    });

    this.clientStats.messagesSent++;
    this.clientStats.bytesSent += messageBytes;

    return sentCount;
  }

  sendAggregatedData(aggregatedData) {
    return this.broadcast({
      type: 'data',
      dataType: 'aggregated',
      ...aggregatedData
    });
  }

  sendAnomalyAlert(anomalyData) {
    return this.broadcast({
      type: 'anomaly',
      ...anomalyData,
      timestamp: anomalyData.timestamp || Date.now()
    });
  }

  sendStats(stats) {
    return this.broadcast({
      type: 'stats',
      ...stats,
      timestamp: Date.now()
    });
  }

  getStatus() {
    return {
      connectedClients: this.clients.size,
      uptimeMs: Date.now() - this.clientStats.startTime,
      messagesSent: this.clientStats.messagesSent,
      bytesSent: this.clientStats.bytesSent
    };
  }

  stop() {
    return new Promise((resolve) => {
      if (this.server) {
        this.clients.forEach((client) => {
          client.close(1000, 'Server shutting down');
        });
        this.server.close(() => {
          console.log('WebSocket Server stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = WebSocketServer;
