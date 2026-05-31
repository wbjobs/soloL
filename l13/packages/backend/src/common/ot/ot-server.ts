import { TextOperation } from './ot-engine';

interface ClientState {
  revision: number;
}

export class OTServer {
  private document: string;
  private revisions: TextOperation[] = [];
  private clients: Map<string, ClientState> = new Map();
  private onBroadcast: (clientId: string, operation: TextOperation) => void;

  constructor(
    initialDocument: string,
    onBroadcast: (clientId: string, operation: TextOperation) => void,
  ) {
    this.document = initialDocument;
    this.onBroadcast = onBroadcast;
  }

  receiveOperation(clientId: string, revision: number, operation: TextOperation): TextOperation {
    const clientState = this.clients.get(clientId);
    if (!clientState) {
      throw new Error(`Unknown client: ${clientId}`);
    }

    const concurrentOps = this.revisions.slice(revision);
    let transformedOp = operation;

    for (const concurrentOp of concurrentOps) {
      const [, clientPrime] = TextOperation.transform(transformedOp, concurrentOp);
      transformedOp = clientPrime;
    }

    this.document = transformedOp.apply(this.document);
    this.revisions.push(transformedOp);
    clientState.revision = this.revisions.length;

    return transformedOp;
  }

  broadcastOperation(sourceClientId: string, operation: TextOperation): void {
    for (const [clientId] of this.clients) {
      if (clientId !== sourceClientId) {
        this.onBroadcast(clientId, operation);
      }
    }
  }

  joinClient(clientId: string): { document: string; revision: number } {
    this.clients.set(clientId, { revision: this.revisions.length });
    return {
      document: this.document,
      revision: this.revisions.length,
    };
  }

  leaveClient(clientId: string): void {
    this.clients.delete(clientId);
  }

  getDocument(): string {
    return this.document;
  }

  getRevision(): number {
    return this.revisions.length;
  }

  getRevisions(): TextOperation[] {
    return this.revisions;
  }

  getClientCount(): number {
    return this.clients.size;
  }
}
