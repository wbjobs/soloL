import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HTTPServer } from 'http';
import url from 'url';
import { v4 as uuidv4 } from 'uuid';
import roomManager from './RoomManager.js';
import RoomRepository from '../db/repositories/RoomRepository.js';
import VersionRepository from '../db/repositories/VersionRepository.js';
import type {
  SignalingMessageUnion,
  JoinRoomMessage,
  OfferMessage,
  AnswerMessage,
  IceCandidateMessage,
  RoomStateMessage,
  UserJoinedMessage,
  UserLeftMessage,
  SaveVersionMessage,
  VersionSavedMessage,
  SectionLockMessage,
  ContentChangeMessage,
  CursorMessage,
  HeartbeatMessage,
  LocksReleasedMessage,
  PeerMessage,
  RoomState,
  User,
  ScoreVersion,
} from '../../shared/types.js';

type ServerMessageUnion = SignalingMessageUnion | PeerMessage;

interface ClientInfo {
  ws: WebSocket;
  userId: string;
  roomId: string;
  userName: string;
}

export class WebSocketSignalingServer {
  private wss: WebSocketServer;
  private clients: Map<string, ClientInfo> = new Map();
  private roomClients: Map<string, Set<string>> = new Map();

  constructor(httpServer: HTTPServer) {
    this.wss = new WebSocketServer({ server: httpServer, path: '/ws' });
    this.setupEventHandlers();
    this.setupRoomStateListener();
  }

