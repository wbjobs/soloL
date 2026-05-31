export type ChunkPriority = 'low' | 'normal' | 'high' | 'urgent';

export const PRIORITY_ORDER: Record<ChunkPriority, number> = {
  low: 0,
  normal: 1,
  high: 2,
  urgent: 3,
};

export interface QueuedChunk {
  index: number;
  priority: ChunkPriority;
  size: number;
  data?: ArrayBuffer;
  hash?: string;
  addedAt: number;
  attempts: number;
}

export interface ChunkTiming {
  index: number;
  startAt: number;
  endAt: number;
  duration: number;
  size: number;
  priority: ChunkPriority;
}

export class PriorityChunkQueue {
  private queue: QueuedChunk[] = [];
  private inFlight: Set<number> = new Set();
  private completed: Set<number> = new Set();
  private timing: ChunkTiming[] = [];
  private onChunkAvailableCallback: (() => void) | null = null;

  addChunk(index: number, priority: ChunkPriority = 'normal', size: number = 0): void {
    if (this.completed.has(index) || this.inFlight.has(index)) {
      return;
    }

    if (this.queue.some((c) => c.index === index)) {
      const existing = this.queue.find((c) => c.index === index);
      if (existing && PRIORITY_ORDER[priority] > PRIORITY_ORDER[existing.priority]) {
        existing.priority = priority;
        this.sortQueue();
      }
      return;
    }

    this.queue.push({
      index,
      priority,
      size,
      addedAt: Date.now(),
      attempts: 0,
    });

    this.sortQueue();
    this.notifyAvailable();
  }

  addChunks(indices: number[], priority: ChunkPriority = 'normal', size: number = 0): void {
    indices.forEach((index) => this.addChunk(index, priority, size));
  }

  setPriority(index: number, priority: ChunkPriority): void {
    const chunk = this.queue.find((c) => c.index === index);
    if (chunk) {
      chunk.priority = priority;
      this.sortQueue();
      this.notifyAvailable();
    }
  }

  setPriorities(indices: number[], priority: ChunkPriority): void {
    indices.forEach((index) => this.setPriority(index, priority));
  }

  markRange(start: number, end: number, priority: ChunkPriority): void {
    for (let i = start; i < end; i++) {
      this.setPriority(i, priority);
    }
  }

  getNext(): QueuedChunk | null {
    const chunk = this.queue.find((c) => !this.inFlight.has(c.index));
    if (chunk) {
      this.inFlight.add(chunk.index);
      chunk.attempts++;
      return chunk;
    }
    return null;
  }

  markCompleted(index: number, duration: number, size: number, priority: ChunkPriority): void {
    this.completed.add(index);
    this.inFlight.delete(index);

    this.timing.push({
      index,
      startAt: Date.now() - duration,
      endAt: Date.now(),
      duration,
      size,
      priority,
    });

    this.queue = this.queue.filter((c) => c.index !== index);
    this.notifyAvailable();
  }

  markFailed(index: number): void {
    this.inFlight.delete(index);
    this.notifyAvailable();
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[b.priority] - PRIORITY_ORDER[a.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.index - b.index;
    });
  }

  private notifyAvailable(): void {
    if (this.onChunkAvailableCallback && this.hasAvailable()) {
      this.onChunkAvailableCallback();
    }
  }

  onChunkAvailable(callback: () => void): void {
    this.onChunkAvailableCallback = callback;
  }

  hasAvailable(): boolean {
    return this.queue.some((c) => !this.inFlight.has(c.index));
  }

  size(): number {
    return this.queue.length;
  }

  completedCount(): number {
    return this.completed.length;
  }

  inFlightCount(): number {
    return this.inFlight.size;
  }

  isCompleted(index: number): boolean {
    return this.completed.has(index);
  }

  getPriority(index: number): ChunkPriority {
    const chunk = this.queue.find((c) => c.index === index);
    return chunk?.priority || 'normal';
  }

  getTiming(): ChunkTiming[] {
    return [...this.timing];
  }

  getChunkTiming(index: number): ChunkTiming | undefined {
    return this.timing.find((t) => t.index === index);
  }

  getStats() {
    const completed = this.timing.length;
    const totalDuration = this.timing.reduce((sum, t) => sum + t.duration, 0);
    const avgDuration = completed > 0 ? totalDuration / completed : 0;
    const totalBytes = this.timing.reduce((sum, t) => sum + t.size, 0);
    const avgSpeed = avgDuration > 0 ? (totalBytes / avgDuration) * 1000 : 0;

    const byPriority: Record<ChunkPriority, { count: number; avgDuration: number }> = {
      low: { count: 0, avgDuration: 0 },
      normal: { count: 0, avgDuration: 0 },
      high: { count: 0, avgDuration: 0 },
      urgent: { count: 0, avgDuration: 0 },
    };

    this.timing.forEach((t) => {
      byPriority[t.priority].count++;
      byPriority[t.priority].avgDuration += t.duration;
    });

    (Object.keys(byPriority) as ChunkPriority[]).forEach((p) => {
      if (byPriority[p].count > 0) {
        byPriority[p].avgDuration /= byPriority[p].count;
      }
    });

    return {
      completed,
      queued: this.queue.length,
      inFlight: this.inFlight.size,
      avgDuration,
      avgSpeed,
      byPriority,
    };
  }

  getQueueSnapshot(): QueuedChunk[] {
    return [...this.queue];
  }

  clear(): void {
    this.queue = [];
    this.inFlight.clear();
    this.completed.clear();
    this.timing = [];
  }
}
