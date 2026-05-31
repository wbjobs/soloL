import { useEffect, useRef, useCallback, useState } from 'react';
import type {
  PeerMessage,
  CursorMessage,
  ContentChangeMessage,
  SectionLockMessage,
  SaveVersionMessage,
  VersionSavedMessage,
  MidiPlayMessage,
  MidiStopMessage,
  MidiSeekMessage,
  EditorChange,
  Position,
} from '../../shared/types';

export type PeerConnectionStatus = 'new' | 'connecting' | 'connected' | 'disconnected' | 'failed' | 'closed';

interface PeerConnection {
  peerId: string;
  connection: RTCPeerConnection;
  dataChannel: RTCDataChannel | null;
  status: PeerConnectionStatus;
  isInitiator: boolean;
}

interface UseWebRTCOptions {
  userId: string;
  roomId: string;
  iceServers?: RTCIceServer[];
  onPeerConnected?: (peerId: string) => void;
  onPeerDisconnected?: (peerId: string) => void;
  onMessage?: (peerId: string, message: PeerMessage) => void;
  onCursor?: (peerId: string, position: { line: number; ch: number }, selection?: { anchor: Position; head: Position }) => void;
  onContentChange?: (peerId: string, changes: EditorChange[], version: number) => void;
  onSectionLock?: (peerId: string, sectionId: string, locked: boolean, range: { start: number; end: number }) => void;
  onSaveVersion?: (peerId: string, content: string, message: string) => void;
  onVersionSaved?: (peerId: string, version: unknown) => void;
  onMidiPlay?: (peerId: string, startNote?: number) => void;
  onMidiStop?: (peerId: string) => void;
  onMidiSeek?: (peerId: string, noteIndex: number) => void;
  onIceCandidate?: (peerId: string, candidate: RTCIceCandidateInit) => void;
  onOffer?: (peerId: string, sdp: RTCSessionDescriptionInit) => void;
  onAnswer?: (peerId: string, sdp: RTCSessionDescriptionInit) => void;
  onError?: (peerId: string, error: Error) => void;
}

interface UseWebRTCReturn {
  peers: Map<string, PeerConnection>;
  connectToPeer: (peerId: string, isInitiator: boolean) => Promise<void>;
  disconnectFromPeer: (peerId: string) => void;
  handleOffer: (peerId: string, sdp: RTCSessionDescriptionInit) => Promise<void>;
  handleAnswer: (peerId: string, sdp: RTCSessionDescriptionInit) => Promise<void>;
  handleIceCandidate: (peerId: string, candidate: RTCIceCandidateInit) => Promise<void>;
  sendMessage: (peerId: string, message: PeerMessage) => void;
  broadcastMessage: (message: PeerMessage) => void;
  sendCursor: (position: { line: number; ch: number }, selection?: { anchor: Position; head: Position }) => void;
  sendContentChange: (changes: EditorChange[], version: number) => void;
  sendSectionLock: (sectionId: string, locked: boolean, range: { start: number; end: number }) => void;
  sendSaveVersion: (content: string, message: string) => void;
  sendVersionSaved: (version: unknown) => void;
  sendMidiPlay: (startNote?: number) => void;
  sendMidiStop: () => void;
  sendMidiSeek: (noteIndex: number) => void;
  getPeerStatus: (peerId: string) => PeerConnectionStatus | null;
  disconnectAll: () => void;
}