  private setupEventHandlers(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const clientId = uuidv4();

      try {
        const query = url.parse(req.url || '', true).query;
        const roomId = query.roomId as string;
        const userId = query.userId as string || clientId;

        if (!roomId) {
          ws.close(4001, 'Room ID is required');
          return;
        }

        this.clients.set(clientId, {
          ws,
          userId,
          roomId,
          userName: '',
        });

        if (!this.roomClients.has(roomId)) {
          this.roomClients.set(roomId, new Set());
        }
        this.roomClients.get(roomId)!.add(clientId);

        ws.on('message', async (data) => {
          try {
            const message = JSON.parse(data.toString()) as ServerMessageUnion;
            await this.handleMessage(clientId, message);
          } catch (error) {
            console.error('Error handling message:', error);
          }
        });

        ws.on('close', () => {
          this.handleDisconnect(clientId);
        });

        ws.on('error', (error) => {
          console.error('WebSocket error:', error);
        });
      } catch (error) {
        console.error('Connection error:', error);
        ws.close(4000, 'Invalid connection');
      }
    });
  }

  private setupRoomStateListener(): void {
    roomManager.subscribe((roomId: string, state: RoomState) => {
      this.broadcastRoomState(roomId, state);
    });

    roomManager.onLocksReleased((roomId: string, userId: string, releasedSectionIds: string[]) => {
      const message: LocksReleasedMessage = {
        type: 'locks-released',
        roomId,
        userId,
        timestamp: Date.now(),
        releasedSectionIds,
      };
      this.broadcastToRoom(roomId, message);
    });
  }

  private async handleMessage(clientId: string, message: ServerMessageUnion): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    switch (message.type) {
      case 'join-room':
        await this.handleJoinRoom(clientId, message as JoinRoomMessage);
        break;
      case 'heartbeat':
        this.handleHeartbeat(clientId, message as HeartbeatMessage);
        break;
      case 'offer':
        this.handleOffer(clientId, message as OfferMessage);
        break;
      case 'answer':
        this.handleAnswer(clientId, message as AnswerMessage);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(clientId, message as IceCandidateMessage);
        break;
      case 'cursor':
        this.handleCursor(clientId, message as CursorMessage);
        break;
      case 'content-change':
        await this.handleContentChange(clientId, message as ContentChangeMessage);
        break;
      case 'section-lock':
        await this.handleSectionLock(clientId, message as SectionLockMessage);
        break;
      case 'save-version':
        await this.handleSaveVersion(clientId, message as SaveVersionMessage);
        break;
      default:
        this.forwardToRoom(clientId, message);
    }
  }

  private handleHeartbeat(clientId: string, message: HeartbeatMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    roomManager.heartbeat(message.roomId, message.userId);
  }

  private async handleJoinRoom(clientId: string, message: JoinRoomMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    client.userName = message.userName;

    const roomState = await roomManager.getOrCreateRoom(message.roomId);
    const user = await roomManager.addUser(message.roomId, client.userId, message.userName);

    this.sendToClient(clientId, {
      type: 'room-state',
      roomId: message.roomId,
      userId: client.userId,
      timestamp: Date.now(),
      users: roomState.users,
      currentScore: roomState.currentContent,
      currentVersion: roomState.currentVersion,
      lockedSections: roomState.lockedSections,
    } as RoomStateMessage);

    const otherClients = this.getOtherClientsInRoom(message.roomId, clientId);
    otherClients.forEach(otherClientId => {
      const otherClient = this.clients.get(otherClientId);
      if (otherClient) {
        this.sendToClient(otherClientId, {
          type: 'user-joined',
          roomId: message.roomId,
          userId: client.userId,
          timestamp: Date.now(),
          user,
        } as UserJoinedMessage);
      }
    });

    console.log(`User ${message.userName} (${client.userId}) joined room ${message.roomId}`);
  }

  private handleOffer(clientId: string, message: OfferMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const targetClientId = this.findClientByUserId(message.roomId, message.targetId);
    if (targetClientId) {
      this.sendToClient(targetClientId, {
        ...message,
        userId: client.userId,
      });
    }
  }

  private handleAnswer(clientId: string, message: AnswerMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const targetClientId = this.findClientByUserId(message.roomId, message.targetId);
    if (targetClientId) {
      this.sendToClient(targetClientId, {
        ...message,
        userId: client.userId,
      });
    }
  }

  private handleIceCandidate(clientId: string, message: IceCandidateMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const targetClientId = this.findClientByUserId(message.roomId, message.targetId);
    if (targetClientId) {
      this.sendToClient(targetClientId, {
        ...message,
        userId: client.userId,
      });
    }
  }

  private handleCursor(clientId: string, message: CursorMessage): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    roomManager.updateUserCursor(
      client.roomId,
      client.userId,
      message.position,
      message.selection
    );

    this.forwardToRoom(clientId, message);
  }

  private async handleContentChange(clientId: string, message: ContentChangeMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const roomState = roomManager.getRoomState(client.roomId);
    if (roomState && message.version > roomState.currentVersion) {
      roomManager.updateContent(client.roomId, message.version.toString(), message.version);
      await RoomRepository.updateContent(client.roomId, message.version.toString(), message.version);
    }

    this.forwardToRoom(clientId, message);
  }

  private async handleSectionLock(clientId: string, message: SectionLockMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    if (message.locked) {
      await roomManager.lockSection(
        client.roomId,
        message.sectionId,
        message.range.start,
        message.range.end,
        client.userId,
        client.userName
      );
    } else {
      await roomManager.unlockSection(client.roomId, message.sectionId, client.userId);
    }

    this.forwardToRoom(clientId, message);
  }

  private async handleSaveVersion(clientId: string, message: SaveVersionMessage): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    const latestVersion = await VersionRepository.getLatestVersion(client.roomId);
    const newVersion = latestVersion + 1;

    const savedVersion: ScoreVersion = await VersionRepository.create(
      client.roomId,
      newVersion,
      message.content,
      message.message,
      client.userId,
      client.userName
    );

    roomManager.updateContent(client.roomId, message.content, newVersion);
    await RoomRepository.updateContent(client.roomId, message.content, newVersion);

    const versionSavedMessage: VersionSavedMessage = {
      type: 'version-saved',
      userId: client.userId,
      timestamp: Date.now(),
      version: savedVersion,
    };

    this.broadcastToRoom(client.roomId, versionSavedMessage);
  }

  private forwardToRoom(clientId: string, message: unknown): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const otherClients = this.getOtherClientsInRoom(client.roomId, clientId);
    otherClients.forEach(otherClientId => {
      const otherClient = this.clients.get(otherClientId);
      if (otherClient && otherClient.ws.readyState === WebSocket.OPEN) {
        otherClient.ws.send(JSON.stringify(message));
      }
    });
  }

  private broadcastToRoom(roomId: string, message: unknown): void {
    const clients = this.roomClients.get(roomId);
    if (!clients) return;

    const messageStr = JSON.stringify(message);
    clients.forEach(clientId => {
      const client = this.clients.get(clientId);
      if (client && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr);
      }
    });
  }

  private broadcastRoomState(roomId: string, state: RoomState): void {
    const message: RoomStateMessage = {
      type: 'room-state',
      roomId,
      userId: 'server',
      timestamp: Date.now(),
      users: state.users,
      currentScore: state.currentContent,
      currentVersion: state.currentVersion,
      lockedSections: state.lockedSections,
    };

    this.broadcastToRoom(roomId, message);
  }

  private sendToClient(clientId: string, message: unknown): void {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(JSON.stringify(message));
    }
  }

  private findClientByUserId(roomId: string, userId: string): string | null {
    const clients = this.roomClients.get(roomId);
    if (!clients) return null;

    for (const clientId of clients) {
      const client = this.clients.get(clientId);
      if (client && client.userId === userId) {
        return clientId;
      }
    }

    return null;
  }

  private getOtherClientsInRoom(roomId: string, excludeClientId: string): string[] {
    const clients = this.roomClients.get(roomId);
    if (!clients) return [];

    return Array.from(clients).filter(id => id !== excludeClientId);
  }

  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    const { roomId, userId, userName } = client;

    roomManager.removeUser(roomId, userId);

    const roomClients = this.roomClients.get(roomId);
    if (roomClients) {
      roomClients.delete(clientId);
      if (roomClients.size === 0) {
        this.roomClients.delete(roomId);
      }
    }

    this.clients.delete(clientId);

    const leaveMessage: UserLeftMessage = {
      type: 'user-left',
      roomId,
      userId,
      timestamp: Date.now(),
    };

    this.broadcastToRoom(roomId, leaveMessage);

    console.log(`User ${userName} (${userId}) left room ${roomId}`);
  }

  getConnectedUsers(roomId: string): User[] {
    return roomManager.getUsersInRoom(roomId);
  }

  close(): void {
    this.wss.close();
    this.clients.clear();
    this.roomClients.clear();
  }
}

export default WebSocketSignalingServer;
