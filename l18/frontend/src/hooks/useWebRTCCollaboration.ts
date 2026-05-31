import { useCallback, useRef, useEffect, useState } from 'react';
import { collaborationAPI, type LabelOperation } from '@/services/collaboration';
import { useCollaborationStore } from '@/store/useCollaborationStore';

interface UseWebRTCCollaborationOptions {
  pointCloudId: string;
  userId: string;
  onRemoteOperation?: (operations: LabelOperation[]) => void;
}

interface UseWebRTCCollaborationReturn {
  isConnected: boolean;
  isHost: boolean;
  sessionId: string | null;
  createSession: () => Promise<void>;
  joinSession: (sessionId: string) => Promise<void>;
  leaveSession: () => Promise<void>;
  sendOperation: (operation: LabelOperation) => void;
  sendOperations: (operations: LabelOperation[]) => void;
  startPolling: () => void;
  stopPolling: () => void;
}

export const useWebRTCCollaboration = (
  options: UseWebRTCCollaborationOptions
): UseWebRTCCollaborationReturn => {
  const { pointCloudId, userId, onRemoteOperation } = options;
  
  const [isConnected, setIsConnected] = useState(false);
  const [isHost, setIsHost] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const pollingIntervalRef = useRef<number | null>(null);
  
  const { setCurrentSession, setActiveSessions, addRemoteOperations, setLamportClock, setIsPolling, setPollingInterval, lamportClock } = useCollaborationStore();

  const stopPolling = useCallback(() => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
    }
    setIsPolling(false);
    setPollingInterval(null);
  }, [setIsPolling, setPollingInterval]);

  const setupDataChannel = useCallback((channel: RTCDataChannel) => {
    channel.onopen = () => {
      console.log('Data channel opened');
    };
    
    channel.onmessage = (event) => {
      try {
        const operations: LabelOperation[] = JSON.parse(event.data);
        addRemoteOperations(operations);
        if (onRemoteOperation) {
          onRemoteOperation(operations);
        }
      } catch (e) {
        console.error('Failed to parse remote operation:', e);
      }
    };
    
    channel.onerror = (error) => {
      console.error('Data channel error:', error);
    };
    
    channel.onclose = () => {
      console.log('Data channel closed');
    };
  }, [addRemoteOperations, onRemoteOperation]);

  const createSession = useCallback(async () => {
    try {
      const session = await collaborationAPI.createSession(pointCloudId);
      setSessionId(session.id);
      setIsHost(true);
      setCurrentSession(session);
      
      peerConnectionRef.current = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      
      dataChannelRef.current = peerConnectionRef.current.createDataChannel('labels');
      setupDataChannel(dataChannelRef.current);
      
      const offer = await peerConnectionRef.current.createOffer();
      await peerConnectionRef.current.setLocalDescription(offer);
      
      await collaborationAPI.sendOffer(pointCloudId, session.id, offer);
      
      peerConnectionRef.current.onicecandidate = async (event) => {
        if (event.candidate) {
          await collaborationAPI.sendIceCandidate(pointCloudId, session.id, event.candidate);
        }
      };
      
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [pointCloudId, setCurrentSession, setupDataChannel]);

  const joinSession = useCallback(async (targetSessionId: string) => {
    try {
      const session = await collaborationAPI.getSession(pointCloudId, targetSessionId);
      setSessionId(targetSessionId);
      setIsHost(false);
      setCurrentSession(session);
      
      peerConnectionRef.current = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
      });
      
      peerConnectionRef.current.ondatachannel = (event) => {
        dataChannelRef.current = event.channel;
        setupDataChannel(dataChannelRef.current);
      };
      
      if (session.webrtc_offer) {
        await peerConnectionRef.current.setRemoteDescription(
          new RTCSessionDescription(session.webrtc_offer)
        );
        
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        
        await collaborationAPI.sendAnswer(pointCloudId, targetSessionId, answer);
      }
      
      peerConnectionRef.current.onicecandidate = async (event) => {
        if (event.candidate) {
          await collaborationAPI.sendIceCandidate(pointCloudId, targetSessionId, event.candidate);
        }
      };
      
      setIsConnected(true);
    } catch (error) {
      console.error('Failed to join session:', error);
    }
  }, [pointCloudId, setCurrentSession, setupDataChannel]);

  const leaveSession = useCallback(async () => {
    if (sessionId && isHost) {
      try {
        await collaborationAPI.endSession(pointCloudId, sessionId);
      } catch (error) {
        console.error('Failed to end session:', error);
      }
    }
    
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    stopPolling();
    setIsConnected(false);
    setIsHost(false);
    setSessionId(null);
    setCurrentSession(null);
  }, [pointCloudId, sessionId, isHost, setCurrentSession, stopPolling]);

  const sendOperation = useCallback((operation: LabelOperation) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify([operation]));
    }
  }, []);

  const sendOperations = useCallback((operations: LabelOperation[]) => {
    if (dataChannelRef.current && dataChannelRef.current.readyState === 'open') {
      dataChannelRef.current.send(JSON.stringify(operations));
    }
  }, []);

  const startPolling = useCallback(async () => {
    if (pollingIntervalRef.current) return;
    
    setIsPolling(true);
    
    const poll = async () => {
      try {
        const result = await collaborationAPI.getOperationsSince(pointCloudId, lamportClock);
        if (result.operations && result.operations.length > 0) {
          addRemoteOperations(result.operations);
          setLamportClock(result.currentClock);
          if (onRemoteOperation) {
            onRemoteOperation(result.operations);
          }
        }
      } catch (error) {
        console.error('Polling error:', error);
      }
    };
    
    await poll();
    const interval = window.setInterval(poll, 3000);
    pollingIntervalRef.current = interval;
    setPollingInterval(interval);
  }, [pointCloudId, lamportClock, addRemoteOperations, setLamportClock, setIsPolling, setPollingInterval, onRemoteOperation]);

  useEffect(() => {
    return () => {
      leaveSession();
    };
  }, [leaveSession]);

  return {
    isConnected,
    isHost,
    sessionId,
    createSession,
    joinSession,
    leaveSession,
    sendOperation,
    sendOperations,
    startPolling,
    stopPolling,
  };
};

export default useWebRTCCollaboration;
