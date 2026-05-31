const EventEmitter = require('events');

class PacketReorderer extends EventEmitter {
  constructor(options = {}) {
    super();
    this.windowSizeMs = options.windowSizeMs || 200;
    this.maxWindowSize = options.maxWindowSize || 100;
    this.timeoutDiscardMs = options.timeoutDiscardMs || 500;
    
    this.buffer = [];
    this.lastEmittedTimestamp = 0;
    this.totalReceived = 0;
    this.totalEmitted = 0;
    this.totalDiscarded = 0;
    this.totalOutOfOrder = 0;
    
    this.flushInterval = null;
    this.isRunning = false;
  }

  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.flushInterval = setInterval(() => {
      this.flushReadyPackets();
    }, Math.floor(this.windowSizeMs / 2));
    
    console.log(`Packet reorderer started: window=${this.windowSizeMs}ms, max=${this.maxWindowSize} packets`);
  }

  stop() {
    this.isRunning = false;
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    this.flushAll();
    console.log(`Packet reorderer stopped: received=${this.totalReceived}, emitted=${this.totalEmitted}, discarded=${this.totalDiscarded}, outOfOrder=${this.totalOutOfOrder}`);
  }

  addPacket(dataPoint) {
    if (!this.isRunning || !dataPoint || !dataPoint.timestamp) {
      this.emit('data', dataPoint);
      return;
    }

    this.totalReceived++;
    
    if (dataPoint.timestamp < this.lastEmittedTimestamp) {
      this.totalOutOfOrder++;
    }
    
    const now = Date.now();
    
    if (now - dataPoint.timestamp > this.timeoutDiscardMs) {
      this.totalDiscarded++;
      this.emit('discarded', { 
        reason: 'timeout',
        packet: dataPoint,
        age: now - dataPoint.timestamp
      });
      return;
    }
    
    const insertIndex = this.findInsertIndex(dataPoint.timestamp);
    this.buffer.splice(insertIndex, 0, {
      data: dataPoint,
      receivedAt: now,
      timestamp: dataPoint.timestamp
    });
    
    if (this.buffer.length > this.maxWindowSize * 2) {
      const overflow = this.buffer.length - this.maxWindowSize;
      const discarded = this.buffer.splice(0, overflow);
      this.totalDiscarded += discarded.length;
      discarded.forEach(p => {
        this.emit('discarded', {
          reason: 'buffer_overflow',
          packet: p.data,
          age: now - p.timestamp
        });
      });
    }
    
    this.flushReadyPackets();
  }

  addBatch(dataPoints) {
    dataPoints.forEach(p => this.addPacket(p));
  }

  findInsertIndex(timestamp) {
    let low = 0;
    let high = this.buffer.length;
    
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (this.buffer[mid].timestamp < timestamp) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    
    return low;
  }

  flushReadyPackets() {
    if (this.buffer.length === 0) return;
    
    const now = Date.now();
    const readyThreshold = now - this.windowSizeMs;
    
    let emitCount = 0;
    
    while (this.buffer.length > 0) {
      const packet = this.buffer[0];
      
      const isOldEnough = packet.receivedAt <= readyThreshold;
      const isForced = this.buffer.length >= this.maxWindowSize;
      const isExpired = now - packet.timestamp > this.timeoutDiscardMs;
      
      if (isExpired) {
        this.buffer.shift();
        this.totalDiscarded++;
        this.emit('discarded', {
          reason: 'expired_in_buffer',
          packet: packet.data,
          age: now - packet.timestamp
        });
        continue;
      }
      
      if (isOldEnough || isForced) {
        if (packet.timestamp < this.lastEmittedTimestamp) {
          this.totalOutOfOrder++;
        }
        
        this.lastEmittedTimestamp = packet.timestamp;
        this.emit('data', packet.data);
        this.buffer.shift();
        this.totalEmitted++;
        emitCount++;
      } else {
        break;
      }
    }
  }

  flushAll() {
    const now = Date.now();
    
    while (this.buffer.length > 0) {
      const packet = this.buffer.shift();
      
      if (now - packet.timestamp > this.timeoutDiscardMs) {
        this.totalDiscarded++;
        continue;
      }
      
      if (packet.timestamp < this.lastEmittedTimestamp) {
        this.totalOutOfOrder++;
      }
      
      this.lastEmittedTimestamp = packet.timestamp;
      this.emit('data', packet.data);
      this.totalEmitted++;
    }
  }

  getStats() {
    return {
      bufferSize: this.buffer.length,
      totalReceived: this.totalReceived,
      totalEmitted: this.totalEmitted,
      totalDiscarded: this.totalDiscarded,
      totalOutOfOrder: this.totalOutOfOrder,
      lastEmittedTimestamp: this.lastEmittedTimestamp,
      windowSizeMs: this.windowSizeMs,
      isRunning: this.isRunning
    };
  }

  getBufferTimestamps() {
    return this.buffer.map(p => ({
      timestamp: p.timestamp,
      receivedAt: p.receivedAt,
      age: Date.now() - p.receivedAt
    }));
  }
}

module.exports = PacketReorderer;
