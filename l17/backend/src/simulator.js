const dgram = require('dgram');
const config = require('./config');

class EyeTrackerSimulator {
  constructor() {
    this.client = dgram.createSocket('udp4');
    this.udpPort = config.udp.port;
    this.udpHost = '127.0.0.1';
    this.sampleRate = 250;
    this.intervalMs = 1000 / this.sampleRate;
    this.running = false;
    this.interval = null;
    this.packetsSent = 0;
    this.startTime = null;
    
    this.screenWidth = config.screen.width;
    this.screenHeight = config.screen.height;
    
    this.currentX = this.screenWidth / 2;
    this.currentY = this.screenHeight / 2;
    this.targetX = this.screenWidth / 2;
    this.targetY = this.screenHeight / 2;
    this.pupilDiameter = 3.5;
    
    this.blinkCount = 0;
    this.saccadeCount = 0;
    this.lastTargetChange = Date.now();
    this.targetChangeInterval = 2000;
    
    this.pattern = 'reading';
    this.readingLine = 0;
    this.readingPos = 0;
  }

  start(durationMs = null) {
    if (this.running) return;
    
    this.running = true;
    this.startTime = Date.now();
    this.packetsSent = 0;
    
    console.log(`Eye Tracker Simulator started`);
    console.log(`Target: ${this.udpHost}:${this.udpPort}`);
    console.log(`Sample rate: ${this.sampleRate} Hz (${this.intervalMs.toFixed(1)}ms interval)`);
    console.log(`Screen: ${this.screenWidth}x${this.screenHeight}`);
    console.log(`Pattern: ${this.pattern}`);
    console.log('-'.repeat(50));

    this.interval = setInterval(() => {
      this.sendSample();
    }, this.intervalMs);

    if (durationMs) {
      setTimeout(() => {
        this.stop();
      }, durationMs);
    }

    setInterval(() => {
      if (this.running) {
        const elapsed = (Date.now() - this.startTime) / 1000;
        const rate = elapsed > 0 ? Math.round(this.packetsSent / elapsed) : 0;
        console.log(`Sent ${this.packetsSent} packets (${rate}/s), blinks: ${this.blinkCount}, saccades: ${this.saccadeCount}`);
      }
    }, 1000);
  }

  stop() {
    if (!this.running) return;
    
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    
    const elapsed = ((Date.now() - this.startTime) / 1000).toFixed(2);
    console.log('-'.repeat(50));
    console.log(`Eye Tracker Simulator stopped`);
    console.log(`Total packets: ${this.packetsSent}`);
    console.log(`Duration: ${elapsed}s`);
    console.log(`Average rate: ${Math.round(this.packetsSent / parseFloat(elapsed))} packets/s`);
    console.log(`Blinks: ${this.blinkCount}`);
    console.log(`Saccades: ${this.saccadeCount}`);
    
    this.client.close();
  }

  sendSample() {
    const now = Date.now();
    const data = this.generateSample(now);
    
    if (data === null) return;

    const message = JSON.stringify(data);
    const buffer = Buffer.from(message);

    this.client.send(buffer, 0, buffer.length, this.udpPort, this.udpHost, (err) => {
      if (err) {
        console.error('Error sending UDP packet:', err.message);
      }
    });

    this.packetsSent++;
  }

  generateSample(timestamp) {
    if (Math.random() < 0.002) {
      this.blinkCount++;
      return {
        x: -1,
        y: -1,
        pupilDiameter: 0,
        timestamp
      };
    }

    if (timestamp - this.lastTargetChange > this.targetChangeInterval) {
      this.changeTarget();
      this.lastTargetChange = timestamp;
    }

    const dx = this.targetX - this.currentX;
    const dy = this.targetY - this.currentY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance > 50) {
      this.saccadeCount++;
      const saccadeSpeed = Math.min(distance * 0.3, 100);
      const ratio = saccadeSpeed / distance;
      this.currentX += dx * ratio;
      this.currentY += dy * ratio;
    } else {
      const noiseX = (Math.random() - 0.5) * 10;
      const noiseY = (Math.random() - 0.5) * 10;
      this.currentX = this.targetX + noiseX;
      this.currentY = this.targetY + noiseY;
    }

    this.currentX = Math.max(0, Math.min(this.screenWidth, this.currentX));
    this.currentY = Math.max(0, Math.min(this.screenHeight, this.currentY));

    this.pupilDiameter += (Math.random() - 0.5) * 0.2;
    this.pupilDiameter = Math.max(2, Math.min(6, this.pupilDiameter));

    return {
      x: Math.round(this.currentX * 100) / 100,
      y: Math.round(this.currentY * 100) / 100,
      pupilDiameter: Math.round(this.pupilDiameter * 1000) / 1000,
      timestamp
    };
  }

  changeTarget() {
    switch (this.pattern) {
      case 'random':
        this.targetX = Math.random() * this.screenWidth;
        this.targetY = Math.random() * this.screenHeight;
        break;
      
      case 'reading':
        const lineHeight = this.screenHeight / 10;
        const charsPerLine = 20;
        const charWidth = this.screenWidth / charsPerLine;
        
        this.targetX = 100 + this.readingPos * charWidth;
        this.targetY = 100 + this.readingLine * lineHeight;
        
        this.readingPos++;
        if (this.readingPos >= charsPerLine) {
          this.readingPos = 0;
          this.readingLine++;
          if (this.readingLine >= 8) {
            this.readingLine = 0;
          }
        }
        break;
      
      case 'horizontal':
        const t = (Date.now() % 5000) / 5000;
        this.targetX = 100 + t * (this.screenWidth - 200);
        this.targetY = this.screenHeight / 2;
        break;
      
      case 'circular':
        const angle = (Date.now() / 1000) * Math.PI;
        const radius = Math.min(this.screenWidth, this.screenHeight) * 0.3;
        this.targetX = this.screenWidth / 2 + Math.cos(angle) * radius;
        this.targetY = this.screenHeight / 2 + Math.sin(angle) * radius;
        break;
      
      default:
        this.targetX = Math.random() * this.screenWidth;
        this.targetY = Math.random() * this.screenHeight;
    }
  }

  setPattern(pattern) {
    this.pattern = pattern;
    this.readingLine = 0;
    this.readingPos = 0;
    console.log(`Pattern changed to: ${pattern}`);
  }
}

const simulator = new EyeTrackerSimulator();

const args = process.argv.slice(2);
let duration = null;
let pattern = 'reading';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--duration' && args[i + 1]) {
    duration = parseInt(args[i + 1]) * 1000;
    i++;
  } else if (args[i] === '--pattern' && args[i + 1]) {
    pattern = args[i + 1];
    i++;
  } else if (args[i] === '--rate' && args[i + 1]) {
    simulator.sampleRate = parseInt(args[i + 1]);
    simulator.intervalMs = 1000 / simulator.sampleRate;
    i++;
  }
}

simulator.setPattern(pattern);

process.on('SIGINT', () => {
  console.log('\nReceived SIGINT');
  simulator.stop();
  process.exit(0);
});

simulator.start(duration);

module.exports = EyeTrackerSimulator;