const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export function useWebRTC({
  userId,
  roomId,
  iceServers = DEFAULT_ICE_SERVERS,
  onPeerConnected,
  onPeerDisconnected,
  onMessage,
  onCursor,
  onContentChange,
  onSectionLock,
  onSaveVersion,
  onVersionSaved,
  onMidiPlay,
  onMidiStop,
  onMidiSeek,
  onIceCandidate,
  onOffer,
  onAnswer,
  onError,
}: UseWebRTCOptions): UseWebRTCReturn {
  const peersRef = useRef<Map<string, PeerConnection>>(new Map());
  const [, forceUpdate] = useState(0);

  const forceUpdatePeers = useCallback(() => {
    forceUpdate((prev) => prev + 1);
  }, []);

  const createPeerConnection = useCallback(
    (peerId: string, isInitiator: boolean): RTCPeerConnection => {
      const pc = new RTCPeerConnection({
        iceServers,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require',
      });

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          onIceCandidate?.(peerId, event.candidate);
        }
      };

      pc.oniceconnectionstatechange = () => {
        const peer = peersRef.current.get(peerId);
        if (!peer) return;

        const state = pc.iceConnectionState;
        let status: PeerConnectionStatus;

        switch (state) {
          case 'new':
            status = 'new';
            break;
          case 'checking':
          case 'connected':
            status = 'connecting';
            break;
          case 'completed':
            status = 'connected';
            break;
          case 'disconnected':
            status = 'disconnected';
            break;
          case 'failed':
            status = 'failed';
            onError?.(peerId, new Error('ICE connection failed'));
            break;
          case 'closed':
            status = 'closed';
            break;
          default:
            status = 'new';
        }

        peer.status = status;
        forceUpdatePeers();

        if (status === 'connected') {
          onPeerConnected?.(peerId);
        } else if (status === 'disconnected' || status === 'failed' || status === 'closed') {
          onPeerDisconnected?.(peerId);
        }
      };

      pc.onsignalingstatechange = () => {
        console.debug(`Signaling state for ${peerId}: ${pc.signalingState}`);
      };

      pc.ondatachannel = (event) => {
        const peer = peersRef.current.get(peerId);
        if (!peer) return;

        const channel = event.channel;
        peer.dataChannel = channel;
        setupDataChannel(peerId, channel);
      };

      return pc;
    },
    [iceServers, onIceCandidate, onPeerConnected, onPeerDisconnected, onError, forceUpdatePeers]
  );

  const setupDataChannel = useCallback(
    (peerId: string, channel: RTCDataChannel) => {
      channel.onopen = () => {
        console.debug(`Data channel open with ${peerId}`);
        const peer = peersRef.current.get(peerId);
        if (peer) {
          peer.status = 'connected';
          forceUpdatePeers();
          onPeerConnected?.(peerId);
        }
      };

      channel.onclose = () => {
        console.debug(`Data channel closed with ${peerId}`);
        const peer = peersRef.current.get(peerId);
        if (peer) {
          peer.status = 'disconnected';
          forceUpdatePeers();
          onPeerDisconnected?.(peerId);
        }
      };

      channel.onerror = (event) => {
        console.error(`Data channel error with ${peerId}:`, event);
        onError?.(peerId, new Error('Data channel error'));
      };

      channel.onmessage = (event) => {
        try {
          const message: PeerMessage = JSON.parse(event.data);
          onMessage?.(peerId, message);

          switch (message.type) {
            case 'cursor': {
              const cursorMsg = message as CursorMessage;
              onCursor?.(peerId, cursorMsg.position, cursorMsg.selection);
              break;
            }
            case 'content-change': {
              const contentMsg = message as ContentChangeMessage;
              onContentChange?.(peerId, contentMsg.changes, contentMsg.version);
              break;
            }
            case 'section-lock': {
              const lockMsg = message as SectionLockMessage;
              onSectionLock?.(peerId, lockMsg.sectionId, lockMsg.locked, lockMsg.range);
              break;
            }
            case 'save-version': {
              const saveMsg = message as SaveVersionMessage;
              onSaveVersion?.(peerId, saveMsg.content, saveMsg.message);
              break;
            }
            case 'version-saved': {
              const savedMsg = message as VersionSavedMessage;
              onVersionSaved?.(peerId, savedMsg.version);
              break;
            }
            case 'midi-play': {
              const playMsg = message as MidiPlayMessage;
              onMidiPlay?.(peerId, playMsg.startNote);
              break;
            }
            case 'midi-stop': {
              onMidiStop?.(peerId);
              break;
            }
            case 'midi-seek': {
              const seekMsg = message as MidiSeekMessage;
              onMidiSeek?.(peerId, seekMsg.noteIndex);
              break;
            }
          }
        } catch (error) {
          console.error(`Failed to parse message from ${peerId}:`, error);
          onError?.(peerId, error instanceof Error ? error : new Error('Failed to parse message'));
        }
      };
    },
    [onMessage, onCursor, onContentChange, onSectionLock, onSaveVersion, onVersionSaved, onMidiPlay, onMidiStop, onMidiSeek, onPeerConnected, onPeerDisconnected, onError, forceUpdatePeers]
  );

  const connectToPeer = useCallback(
    async (peerId: string, isInitiator: boolean) => {
      if (peersRef.current.has(peerId)) {
        console.warn(`Already connected to peer ${peerId}`);
        return;
      }

      try {
        const pc = createPeerConnection(peerId, isInitiator);
        const peer: PeerConnection = {
          peerId,
          connection: pc,
          dataChannel: null,
          status: 'new',
          isInitiator,
        };

        peersRef.current.set(peerId, peer);
        forceUpdatePeers();

        if (isInitiator) {
          const dataChannel = pc.createDataChannel('collaboration', {
            ordered: true,
            maxRetransmits: 3,
          });
          peer.dataChannel = dataChannel;
          setupDataChannel(peerId, dataChannel);

          const offer = await pc.createOffer({
            offerToReceiveAudio: false,
            offerToReceiveVideo: false,
          });
          await pc.setLocalDescription(offer);
          onOffer?.(peerId, offer);
        }
      } catch (error) {
        console.error(`Failed to connect to peer ${peerId}:`, error);
        onError?.(peerId, error instanceof Error ? error : new Error('Failed to connect to peer'));
        peersRef.current.delete(peerId);
        forceUpdatePeers();
      }
    },
    [createPeerConnection, setupDataChannel, onOffer, onError, forceUpdatePeers]
  );

  const disconnectFromPeer = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) return;

      try {
        if (peer.dataChannel) {
          peer.dataChannel.close();
        }
        peer.connection.close();
      } catch (error) {
        console.error(`Error disconnecting from peer ${peerId}:`, error);
      }

      peersRef.current.delete(peerId);
      forceUpdatePeers();
      onPeerDisconnected?.(peerId);
    },
    [onPeerDisconnected, forceUpdatePeers]
  );

  const handleOffer = useCallback(
    async (peerId: string, sdp: RTCSessionDescriptionInit) => {
      try {
        let peer = peersRef.current.get(peerId);
        if (!peer) {
          const pc = createPeerConnection(peerId, false);
          peer = {
            peerId,
            connection: pc,
            dataChannel: null,
            status: 'connecting',
            isInitiator: false,
          };
          peersRef.current.set(peerId, peer);
          forceUpdatePeers();
        }

        await peer.connection.setRemoteDescription(new RTCSessionDescription(sdp));
        const answer = await peer.connection.createAnswer();
        await peer.connection.setLocalDescription(answer);
        onAnswer?.(peerId, answer);
      } catch (error) {
        console.error(`Failed to handle offer from ${peerId}:`, error);
        onError?.(peerId, error instanceof Error ? error : new Error('Failed to handle offer'));
      }
    },
    [createPeerConnection, onAnswer, onError, forceUpdatePeers]
  );

  const handleAnswer = useCallback(
    async (peerId: string, sdp: RTCSessionDescriptionInit) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) {
        console.warn(`No peer connection found for ${peerId} when handling answer`);
        return;
      }

      try {
        await peer.connection.setRemoteDescription(new RTCSessionDescription(sdp));
      } catch (error) {
        console.error(`Failed to handle answer from ${peerId}:`, error);
        onError?.(peerId, error instanceof Error ? error : new Error('Failed to handle answer'));
      }
    },
    [onError]
  );

  const handleIceCandidate = useCallback(
    async (peerId: string, candidate: RTCIceCandidateInit) => {
      const peer = peersRef.current.get(peerId);
      if (!peer) {
        console.warn(`No peer connection found for ${peerId} when handling ICE candidate`);
        return;
      }

      try {
        await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error(`Failed to handle ICE candidate from ${peerId}:`, error);
        onError?.(peerId, error instanceof Error ? error : new Error('Failed to handle ICE candidate'));
      }
    },
    [onError]
  );

  const sendMessage = useCallback(
    (peerId: string, message: PeerMessage) => {
      const peer = peersRef.current.get(peerId);
      if (!peer || !peer.dataChannel || peer.dataChannel.readyState !== 'open') {
        console.warn(`Cannot send message to ${peerId}: Data channel not open`);
        return;
      }

      try {
        peer.dataChannel.send(JSON.stringify(message));
      } catch (error) {
        console.error(`Failed to send message to ${peerId}:`, error);
        onError?.(peerId, error instanceof Error ? error : new Error('Failed to send message'));
      }
    },
    [onError]
  );

  const broadcastMessage = useCallback(
    (message: PeerMessage) => {
      peersRef.current.forEach((_, peerId) => {
        sendMessage(peerId, message);
      });
    },
    [sendMessage]
  );

  const sendCursor = useCallback(
    (position: { line: number; ch: number }, selection?: { anchor: Position; head: Position }) => {
      const message: CursorMessage = {
        type: 'cursor',
        userId,
        position,
        selection,
        timestamp: Date.now(),
      };
      broadcastMessage(message);
    },
    [userId, broadcastMessage]
  );

  const sendContentChange = useCallback(
    (changes: EditorChange[], version: number) => {
      const message: ContentChangeMessage = {
        type: 'content-change',
        userId,
        changes,
        version,
        timestamp: Date.now(),
      };
      broadcastMessage(message);
    },
    [userId, broadcastMessage]
  );

  const sendSectionLock = useCallback(
    (sectionId: string, locked: boolean, range: { start: number; end: number }) => {
      const message: SectionLockMessage = {
        type: 'section-lock',
        userId,
        sectionId,
        locked,
        range,
        timestamp: Date.now(),
      };
      broadcastMessage(message);
    },
    [userId, broadcastMessage]
  );

  const sendSaveVersion = useCallback(
    (content: string, message: string) => {
      const msg: SaveVersionMessage = {
        type: 'save-version',
        userId,
        content,
        message,
        timestamp: Date.now(),
      };
      broadcastMessage(msg);
    },
    [userId, broadcastMessage]
  );

  const sendVersionSaved = useCallback(
    (version: unknown) => {
      const msg: VersionSavedMessage = {
        type: 'version-saved',
        userId,
        version,
        timestamp: Date.now(),
      } as VersionSavedMessage;
      broadcastMessage(msg);
    },
    [userId, broadcastMessage]
  );

  const sendMidiPlay = useCallback(
    (startNote?: number) => {
      const message: MidiPlayMessage = {
        type: 'midi-play',
        userId,
        startNote,
        timestamp: Date.now(),
      };
      broadcastMessage(message);
    },
    [userId, broadcastMessage]
  );

  const sendMidiStop = useCallback(() => {
    const message: MidiStopMessage = {
      type: 'midi-stop',
      userId,
      timestamp: Date.now(),
    };
    broadcastMessage(message);
  }, [userId, broadcastMessage]);

  const sendMidiSeek = useCallback(
    (noteIndex: number) => {
      const message: MidiSeekMessage = {
        type: 'midi-seek',
        userId,
        noteIndex,
        timestamp: Date.now(),
      };
      broadcastMessage(message);
    },
    [userId, broadcastMessage]
  );

  const getPeerStatus = useCallback(
    (peerId: string): PeerConnectionStatus | null => {
      const peer = peersRef.current.get(peerId);
      return peer ? peer.status : null;
    },
    []
  );

  const disconnectAll = useCallback(() => {
    peersRef.current.forEach((_, peerId) => {
      disconnectFromPeer(peerId);
    });
  }, [disconnectFromPeer]);

  useEffect(() => {
    return () => {
      disconnectAll();
    };
  }, [disconnectAll]);

  return {
    peers: peersRef.current,
    connectToPeer,
    disconnectFromPeer,
    handleOffer,
    handleAnswer,
    handleIceCandidate,
    sendMessage,
    broadcastMessage,
    sendCursor,
    sendContentChange,
    sendSectionLock,
    sendSaveVersion,
    sendVersionSaved,
    sendMidiPlay,
    sendMidiStop,
    sendMidiSeek,
    getPeerStatus,
    disconnectAll,
  };
}
