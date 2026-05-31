import type { SceneObject, LightSource, VoxelGridData, BakeQuality } from '@/types';

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface WebSocketConfig {
  readonly url?: string;
  readonly autoReconnect?: boolean;
  readonly maxReconnectAttempts?: number;
  readonly reconnectIntervalMs?: number;
  readonly heartbeatIntervalMs?: number;
}

export type BakeTaskStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface BakeProgressMessage {
  readonly type: 'bake_progress';
  readonly taskId: string;
  readonly sceneId: string;
  readonly quality: BakeQuality;
  readonly phase: 'voxelizing' | 'baking' | 'complete';
  readonly progress: number;
  readonly message: string;
  readonly elapsedMs: number;
}

export interface BakeCompleteMessage {
  readonly type: 'bake_complete';
  readonly taskId: string;
  readonly sceneId: string;
  readonly success: boolean;
  readonly voxelDataId?: string;
  readonly error?: string;
}

export interface SceneUpdateMessage {
  readonly type: 'scene_update';
  readonly sceneId: string;
  readonly objects?: SceneObject[];
  readonly lights?: LightSource[];
}

export interface VoxelUpdateMessage {
  readonly type: 'voxel_update';
  readonly sceneId: string;
  readonly voxelDataId: string;
  readonly resolution: number;
  readonly region?: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly width: number;
    readonly height: number;
    readonly depth: number;
  };
}

export type WebSocketMessage =
  | BakeProgressMessage
  | BakeCompleteMessage
  | SceneUpdateMessage
  | VoxelUpdateMessage
  | { readonly type: string; readonly [key: string]: unknown };

export interface MessageHandler<T extends WebSocketMessage = WebSocketMessage> {
  (message: T): void;
}

export interface StatusHandler {
  (status: WebSocketStatus, error?: Error): void;
}

class WebSocketService {
  private url: string;
  private autoReconnect: boolean;
  private maxReconnectAttempts: number;
  private reconnectIntervalMs: number;
  private heartbeatIntervalMs: number;

  private socket: WebSocket | null = null;
  private status: WebSocketStatus = 'disconnected';
  private reconnectAttempts: number = 0;
  private reconnectTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private heartbeatIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastHeartbeatTime: number = 0;

  private messageHandlers: Map<string, Set<MessageHandler>> = new Map();
  private statusHandlers: Set<StatusHandler> = new Set();
  private pendingMessages: unknown[] = [];

  constructor(config: WebSocketConfig = {}) {
    this.url = config.url ?? this.getDefaultUrl();
    this.autoReconnect = config.autoReconnect ?? true;
    this.maxReconnectAttempts = config.maxReconnectAttempts ?? 10;
    this.reconnectIntervalMs = config.reconnectIntervalMs ?? 3000;
    this.heartbeatIntervalMs = config.heartbeatIntervalMs ?? 30000;
  }

  private getDefaultUrl(): string {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    return `${protocol}//${host}/ws`;
  }

  public setUrl(url: string): void {
    if (this.status !== 'disconnected') {
      this.disconnect();
    }
    this.url = url;
  }

