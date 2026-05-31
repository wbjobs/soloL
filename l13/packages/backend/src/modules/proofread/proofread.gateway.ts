import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ProofreadService } from './proofread.service';
import { OTServer } from '../../common/ot/ot-server';
import { TextOperation } from '../../common/ot/ot-engine';

@WebSocketGateway({ cors: { origin: '*' } })
export class ProofreadGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private otServers: Map<string, OTServer> = new Map();
  private clientRooms: Map<string, string> = new Map();
  private clientDocuments: Map<string, string> = new Map();
  private clientRevisions: Map<string, number> = new Map();
  private lamportClocks: Map<string, number> = new Map();

  constructor(private readonly proofreadService: ProofreadService) {}

  async handleConnection(client: Socket) {
    console.log(`Client connected: ${client.id}`);
  }

  async handleDisconnect(client: Socket) {
    const roomId = this.clientRooms.get(client.id);
    if (roomId) {
      const otServer = this.otServers.get(roomId);
      if (otServer) {
        otServer.leaveClient(client.id);
        if (otServer.getClientCount() === 0) {
          this.otServers.delete(roomId);
          this.lamportClocks.delete(roomId);
        }
      }
      client.leave(roomId);
      this.clientRooms.delete(client.id);
      this.clientDocuments.delete(client.id);
      this.clientRevisions.delete(client.id);

      client.to(roomId).emit('user-left', { clientId: client.id });
    }
    console.log(`Client disconnected: ${client.id}`);
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { projectId: string; blockId: string },
  ) {
    const roomId = `${data.projectId}:${data.blockId}`;

    if (!this.otServers.has(roomId)) {
      const block = await this.proofreadService.getBlockById(data.blockId);
      const document = block.correctedText || block.originalText;
      this.lamportClocks.set(roomId, 0);
      this.otServers.set(
        roomId,
        new OTServer(document, (targetClientId, operation) => {
          const lamportTime = this.lamportClocks.get(roomId) ?? 0;
          this.server.to(targetClientId).emit('operation', {
            operation: operation.toJSON(),
            revision: this.otServers.get(roomId)?.getRevision() ?? 0,
            lamportTime,
          });
        }),
      );
    }

    const otServer = this.otServers.get(roomId)!;
    const state = otServer.joinClient(client.id);

    client.join(roomId);
    this.clientRooms.set(client.id, roomId);
    this.clientDocuments.set(client.id, state.document);
    this.clientRevisions.set(client.id, state.revision);

    client.emit('joined-room', {
      roomId,
      document: state.document,
      revision: state.revision,
    });

    client.to(roomId).emit('user-joined', { clientId: client.id });
  }

  @SubscribeMessage('edit')
  async handleEdit(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { revision: number; operation: object[]; lamportTime?: number; senderId?: string },
  ) {
    const roomId = this.clientRooms.get(client.id);
    if (!roomId) return;

    const otServer = this.otServers.get(roomId);
    if (!otServer) return;

    try {
      const currentClock = this.lamportClocks.get(roomId) ?? 0;
      const clientClock = data.lamportTime ?? currentClock;
      const newClock = Math.max(currentClock, clientClock) + 1;
      this.lamportClocks.set(roomId, newClock);

      const operation = TextOperation.fromJSON(data.operation);
      const transformedOp = otServer.receiveOperation(client.id, data.revision, operation);

      const newDoc = otServer.getDocument();
      this.clientDocuments.set(client.id, newDoc);
      this.clientRevisions.set(client.id, otServer.getRevision());

      client.emit('ack', { 
        revision: otServer.getRevision(),
        lamportTime: newClock,
      });

      client.to(roomId).emit('edit', {
        operation: transformedOp.toJSON(),
        revision: otServer.getRevision(),
        lamportTime: newClock,
        senderId: data.senderId || client.id,
      });

      const blockId = roomId.split(':')[1];
      await this.proofreadService.updateBlock(blockId, {
        correctedText: newDoc,
        status: 'in-progress',
      });
    } catch (err) {
      console.error('OT operation error:', err);
      client.emit('error', { message: 'Operation transform failed' });
    }
  }

  @SubscribeMessage('cursor-move')
  async handleCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { position: number; selectionEnd?: number },
  ) {
    const roomId = this.clientRooms.get(client.id);
    if (!roomId) return;

    client.to(roomId).emit('cursor', {
      clientId: client.id,
      position: data.position,
      selectionEnd: data.selectionEnd,
    });
  }
}
