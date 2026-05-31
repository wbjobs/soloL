export const MIN_CHUNK_SIZE = 256 * 1024;
export const MAX_CHUNK_SIZE = 4 * 1024 * 1024;
export const DEFAULT_CHUNK_SIZE = 1024 * 1024;

export interface BandwidthSample {
  timestamp: number;
  bytesPerSecond: number;
  rtt: number;
}

export interface ChunkSizeRecommendation {
  chunkSize: number;
  reason: string;
  bandwidth: number;
  confidence: number;
}

export class BandwidthEstimator {
  private samples: BandwidthSample[] = [];
  private maxSamples: number = 20;
  private lastChunkSentAt: number = 0;
  private lastChunkSize: number = 0;
  private currentRtt: number = 100;

  addSample(bytesPerSecond: number, rtt: number = 100): void {
    this.samples.push({
      timestamp: Date.now(),
      bytesPerSecond,
      rtt,
    });

    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    this.currentRtt = rtt;
  }

  recordChunkStart(): void {
    this.lastChunkSentAt = Date.now();
  }

  recordChunkEnd(chunkSize: number): number {
    const now = Date.now();
    const duration = (now - this.lastChunkSentAt) / 1000;
    if (duration > 0) {
      const bytesPerSecond = chunkSize / duration;
      this.lastChunkSize = chunkSize;
      this.addSample(bytesPerSecond, this.currentRtt);
      return bytesPerSecond;
    }
    return 0;
  }

  getAverageBandwidth(): number {
    if (this.samples.length === 0) return 0;
    const sum = this.samples.reduce((acc, s) => acc + s.bytesPerSecond, 0);
    return sum / this.samples.length;
  }

  getSmoothedBandwidth(): number {
    if (this.samples.length === 0) return 0;

    const recent = this.samples.slice(-10);
    const values = recent.map((s) => s.bytesPerSecond).sort((a, b) => a - b);

    const mid = Math.floor(values.length / 2);
    const median = values.length % 2 === 0
      ? (values[mid - 1] + values[mid]) / 2
      : values[mid];

    return median;
  }

  getAverageRtt(): number {
    if (this.samples.length === 0) return 100;
    const sum = this.samples.reduce((acc, s) => acc + s.rtt, 0);
    return sum / this.samples.length;
  }

  getTrend(): 'increasing' | 'decreasing' | 'stable' {
    if (this.samples.length < 5) return 'stable';

    const recent = this.samples.slice(-5);
    const first = recent.slice(0, 2).reduce((a, s) => a + s.bytesPerSecond, 0) / 2;
    const last = recent.slice(-2).reduce((a, s) => a + s.bytesPerSecond, 0) / 2;

    const ratio = last / first;
    if (ratio > 1.3) return 'increasing';
    if (ratio < 0.7) return 'decreasing';
    return 'stable';
  }

  recommendChunkSize(): ChunkSizeRecommendation {
    const bandwidth = this.getSmoothedBandwidth();

    if (bandwidth === 0) {
      return {
        chunkSize: DEFAULT_CHUNK_SIZE,
        reason: 'No bandwidth data, using default',
        bandwidth: 0,
        confidence: 0.5,
      };
    }

    const rtt = this.getAverageRtt();
    const trend = this.getTrend();

    let targetSize = bandwidth * (rtt / 1000) * 2;

    if (trend === 'increasing') {
      targetSize *= 1.2;
    } else if (trend === 'decreasing') {
      targetSize *= 0.8;
    }

    const chunkSize = Math.max(
      MIN_CHUNK_SIZE,
      Math.min(MAX_CHUNK_SIZE, Math.round(targetSize / 65536) * 65536)
    );

    let reason = '';
    if (chunkSize === MIN_CHUNK_SIZE) {
      reason = 'Bandwidth very low, using minimum chunk size';
    } else if (chunkSize === MAX_CHUNK_SIZE) {
      reason = 'Bandwidth high, using maximum chunk size';
    } else {
      reason = `Adaptive: ${(bandwidth / 1024 / 1024).toFixed(2)} MB/s, RTT ${rtt.toFixed(0)}ms`;
    }

    return {
      chunkSize,
      reason,
      bandwidth,
      confidence: Math.min(1, this.samples.length / this.maxSamples),
    };
  }

  getStats() {
    return {
      averageBandwidth: this.getAverageBandwidth(),
      smoothedBandwidth: this.getSmoothedBandwidth(),
      averageRtt: this.getAverageRtt(),
      trend: this.getTrend(),
      sampleCount: this.samples.length,
    };
  }

  reset(): void {
    this.samples = [];
    this.lastChunkSentAt = 0;
    this.lastChunkSize = 0;
  }
}

export function formatBandwidth(bytesPerSecond: number): string {
  if (bytesPerSecond === 0) return '0 B/s';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  const i = Math.min(3, Math.floor(Math.log(bytesPerSecond) / Math.log(1024)));
  return `${(bytesPerSecond / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(3, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}