  public getStatus(): WebSocketStatus {
    return this.status;
  }

  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.status === 'connected' || this.status === 'connecting') {
        resolve();
        return;
      }

      this.setStatus('connecting');

      try {
        this.socket = new WebSocket(this.url);
      } catch (error) {
        this.setStatus('error', error instanceof Error ? error : new Error(String(error)));
        reject(error);
        return;
      }

      this.socket.onopen = () => {
        this.reconnectAttempts = 0;
        this.setStatus('connected');
        this.startHeartbeat();
        this.flushPendingMessages();
        resolve();
      };

      this.socket.onclose = (event) => {
        this.stopHeartbeat();
        this.setStatus('disconnected');

        if (this.autoReconnect && !event.wasClean) {
          this.scheduleReconnect();
        }
      };

      this.socket.onerror = (error) => {
        this.stopHeartbeat();
        const err = new Error('WebSocket connection error');
        this.setStatus('error', err);
        reject(err);
      };

      this.socket.onmessage = (event) => {
        this.handleMessage(event.data);
      };
    });
  }

  public disconnect(): void {
    this.autoReconnect = false;
    this.stopReconnect();
    this.stopHeartbeat();

    if (this.socket) {
      if (this.socket.readyState === WebSocket.OPEN) {
        this.socket.close(1000, 'Client initiated disconnect');
      }
      this.socket = null;
    }

    this.pendingMessages = [];
    this.setStatus('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.setStatus('error', new Error('Max reconnection attempts reached'));
      return;
    }

    this.stopReconnect();
    this.setStatus('reconnecting');

    const delay = this.reconnectIntervalMs * Math.pow(2, this.reconnectAttempts);
    this.reconnectTimeoutId = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch(() => {
      });
    }, Math.min(delay, 30000));
  }

  private stopReconnect(): void {
    if (this.reconnectTimeoutId !== null) {
      clearTimeout(this.reconnectTimeoutId);
      this.reconnectTimeoutId = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastHeartbeatTime = Date.now();

    this.heartbeatIntervalId = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.send({ type: 'heartbeat', timestamp: Date.now() });
      }

      const now = Date.now();
      if (now - this.lastHeartbeatTime > this.heartbeatIntervalMs * 2) {
        this.socket?.close(4000, 'Heartbeat timeout');
      }
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatIntervalId !== null) {
      clearInterval(this.heartbeatIntervalId);
      this.heartbeatIntervalId = null;
    }
  }

  private handleMessage(data: string): void {
    try {
      const message = JSON.parse(data) as WebSocketMessage;

      if (message.type === 'heartbeat') {
        this.lastHeartbeatTime = Date.now();
        return;
      }

      const handlers = this.messageHandlers.get(message.type);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(message);
          } catch (error) {
            console.error('Error in message handler:', error);
          }
        }
      }

      const allHandlers = this.messageHandlers.get('*');
      if (allHandlers) {
        for (const handler of allHandlers) {
          try {
            handler(message);
          } catch (error) {
            console.error('Error in wildcard message handler:', error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error, data);
    }
  }

  public send(message: unknown): boolean {
    if (this.socket?.readyState !== WebSocket.OPEN) {
      this.pendingMessages.push(message);
      return false;
    }

    try {
      const data = JSON.stringify(message);
      this.socket.send(data);
      return true;
    } catch (error) {
      console.error('Failed to send WebSocket message:', error);
      return false;
    }
  }

  private flushPendingMessages(): void {
    while (this.pendingMessages.length > 0) {
      const message = this.pendingMessages.shift();
      if (message) {
        this.send(message);
      }
    }
  }

  public on<T extends WebSocketMessage>(type: T['type'], handler: MessageHandler<T>): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler as MessageHandler);

    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler as MessageHandler);
        if (handlers.size === 0) {
          this.messageHandlers.delete(type);
        }
      }
    };
  }

  public onStatus(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);

    return () => {
      this.statusHandlers.delete(handler);
    };
  }

  public off<T extends WebSocketMessage>(type: T['type'], handler: MessageHandler<T>): void {
    const handlers = this.messageHandlers.get(type);
    if (handlers) {
      handlers.delete(handler as MessageHandler);
      if (handlers.size === 0) {
        this.messageHandlers.delete(type);
      }
    }
  }

  private setStatus(status: WebSocketStatus, error?: Error): void {
    this.status = status;

    for (const handler of this.statusHandlers) {
      try {
        handler(status, error);
      } catch (handlerError) {
        console.error('Error in status handler:', handlerError);
      }
    }
  }

  public subscribeToBakeTask(taskId: string): boolean {
    return this.send({
      type: 'subscribe',
      topic: `bake:${taskId}`,
    });
  }

  public unsubscribeFromBakeTask(taskId: string): boolean {
    return this.send({
      type: 'unsubscribe',
      topic: `bake:${taskId}`,
    });
  }

  public subscribeToScene(sceneId: string): boolean {
    return this.send({
      type: 'subscribe',
      topic: `scene:${sceneId}`,
    });
  }

  public unsubscribeFromScene(sceneId: string): boolean {
    return this.send({
      type: 'unsubscribe',
      topic: `scene:${sceneId}`,
    });
  }

  public subscribeToVoxelUpdates(sceneId: string): boolean {
    return this.send({
      type: 'subscribe',
      topic: `voxel:${sceneId}`,
    });
  }

  public unsubscribeFromVoxelUpdates(sceneId: string): boolean {
    return this.send({
      type: 'unsubscribe',
      topic: `voxel:${sceneId}`,
    });
  }

  public requestBakeTask(sceneId: string, quality: BakeQuality = 'medium', useGPU: boolean = true): boolean {
    return this.send({
      type: 'bake:start',
      sceneId,
      quality,
      useGPU,
    });
  }

  public cancelBakeTask(taskId: string): boolean {
    return this.send({
      type: 'bake:cancel',
      taskId,
    });
  }

  public updateSceneObject(sceneId: string, obj: SceneObject): boolean {
    return this.send({
      type: 'scene:object:update',
      sceneId,
      object: obj,
    });
  }

  public updateLight(sceneId: string, light: LightSource): boolean {
    return this.send({
      type: 'scene:light:update',
      sceneId,
      light,
    });
  }

  public uploadVoxelData(
    sceneId: string,
    bakeTaskId: string,
    gridData: VoxelGridData
  ): boolean {
    const dataType = gridData.data instanceof Float32Array ? 'float32' : 'uint8';

    return this.send({
      type: 'voxel:upload',
      sceneId,
      bakeTaskId,
      resolution: gridData.resolution,
      size: gridData.size,
      center: gridData.center,
      data: Array.from(gridData.data),
      dataType,
    });
  }

  public getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  public isConnected(): boolean {
    return this.status === 'connected';
  }

  public getPendingMessageCount(): number {
    return this.pendingMessages.length;
  }

  public dispose(): void {
    this.disconnect();
    this.messageHandlers.clear();
    this.statusHandlers.clear();
  }
}

export const websocketService = new WebSocketService();

export default websocketService;
