import type { OTOperation, ProofreadBlock } from '../types';

function generateOpId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function transformOperation(op1: OTOperation, op2: OTOperation): OTOperation {
  if (op1.blockIndex !== op2.blockIndex || op1.field !== op2.field) {
    return op1;
  }

  const transformed = { ...op1, id: generateOpId() };

  if (op2.type === 'insert' && op2.position <= transformed.position) {
    transformed.position += op2.text.length;
  } else if (op2.type === 'delete' && op2.position < transformed.position) {
    transformed.position = Math.max(op2.position, transformed.position - op2.text.length);
  }

  return transformed;
}

function applyOperation(block: ProofreadBlock, op: OTOperation): ProofreadBlock {
  if (block.index !== op.blockIndex) return block;

  const updated = { ...block };
  const field = op.field as 'correctedText' | 'originalText';
  const text = updated[field];

  switch (op.type) {
    case 'insert':
      updated[field] =
        text.slice(0, op.position) + op.text + text.slice(op.position);
      break;
    case 'delete':
      updated[field] =
        text.slice(0, op.position) + text.slice(op.position + op.text.length);
      break;
    case 'replace':
      updated[field] =
        text.slice(0, op.position) +
        op.text +
        text.slice(op.position + (op.deletedText?.length ?? 0));
      break;
  }

  return updated;
}

interface PendingMessage {
  op: OTOperation;
  receivedAt: number;
}

class PriorityMessageQueue {
  private queue: PendingMessage[] = [];

  enqueue(op: OTOperation): void {
    const message: PendingMessage = {
      op,
      receivedAt: Date.now(),
    };

    let inserted = false;
    for (let i = 0; i < this.queue.length; i++) {
      if (this.compare(op, this.queue[i].op) < 0) {
        this.queue.splice(i, 0, message);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      this.queue.push(message);
    }
  }

  dequeue(): PendingMessage | undefined {
    return this.queue.shift();
  }

  peek(): PendingMessage | undefined {
    return this.queue[0];
  }

  size(): number {
    return this.queue.length;
  }

  clear(): void {
    this.queue = [];
  }

  private compare(a: OTOperation, b: OTOperation): number {
    if (a.lamportTime !== b.lamportTime) {
      return a.lamportTime - b.lamportTime;
    }
    return a.senderId.localeCompare(b.senderId);
  }
}

const OUT_OF_ORDER_TIMEOUT = 500;

export class OTClient {
  private revision: number = 0;
  private pendingOps: OTOperation[] = [];
  private buffer: OTOperation[] = [];
  private blocks: ProofreadBlock[] = [];
  private socket: any = null;
  private onStateChange: ((blocks: ProofreadBlock[]) => void) | null = null;

  private localLamportTime: number = 0;
  private lastAppliedLamportTime: number = -1;
  private messageQueue: PriorityMessageQueue = new PriorityMessageQueue();
  private flushTimeoutId: ReturnType<typeof setTimeout> | null = null;

  connect(socket: any): void {
    this.socket = socket;

    this.socket.on('ack', (data: { revision: number; lamportTime?: number }) => {
      this.handleAck(data.revision, data.lamportTime);
    });

    this.socket.on('edit', (op: OTOperation) => {
      this.receiveRemoteOp(op);
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.off('ack');
      this.socket.off('edit');
      this.socket = null;
    }
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId);
      this.flushTimeoutId = null;
    }
    this.pendingOps = [];
    this.buffer = [];
    this.messageQueue.clear();
    this.localLamportTime = 0;
    this.lastAppliedLamportTime = -1;
  }

  setInitialState(blocks: ProofreadBlock[], revision: number): void {
    this.blocks = blocks.map((b) => ({ ...b }));
    this.revision = revision;
    this.pendingOps = [];
    this.buffer = [];
    this.messageQueue.clear();
    this.localLamportTime = 0;
    this.lastAppliedLamportTime = -1;
    this.notifyStateChange();
  }

  onStateChangeCallback(callback: (blocks: ProofreadBlock[]) => void): void {
    this.onStateChange = callback;
  }

  getBlocks(): ProofreadBlock[] {
    return this.blocks;
  }

  getRevision(): number {
    return this.revision;
  }

  applyLocalOp(op: OTOperation): void {
    this.localLamportTime++;

    const localOp: OTOperation = {
      ...op,
      id: generateOpId(),
      lamportTime: this.localLamportTime,
      revision: this.revision + this.pendingOps.length + this.buffer.length + 1,
    };

    this.blocks = this.blocks.map((b) => applyOperation(b, localOp));

    if (this.pendingOps.length > 0) {
      this.buffer.push(localOp);
    } else {
      this.pendingOps.push(localOp);
      this.sendOp(localOp);
    }

    this.notifyStateChange();
  }

  private sendOp(op: OTOperation): void {
    if (this.socket) {
      this.socket.emit('edit', {
        ...op,
        revision: this.revision + 1,
        lamportTime: this.localLamportTime,
      });
    }
  }

