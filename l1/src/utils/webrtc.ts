import { BandwidthEstimator, formatBandwidth } from './bandwidth';
import { PriorityChunkQueue, ChunkPriority } from './priorityQueue';

export interface SignalingMessage {
  type:
    | 'register'
    | 'offer'
    | 'answer'
    | 'ice-candidate'
    | 'file-info'
    | 'chunk-status'
    | 'transfer-complete'
    | 'request-status'
    | 'resume-info'
    | 'resume-accepted'
    | 'resume-rejected'
    | 'peer-status-request'
    | 'peer-status-response'
    | 'stats-update';
  from?: string;
  to?: string;
  payload?: any;
  fileId?: string;
}

export interface BandwidthStats {
  bytesPerSecond: number;
  formatted: string;
  rtt: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  currentChunkSize: number;
  recommendedChunkSize: number;
}

export type SignalingCallback = (msg: any) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private peerId: string = '';
  private callbacks: Map<string, SignalingCallback[]> = new Map();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  async connect(peerId?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.hostname}:3001/ws`;

      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.send({
          type: 'register',
          payload: { peerId: peerId || this.generatePeerId() },
        });
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'registered') {
            this.peerId = msg.payload.peerId;
            resolve(this.peerId);
          }
          this.emit(msg.type, msg);
        } catch (e) {
          console.error('Failed to parse signaling message:', e);
        }
      };

      this.ws.onerror = (e) => {
        reject(e);
      };

      this.ws.onclose = () => {
        this.scheduleReconnect();
      };
    });
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.peerId).catch(console.error);
    }, 3000);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(msg: SignalingMessage) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  on(event: string, callback: SignalingCallback) {
    if (!this.callbacks.has(event)) {
      this.callbacks.set(event, []);
    }
    this.callbacks.get(event)!.push(callback);
  }

  off(event: string, callback: SignalingCallback) {
    const cbs = this.callbacks.get(event);
    if (cbs) {
      const idx = cbs.indexOf(callback);
      if (idx >= 0) cbs.splice(idx, 1);
    }
  }

  private emit(event: string, data: any) {
    const cbs = this.callbacks.get(event);
    if (cbs) {
      cbs.forEach((cb) => cb(data));
    }
  }

  getPeerId(): string {
    return this.peerId;
  }

  private generatePeerId(): string {
    return 'peer_' + Math.random().toString(36).substring(2, 10);
  }
}

export class WebRTCPeer {
  private pc: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private signalingClient: SignalingClient;
  private targetPeerId: string = '';
  private onChunkReceived?: (chunkIndex: number, data: ArrayBuffer, hash: string) => void;
  private onChannelOpen?: () => void;
  private onChannelClose?: () => void;
  private onBandwidthUpdate?: (stats: BandwidthStats) => void;
  private chunkBuffer: ArrayBuffer[] = [];
  private receivingChunkIndex: number = -1;
  private receivingMeta: { index: number; hash: string; size: number } | null = null;

  private bandwidthEstimator: BandwidthEstimator;
  private priorityQueue: PriorityChunkQueue;
  private statsInterval: ReturnType<typeof setInterval> | null = null;
  private isSending: boolean = false;
  private currentChunkSize: number = 1024 * 1024;
  private chunkSendStart: number = 0;
  private activeChunkIndex: number = -1;

  private readonly config: RTCConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ],
  };

  constructor(signalingClient: SignalingClient) {
    this.signalingClient = signalingClient;
    this.bandwidthEstimator = new BandwidthEstimator();
    this.priorityQueue = new PriorityChunkQueue();
    this.setupSignalingHandlers();
  }

  private setupSignalingHandlers() {
    this.signalingClient.on('offer', async (msg) => {
      await this.handleOffer(msg.from, msg.payload);
    });

    this.signalingClient.on('answer', async (msg) => {
      await this.handleAnswer(msg.payload);
    });

    this.signalingClient.on('ice-candidate', async (msg) => {
      await this.handleIceCandidate(msg.payload);
    });
  }

  async initiateConnection(targetPeerId: string): Promise<RTCDataChannel> {
    this.targetPeerId = targetPeerId;

    this.pc = new RTCPeerConnection(this.config);

    this.dataChannel = this.pc.createDataChannel('fileTransfer', {
      ordered: true,
    });
    this.setupDataChannel(this.dataChannel);

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingClient.send({
          type: 'ice-candidate',
          to: this.targetPeerId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.signalingClient.send({
      type: 'offer',
      to: this.targetPeerId,
      payload: offer,
    });

    return this.dataChannel;
  }

  private async handleOffer(fromPeerId: string, offer: RTCSessionDescriptionInit) {
    this.targetPeerId = fromPeerId;
    this.pc = new RTCPeerConnection(this.config);

    this.pc.ondatachannel = (event) => {
      this.dataChannel = event.channel;
      this.setupDataChannel(this.dataChannel);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingClient.send({
          type: 'ice-candidate',
          to: this.targetPeerId,
          payload: event.candidate.toJSON(),
        });
      }
    };

    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);

    this.signalingClient.send({
      type: 'answer',
      to: this.targetPeerId,
      payload: answer,
    });
  }

  private async handleAnswer(answer: RTCSessionDescriptionInit) {
    if (this.pc) {
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleIceCandidate(candidate: RTCIceCandidateInit) {
    if (this.pc) {
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('Error adding ICE candidate:', e);
      }
    }
  }

  private setupDataChannel(channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this.startStatsMonitoring();
      this.onChannelOpen?.();
    };

    channel.onclose = () => {
      this.stopStatsMonitoring();
      this.onChannelClose?.();
    };

    channel.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);

        if (msg.type === 'chunk-start') {
          this.receivingChunkIndex = msg.index;
          this.receivingMeta = { index: msg.index, hash: msg.hash, size: msg.size };
          this.chunkBuffer = [];
        } else if (msg.type === 'chunk-end') {
          const completeBuffer = this.mergeBuffers(this.chunkBuffer);
          this.chunkBuffer = [];

          if (this.receivingMeta && this.onChunkReceived) {
            this.onChunkReceived(this.receivingMeta.index, completeBuffer, this.receivingMeta.hash);
          }
          this.receivingMeta = null;
          this.receivingChunkIndex = -1;
        }
      } else if (event.data instanceof ArrayBuffer) {
        this.chunkBuffer.push(event.data);
      }
    };
  }

  private mergeBuffers(buffers: ArrayBuffer[]): ArrayBuffer {
    let totalLength = 0;
    for (const buf of buffers) {
      totalLength += buf.byteLength;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buf of buffers) {
      result.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
    return result.buffer;
  }

  private startStatsMonitoring() {
    this.statsInterval = setInterval(async () => {
      if (this.pc && this.pc.connectionState === 'connected') {
        try {
          const stats = await this.pc.getStats();
          this.processStats(stats);
        } catch (e) {
        }
      }
    }, 1000);
  }

  private stopStatsMonitoring() {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  private processStats(stats: RTCStatsReport) {
    let bytesPerSecond = 0;
    let rtt = 100;

    stats.forEach((report) => {
      if (report.type === 'candidate-pair' && report.state === 'succeeded') {
        if (report.availableOutgoingBitrate) {
          bytesPerSecond = report.availableOutgoingBitrate / 8;
        }
        if (report.currentRoundTripTime) {
          rtt = report.currentRoundTripTime * 1000;
        }
      }

      if (report.type === 'outbound-rtp') {
        if (report.bytesSent && report.lastPacketSentTimestamp) {
        }
      }
    });

    if (bytesPerSecond > 0) {
      this.bandwidthEstimator.addSample(bytesPerSecond, rtt);
      const recommendation = this.bandwidthEstimator.recommendChunkSize();
      this.currentChunkSize = recommendation.chunkSize;

      this.onBandwidthUpdate?.({
        bytesPerSecond: recommendation.bandwidth,
        formatted: formatBandwidth(recommendation.bandwidth),
        rtt: this.bandwidthEstimator.getAverageRtt(),
        trend: this.bandwidthEstimator.getTrend(),
        currentChunkSize: this.currentChunkSize,
        recommendedChunkSize: recommendation.chunkSize,
      });
    }
  }

  async sendChunk(chunkIndex: number, data: ArrayBuffer, hash: string, priority: ChunkPriority = 'normal') {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('DataChannel is not open');
    }

    this.chunkSendStart = Date.now();
    this.activeChunkIndex = chunkIndex;
    this.bandwidthEstimator.recordChunkStart();

    const meta = {
      type: 'chunk-start',
      index: chunkIndex,
      hash,
      size: data.byteLength,
      priority,
    };
    this.dataChannel.send(JSON.stringify(meta));

    const CHUNK_SEND_SIZE = 64 * 1024;
    for (let offset = 0; offset < data.byteLength; offset += CHUNK_SEND_SIZE) {
      const end = Math.min(offset + CHUNK_SEND_SIZE, data.byteLength);
      const slice = data.slice(offset, end);
      this.dataChannel.send(slice);
      await new Promise((r) => setTimeout(r, 0));
    }

    this.dataChannel.send(JSON.stringify({ type: 'chunk-end', index: chunkIndex }));

    const duration = Date.now() - this.chunkSendStart;
    this.bandwidthEstimator.recordChunkEnd(data.byteLength);

    this.priorityQueue.markCompleted(chunkIndex, duration, data.byteLength, priority);
  }

  queueChunk(chunkIndex: number, priority: ChunkPriority = 'normal', size: number = 0) {
    this.priorityQueue.addChunk(chunkIndex, priority, size);
  }

  setChunkPriority(chunkIndex: number, priority: ChunkPriority) {
    this.priorityQueue.setPriority(chunkIndex, priority);
  }

  setRangePriority(startIndex: number, endIndex: number, priority: ChunkPriority) {
    this.priorityQueue.markRange(startIndex, endIndex, priority);
  }

  getNextQueuedChunk(): number | null {
    const chunk = this.priorityQueue.getNext();
    return chunk ? chunk.index : null;
  }

  hasQueuedChunks(): boolean {
    return this.priorityQueue.hasAvailable();
  }

  getQueueSize(): number {
    return this.priorityQueue.size();
  }

  markChunkCompleted(chunkIndex: number, duration: number, size: number, priority: ChunkPriority) {
    this.priorityQueue.markCompleted(chunkIndex, duration, size, priority);
  }

  getChunkTimings() {
    return this.priorityQueue.getTiming();
  }

  getBandwidthEstimator(): BandwidthEstimator {
    return this.bandwidthEstimator;
  }

  getCurrentChunkSize(): number {
    return this.currentChunkSize;
  }

  getPriorityQueue(): PriorityChunkQueue {
    return this.priorityQueue;
  }

  setOnChunkReceived(callback: (chunkIndex: number, data: ArrayBuffer, hash: string) => void) {
    this.onChunkReceived = callback;
  }

  setOnChannelOpen(callback: () => void) {
    this.onChannelOpen = callback;
  }

  setOnChannelClose(callback: () => void) {
    this.onChannelClose = callback;
  }

  setOnBandwidthUpdate(callback: (stats: BandwidthStats) => void) {
    this.onBandwidthUpdate = callback;
  }

  getDataChannel(): RTCDataChannel | null {
    return this.dataChannel;
  }

  getConnectionState(): RTCPeerConnectionState | undefined {
    return this.pc?.connectionState;
  }

  close() {
    this.stopStatsMonitoring();
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.priorityQueue.clear();
    this.bandwidthEstimator.reset();
  }
}
