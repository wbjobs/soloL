const dgram = require('dgram');
const EventEmitter = require('events');
const config = require('./config');

class UDPServer extends EventEmitter {
  constructor() {
    super();
    this.port = config.udp.port;
    this.host = config.udp.host;
    this.server = dgram.createSocket('udp4');
    this.packetsReceived = 0;
    this.lastLogTime = Date.now();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server.on('error', (err) => {
        console.error(`UDP Server error: ${err.message}`);
        reject(err);
      });

      this.server.on('message', (msg, rinfo) => {
        try {
          const dataPoint = this.parseMessage(msg);
          this.packetsReceived++;
          
          const now = Date.now();
          if (now - this.lastLogTime >= 1000) {
            console.log(`UDP: ${this.packetsReceived} packets/sec from ${rinfo.address}:${rinfo.port}`);
            this.packetsReceived = 0;
            this.lastLogTime = now;
          }

          if (dataPoint) {
            this.emit('data', dataPoint);
          }
        } catch (err) {
          console.error('Error parsing UDP message:', err.message);
        }
      });

      this.server.on('listening', () => {
        const address = this.server.address();
        console.log(`UDP Server listening on ${address.address}:${address.port}`);
        resolve();
      });

      this.server.bind(this.port, this.host);
    });
  }

  parseMessage(msg) {
    let data;
    
    if (Buffer.isBuffer(msg)) {
      const str = msg.toString('utf8').trim();
      try {
        data = JSON.parse(str);
      } catch (e) {
        data = this.parseDelimited(str);
      }
    } else {
      data = msg;
    }

    if (Array.isArray(data)) {
      return {
        x: data[0],
        y: data[1],
        pupilDiameter: data[2],
        timestamp: data[3] || Date.now()
      };
    }

    return {
      x: data.x,
      y: data.y,
      pupilDiameter: data.pupilDiameter,
      timestamp: data.timestamp || Date.now()
    };
  }

  parseDelimited(str) {
    const parts = str.split(/[,;\t\s]+/).map(p => parseFloat(p.trim()));
    if (parts.length >= 3 && parts.every(p => !isNaN(p))) {
      return {
        x: parts[0],
        y: parts[1],
        pupilDiameter: parts[2],
        timestamp: parts[3] || Date.now()
      };
    }
    throw new Error('Invalid message format');
  }

  stop() {
    return new Promise((resolve) => {
      this.server.close(() => {
        console.log('UDP Server stopped');
        resolve();
      });
    });
  }
}

module.exports = UDPServer;
