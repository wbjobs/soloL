const EventEmitter = require('events');

class AnomalyDetector extends EventEmitter {
  constructor(options = {}) {
    super();
    this.sigmaThreshold = options.sigmaThreshold || 3;
    this.windowSize = options.windowSize || 300;
    this.cooldownMs = options.cooldownMs || 10000;
    this.minSamplesForDetection = options.minSamplesForDetection || 30;
    
    this.pupilBuffer = [];
    this.mean = 0;
    this.stdDev = 0;
    this.lastAnomalyTime = 0;
    this.anomalyCount = 0;
    this.totalProcessed = 0;
    this.isRunning = false;
  }

  start() {
    this.isRunning = true;
    this.pupilBuffer = [];
    this.mean = 0;
    this.stdDev = 0;
    this.anomalyCount = 0;
    this.totalProcessed = 0;
    this.lastAnomalyTime = 0;
    console.log(`Anomaly detector started: sigma=${this.sigmaThreshold}, window=${this.windowSize}, cooldown=${this.cooldownMs}ms`);
  }

  stop() {
    this.isRunning = false;
    console.log(`Anomaly detector stopped: processed=${this.totalProcessed}, anomalies=${this.anomalyCount}`);
  }

  processDataPoint(dataPoint) {
    if (!this.isRunning || !dataPoint || dataPoint.pupilDiameter == null) {
      return null;
    }

    this.totalProcessed++;
    const pupil = dataPoint.pupilDiameter;

    this.pupilBuffer.push(pupil);
    if (this.pupilBuffer.length > this.windowSize) {
      this.pupilBuffer.shift();
    }

    if (this.pupilBuffer.length < this.minSamplesForDetection) {
      this.updateStats();
      return null;
    }

    const prevMean = this.mean;
    const prevStdDev = this.stdDev;
    this.updateStats();

    if (prevStdDev <= 0) {
      return null;
    }

    const zScore = Math.abs(pupil - prevMean) / prevStdDev;

    if (zScore > this.sigmaThreshold) {
      const now = Date.now();
      if (now - this.lastAnomalyTime < this.cooldownMs) {
        return {
          type: 'suppressed',
          pupilDiameter: pupil,
          zScore,
          mean: prevMean,
          stdDev: prevStdDev,
          timestamp: dataPoint.timestamp
        };
      }

      this.lastAnomalyTime = now;
      this.anomalyCount++;

      const direction = pupil > prevMean ? 'dilation' : 'constriction';
      const severity = this.calculateSeverity(zScore);

      const anomaly = {
        type: 'anomaly',
        alertType: direction === 'dilation' ? 'possible_fatigue' : 'pupil_constriction',
        message: direction === 'dilation' ? '可能疲劳' : '瞳孔异常收缩',
        pupilDiameter: pupil,
        mean: prevMean,
        stdDev: prevStdDev,
        zScore,
        direction,
        severity,
        timestamp: dataPoint.timestamp || now,
        dataPoint
      };

      this.emit('anomaly', anomaly);
      return anomaly;
    }

    return null;
  }

  updateStats() {
    const n = this.pupilBuffer.length;
    if (n === 0) {
      this.mean = 0;
      this.stdDev = 0;
      return;
    }

    let sum = 0;
    for (let i = 0; i < n; i++) {
      sum += this.pupilBuffer[i];
    }
    this.mean = sum / n;

    let sumSqDiff = 0;
    for (let i = 0; i < n; i++) {
      const diff = this.pupilBuffer[i] - this.mean;
      sumSqDiff += diff * diff;
    }
    this.stdDev = Math.sqrt(sumSqDiff / n);
  }

  calculateSeverity(zScore) {
    if (zScore > 5) return 'critical';
    if (zScore > 4) return 'high';
    if (zScore > 3) return 'medium';
    return 'low';
  }

  batchDetect(dataPoints) {
    const anomalies = [];
    const detector = new AnomalyDetector({
      sigmaThreshold: this.sigmaThreshold,
      windowSize: this.windowSize,
      cooldownMs: 0,
      minSamplesForDetection: this.minSamplesForDetection
    });
    detector.start();

    for (const point of dataPoints) {
      const result = detector.processDataPoint(point);
      if (result && result.type === 'anomaly') {
        anomalies.push(result);
      }
    }

    detector.stop();
    return anomalies;
  }

  getStats() {
    return {
      isRunning: this.isRunning,
      totalProcessed: this.totalProcessed,
      anomalyCount: this.anomalyCount,
      currentMean: Math.round(this.mean * 1000) / 1000,
      currentStdDev: Math.round(this.stdDev * 1000) / 1000,
      bufferSize: this.pupilBuffer.length,
      sigmaThreshold: this.sigmaThreshold,
      windowSize: this.windowSize,
      anomalyRate: this.totalProcessed > 0
        ? Math.round((this.anomalyCount / this.totalProcessed) * 10000) / 100
        : 0
    };
  }

  reset() {
    this.pupilBuffer = [];
    this.mean = 0;
    this.stdDev = 0;
    this.lastAnomalyTime = 0;
    this.anomalyCount = 0;
    this.totalProcessed = 0;
  }
}

module.exports = AnomalyDetector;
