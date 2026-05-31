import { TextOperation } from './ot-engine';

export class OTClient {
  private revision = 0;
  private pendingOp: TextOperation | null = null;
  private pendingBuffer: TextOperation | null = null;
  private onSend: (revision: number, operation: TextOperation) => void;

  constructor(onSend: (revision: number, operation: TextOperation) => void) {
    this.onSend = onSend;
  }

  applyClient(operation: TextOperation): void {
    if (this.pendingOp == null) {
      this.pendingOp = operation;
      this.onSend(this.revision, operation);
    } else if (this.pendingBuffer == null) {
      this.pendingBuffer = operation;
    } else {
      this.pendingBuffer = TextOperation.compose(this.pendingBuffer, operation);
    }
  }

  applyServer(operation: TextOperation): void {
    this.revision++;
    if (this.pendingOp == null) {
      return;
    }

    const [pendingPrime, operationPrime] = TextOperation.transform(this.pendingOp, operation);

    if (this.pendingBuffer == null) {
      this.pendingOp = pendingPrime;
      if (!operationPrime.isNoop()) {
        this.onSend(this.revision, operationPrime);
      }
    } else {
      const [bufferPrime, opPrime2] = TextOperation.transform(this.pendingBuffer, operationPrime);
      this.pendingOp = TextOperation.compose(pendingPrime, bufferPrime);
      this.pendingBuffer = null;
      if (!opPrime2.isNoop()) {
        this.onSend(this.revision, opPrime2);
      }
    }
  }

  serverAck(): void {
    if (this.pendingOp == null) {
      throw new Error('No pending operation to acknowledge');
    }

    this.revision++;

    if (this.pendingBuffer != null) {
      this.pendingOp = this.pendingBuffer;
      this.pendingBuffer = null;
      this.onSend(this.revision, this.pendingOp);
    } else {
      this.pendingOp = null;
    }
  }

  getRevision(): number {
    return this.revision;
  }

  setRevision(revision: number): void {
    this.revision = revision;
  }

  isSynchronized(): boolean {
    return this.pendingOp == null;
  }

  isAwaitingAck(): boolean {
    return this.pendingOp != null && this.pendingBuffer == null;
  }

  isAwaitingWithBuffer(): boolean {
    return this.pendingOp != null && this.pendingBuffer != null;
  }
}