  handleAck(ackRevision: number, lamportTime?: number): void {
    this.revision = ackRevision;
    if (lamportTime !== undefined) {
      this.localLamportTime = Math.max(this.localLamportTime, lamportTime);
    }

    if (this.pendingOps.length > 0) {
      this.pendingOps.shift();
    }

    if (this.buffer.length > 0) {
      const nextOp = this.buffer.shift()!;
      this.pendingOps.push(nextOp);
      this.sendOp(nextOp);
    }
  }

  receiveRemoteOp(op: OTOperation): void {
    if (!op || op.lamportTime === undefined || op.lamportTime === null) {
      console.warn('Received invalid op without lamportTime, applying immediately:', op);
      this.handleRemoteOp(op);
      return;
    }

    this.localLamportTime = Math.max(this.localLamportTime, op.lamportTime) + 1;

    if (op.lamportTime <= this.lastAppliedLamportTime) {
      console.warn('Received duplicate or outdated op, skipping:', op);
      return;
    }

    const expectedTime = this.lastAppliedLamportTime + 1;

    if (op.lamportTime === expectedTime) {
      this.handleRemoteOp(op);
      this.lastAppliedLamportTime = op.lamportTime;
      this.processQueue();
    } else {
      this.messageQueue.enqueue(op);
      this.scheduleFlush();
    }
  }

  private scheduleFlush(): void {
    if (this.flushTimeoutId) {
      clearTimeout(this.flushTimeoutId);
    }
    this.flushTimeoutId = setTimeout(() => {
      this.flushQueue();
    }, OUT_OF_ORDER_TIMEOUT);
  }

  private flushQueue(): void {
    this.flushTimeoutId = null;

    while (this.messageQueue.size() > 0) {
      const next = this.messageQueue.peek();
      if (!next) break;

      const expectedTime = this.lastAppliedLamportTime + 1;

      if (next.op.lamportTime === expectedTime) {
        const message = this.messageQueue.dequeue()!;
        this.handleRemoteOp(message.op);
        this.lastAppliedLamportTime = message.op.lamportTime;
      } else if (next.op.lamportTime < expectedTime) {
        this.messageQueue.dequeue();
      } else {
        const waitTime = Date.now() - next.receivedAt;
        if (waitTime > OUT_OF_ORDER_TIMEOUT) {
          console.warn(
            `Timeout waiting for op with lamportTime ${expectedTime}, ` +
            `applying next available (${next.op.lamportTime}) after ${waitTime}ms`,
          );
          const message = this.messageQueue.dequeue()!;
          this.handleRemoteOp(message.op);
          this.lastAppliedLamportTime = message.op.lamportTime;
        } else {
          this.scheduleFlush();
          break;
        }
      }
    }

    this.processQueue();
  }

  private processQueue(): void {
    while (this.messageQueue.size() > 0) {
      const next = this.messageQueue.peek();
      if (!next) break;

      const expectedTime = this.lastAppliedLamportTime + 1;

      if (next.op.lamportTime === expectedTime) {
        const message = this.messageQueue.dequeue()!;
        this.handleRemoteOp(message.op);
        this.lastAppliedLamportTime = message.op.lamportTime;
      } else {
        break;
      }
    }
  }

  private handleRemoteOp(remoteOp: OTOperation): void {
    let transformedOp = remoteOp;

    for (const pendingOp of this.pendingOps) {
      transformedOp = transformOperation(transformedOp, pendingOp);
    }

    for (const bufferOp of this.buffer) {
      transformedOp = transformOperation(transformedOp, bufferOp);
    }

    for (let i = 0; i < this.pendingOps.length; i++) {
      this.pendingOps[i] = transformOperation(this.pendingOps[i], remoteOp);
    }

    for (let i = 0; i < this.buffer.length; i++) {
      this.buffer[i] = transformOperation(this.buffer[i], remoteOp);
    }

    this.blocks = this.blocks.map((b) => applyOperation(b, transformedOp));
    this.revision++;

    this.notifyStateChange();
  }

  private notifyStateChange(): void {
    if (this.onStateChange) {
      this.onStateChange(this.blocks);
    }
  }

  createInsertOp(
    blockIndex: number,
    field: string,
    position: number,
    text: string,
    userId: string,
  ): OTOperation {
    return {
      id: generateOpId(),
      type: 'insert',
      blockIndex,
      field,
      position,
      text,
      userId,
      senderId: userId,
      revision: 0,
      lamportTime: this.localLamportTime,
    };
  }

  createDeleteOp(
    blockIndex: number,
    field: string,
    position: number,
    text: string,
    userId: string,
  ): OTOperation {
    return {
      id: generateOpId(),
      type: 'delete',
      blockIndex,
      field,
      position,
      text,
      userId,
      senderId: userId,
      revision: 0,
      lamportTime: this.localLamportTime,
    };
  }

  createReplaceOp(
    blockIndex: number,
    field: string,
    position: number,
    deletedText: string,
    text: string,
    userId: string,
  ): OTOperation {
    return {
      id: generateOpId(),
      type: 'replace',
      blockIndex,
      field,
      position,
      text,
      deletedText,
      userId,
      senderId: userId,
      revision: 0,
      lamportTime: this.localLamportTime,
    };
  }
}

export const otClient = new OTClient();
