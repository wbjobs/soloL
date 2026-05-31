import { useEffect, useRef, useCallback } from 'react';
import type { WebRTCSignalData } from '../types';

interface WebRTCOptions {
  userId: string;
  sendSignal: (data: WebRTCSignalData) => void;
  onMessage?: (fromUserId: string, data: any) => void;
}

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export function useWebRTC({ userId, sendSignal, onMessage }: WebRTCOptions) {
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const dataChannelsRef = useRef<Map<string, RTCDataChannel>>(new Map());
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  const createPeerConnection = useCallback(
    (peerUserId: string, isInitiator: boolean): RTCPeerConnection => {
      const existing = peerConnectionsRef.current.get(peerUserId);
      if (existing) return existing;

      const pc = new RTCPeerConnection(ICE_SERVERS);
      peerConnectionsRef.current.set(peerUserId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal({
            type: 'ice-candidate',
            candidate: event.candidate.toJSON(),
            fromUserId: userId,
            toUserId: peerUserId,
          });
        }
      };

      pc.onconnectionstatechange = () => {
        if (
          pc.connectionState === 'disconnected' ||
          pc.connectionState === 'failed' ||
          pc.connectionState === 'closed'
        ) {
          peerConnectionsRef.current.delete(peerUserId);
          dataChannelsRef.current.delete(peerUserId);
        }
      };

      if (isInitiator) {
        const channel = pc.createDataChannel(`data-${userId}-${peerUserId}`);
        setupDataChannel(channel, peerUserId);
        dataChannelsRef.current.set(peerUserId, channel);

        pc.createOffer()
          .then((offer) => pc.setLocalDescription(offer))
          .then(() => {
            sendSignal({
              type: 'offer',
              sdp: pc.localDescription!,
              fromUserId: userId,
              toUserId: peerUserId,
            });
          })
          .catch(console.error);
      } else {
        pc.ondatachannel = (event) => {
          const channel = event.channel;
          setupDataChannel(channel, peerUserId);
          dataChannelsRef.current.set(peerUserId, channel);
        };
      }

      return pc;
    },
    [userId, sendSignal],
  );

  const setupDataChannel = (channel: RTCDataChannel, peerUserId: string) => {
    channel.onopen = () => {
      channel.send(JSON.stringify({ type: 'hello', userId }));
    };

    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessageRef.current?.(peerUserId, data);
      } catch {
        // ignore non-JSON messages
      }
    };

    channel.onerror = (error) => {
      console.error(`DataChannel error with ${peerUserId}:`, error);
    };
  };

  const handleSignal = useCallback(
    async (signal: WebRTCSignalData) => {
      const peerUserId =
        signal.fromUserId === userId ? signal.toUserId : signal.fromUserId;

      switch (signal.type) {
        case 'offer': {
          const pc = createPeerConnection(peerUserId, false);
          await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp!));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          sendSignal({
            type: 'answer',
            sdp: pc.localDescription!,
            fromUserId: userId,
            toUserId: peerUserId,
          });
          break;
        }
        case 'answer': {
          const pc = peerConnectionsRef.current.get(peerUserId);
          if (pc) {
            await pc.setRemoteDescription(new RTCSessionDescription(signal.sdp!));
          }
          break;
        }
        case 'ice-candidate': {
          const pc = peerConnectionsRef.current.get(peerUserId);
          if (pc && signal.candidate) {
            await pc.addIceCandidate(new RTCIceCandidate(signal.candidate));
          }
          break;
        }
      }
    },
    [userId, createPeerConnection, sendSignal],
  );

  const sendMessage = useCallback((peerUserId: string, data: any) => {
    const channel = dataChannelsRef.current.get(peerUserId);
    if (channel && channel.readyState === 'open') {
      channel.send(JSON.stringify(data));
    }
  }, []);

  const broadcastMessage = useCallback((data: any) => {
    dataChannelsRef.current.forEach((channel, peerUserId) => {
      if (channel.readyState === 'open') {
        channel.send(JSON.stringify(data));
      }
    });
  }, []);

  const closePeer = useCallback((peerUserId: string) => {
    const channel = dataChannelsRef.current.get(peerUserId);
    if (channel) {
      channel.close();
      dataChannelsRef.current.delete(peerUserId);
    }
    const pc = peerConnectionsRef.current.get(peerUserId);
    if (pc) {
      pc.close();
      peerConnectionsRef.current.delete(peerUserId);
    }
  }, []);

  const closeAll = useCallback(() => {
    dataChannelsRef.current.forEach((channel) => channel.close());
    dataChannelsRef.current.clear();
    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();
  }, []);

  useEffect(() => {
    const handleWebRTCSignalEvent = (event: Event) => {
      const customEvent = event as CustomEvent<WebRTCSignalData>;
      if (customEvent.detail.toUserId === userId || customEvent.detail.fromUserId !== userId) {
        handleSignal(customEvent.detail);
      }
    };

    window.addEventListener('webrtc_signal', handleWebRTCSignalEvent);
    return () => {
      window.removeEventListener('webrtc_signal', handleWebRTCSignalEvent);
      closeAll();
    };
  }, [userId, handleSignal, closeAll]);

  return {
    createPeerConnection,
    handleSignal,
    sendMessage,
    broadcastMessage,
    closePeer,
    closeAll,
  };
}
