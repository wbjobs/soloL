const EventEmitter = require('events');
const config = require('./config');

class DataAggregator extends EventEmitter {
  constructor() {
    super();
    this.aggregationRate = config.processing.aggregationRate;
    this.aggregationIntervalMs = config.processing.aggregationIntervalMs;
    this.buffer = [];
    this.interval = null;
    this.running = false;
  }

  start() {
    if (this.running) return;
    
    this.running = true;
    this.interval = setInterval(() => {
      this.aggregateAndEmit();
    }, this.aggregationIntervalMs);
    
    console.log(`Data aggregator started: aggregating every ${this.aggregationIntervalMs}ms (rate: ${this.aggregationRate}:1)`);
  }

  stop() {
    this.running = false;
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.buffer = [];
    console.log('Data aggregator stopped');
  }

  addDataPoint(dataPoint) {
    if (!this.running) return;
    this.buffer.push(dataPoint);
  }

  addBatch(dataPoints) {
    if (!this.running) return;
    this.buffer.push(...dataPoints);
  }

  aggregateAndEmit() {
    if (this.buffer.length === 0) return;

    const pointsToAggregate = this.buffer.slice(0, this.aggregationRate);
    this.buffer = this.buffer.slice(this.aggregationRate);

    if (pointsToAggregate.length === 0) return;

    const aggregated = this.aggregatePoints(pointsToAggregate);
    
    this.emit('aggregated', {
      aggregated,
      raw: pointsToAggregate,
      timestamp: Date.now(),
      count: pointsToAggregate.length
    });
  }

  aggregatePoints(points) {
    const count = points.length;
    
    const sumX = points.reduce((sum, p) => sum + p.x, 0);
    const sumY = points.reduce((sum, p) => sum + p.y, 0);
    const sumPupil = points.reduce((sum, p) => sum + p.pupilDiameter, 0);
    
    const avgX = sumX / count;
    const avgY = sumY / count;
    const avgPupil = sumPupil / count;
    
    const varianceX = points.reduce((sum, p) => sum + Math.pow(p.x - avgX, 2), 0) / count;
    const varianceY = points.reduce((sum, p) => sum + Math.pow(p.y - avgY, 2), 0) / count;
    
    const firstTimestamp = points[0].timestamp;
    const lastTimestamp = points[count - 1].timestamp;

    return {
      x: Math.round(avgX * 100) / 100,
      y: Math.round(avgY * 100) / 100,
      pupilDiameter: Math.round(avgPupil * 1000) / 1000,
      timestamp: lastTimestamp,
      startTime: firstTimestamp,
      endTime: lastTimestamp,
      count,
      stdDevX: Math.round(Math.sqrt(varianceX) * 100) / 100,
      stdDevY: Math.round(Math.sqrt(varianceY) * 100) / 100,
      minX: Math.min(...points.map(p => p.x)),
      maxX: Math.max(...points.map(p => p.x)),
      minY: Math.min(...points.map(p => p.y)),
      maxY: Math.max(...points.map(p => p.y)),
      minPupil: Math.min(...points.map(p => p.pupilDiameter)),
      maxPupil: Math.max(...points.map(p => p.pupilDiameter))
    };
  }

  getBufferSize() {
    return this.buffer.length;
  }
}

module.exports = DataAggregator;
