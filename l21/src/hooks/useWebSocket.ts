import { useEffect, useRef, useCallback, useState } from 'react';
import type {
  SignalingMessageUnion,
  OfferMessage,
  AnswerMessage,
  IceCandidateMessage,
  JoinRoomMessage,
  RoomStateMessage,
  UserJoinedMessage,
  UserLeftMessage,
  HeartbeatMessage,
  LocksReleasedMessage,
} from '../../shared/types';
import { HEARTBEAT_INTERVAL } from '../../shared/constants';

export type WebSocketStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

interface UseWebSocketOptions {
  url: string;
  roomId: string;
  userId: string;
  onMessage?: (message: SignalingMessageUnion) => void;
  onRoomState?: (message: RoomStateMessage) => void;
  onUserJoined?: (message: UserJoinedMessage) => void;
  onUserLeft?: (message: UserLeftMessage) => void;
  onLocksReleased?: (message: LocksReleasedMessage) => void;
  onOffer?: (message: OfferMessage) => void;
  onAnswer?: (message: AnswerMessage) => void;
  onIceCandidate?: (message: IceCandidateMessage) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
  onError?: (error: Error) => void;
  autoReconnect?: boolean;
  maxReconnectAttempts?: number;
  reconnectInterval?: number;
}

interface UseWebSocketReturn {
  status: WebSocketStatus;
  sendMessage: (message: SignalingMessageUnion) => void;
  sendOffer: (targetId: string, sdp: RTCSessionDescriptionInit) => void;
  sendAnswer: (targetId: string, sdp: RTCSessionDescriptionInit) => void;
  sendIceCandidate: (targetId: string, candidate: RTCIceCandidateInit) => void;
  sendJoinRoom: (userName: string) => void;
  disconnect: () => void;
  reconnect: () => void;
  reconnectAttempts: number;
}

export function useWebSocket({
  url,
  roomId,
  userId,
  onMessage,
  onRoomState,
  onUserJoined,
  onUserLeft,
  onLocksReleased,
  onOffer,
  onAnswer,
  onIceCandidate,
  onConnected,
  onDisconnected,
  onError,
  autoReconnect = true,
  maxReconnectAttempts = 5,
  reconnectInterval = 3000,
}: UseWebSocketOptions): UseWebSocketReturn {
  const wsRef = useRef<WebSocket | null>(null);
  const [status, setStatus] = useState<WebSocketStatus>('disconnected');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const shouldReconnectRef = useRef(autoReconnect);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearHeartbeatInterval = useCallback(() => {
    if (heartbeatIntervalRef.current) {
      clearInterval(heartbeatIntervalRef.current);
      heartbeatIntervalRef.current = null;
    }
  }, []);

  const sendHeartbeat = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const message: HeartbeatMessage = {
        type: 'heartbeat',
        roomId,
        userId,
        timestamp: Date.now(),
      };
      try {
        wsRef.current.send(JSON.stringify(message));
      } catch (error) {
        console.warn('Failed to send heartbeat:', error);
      }
    }
  }, [roomId, userId]);

  const startHeartbeat = useCallback(() => {
    clearHeartbeatInterval();
    heartbeatIntervalRef.current = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);
  }, [sendHeartbeat, clearHeartbeatInterval]);

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const message: SignalingMessageUnion = JSON.parse(event.data);
        onMessage?.(message);

        switch (message.type) {
          case 'room-state':
            onRoomState?.(message as RoomStateMessage);
            break;
          case 'user-joined':
            onUserJoined?.(message as UserJoinedMessage);
            break;
          case 'user-left':
            onUserLeft?.(message as UserLeftMessage);
            break;
          case 'locks-released':
            onLocksReleased?.(message as LocksReleasedMessage);
            break;
          case 'offer':
            onOffer?.(message as OfferMessage);
            break;
          case 'answer':
            onAnswer?.(message as AnswerMessage);
            break;
          case 'ice-candidate':
            onIceCandidate?.(message as IceCandidateMessage);
            break;
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
        onError?.(error instanceof Error ? error : new Error('Failed to parse message'));
      }
    },
    [onMessage, onRoomState, onUserJoined, onUserLeft, onLocksReleased, onOffer, onAnswer, onIceCandidate, onError]
  );

  const connect = useCallback(() => {
    clearReconnectTimeout();
    setStatus('connecting');

    try {
      const wsUrl = url.includes('?') ? `${url}&roomId=${roomId}&userId=${userId}` : `${url}?roomId=${roomId}&userId=${userId}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setStatus('connected');
        setReconnectAttempts(0);
        startHeartbeat();
        onConnected?.();
      };

      ws.onmessage = handleMessage;

      ws.onerror = (event) => {
        console.error('WebSocket error:', event);
        setStatus('error');
        onError?.(new Error('WebSocket connection error'));
      };

      ws.onclose = (event) => {
        setStatus('disconnected');
        clearHeartbeatInterval();
        onDisconnected?.();

        if (shouldReconnectRef.current && reconnectAttempts < maxReconnectAttempts) {
          setStatus('reconnecting');
          setReconnectAttempts((prev) => prev + 1);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, reconnectInterval);
        }
      };
    } catch (error) {
      console.error('Failed to create WebSocket:', error);
      setStatus('error');
      onError?.(error instanceof Error ? error : new Error('Failed to create WebSocket'));
    }
  }, [url, roomId, userId, handleMessage, onConnected, onDisconnected, onError, clearReconnectTimeout, clearHeartbeatInterval, startHeartbeat, reconnectAttempts, maxReconnectAttempts, reconnectInterval]);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    clearReconnectTimeout();
    clearHeartbeatInterval();

    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (error) {
        console.error('Error closing WebSocket:', error);
      }
      wsRef.current = null;
    }

    setStatus('disconnected');
  }, [clearReconnectTimeout, clearHeartbeatInterval]);

  const reconnect = useCallback(() => {
    setReconnectAttempts(0);
    shouldReconnectRef.current = true;
    connect();
  }, [connect]);

  const sendMessage = useCallback(
    (message: SignalingMessageUnion) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        try {
          wsRef.current.send(JSON.stringify(message));
        } catch (error) {
          console.error('Failed to send WebSocket message:', error);
          onError?.(error instanceof Error ? error : new Error('Failed to send message'));
        }
      } else {
        console.warn('WebSocket is not open. Cannot send message:', message);
      }
    },
    [onError]
  );

  const sendOffer = useCallback(
    (targetId: string, sdp: RTCSessionDescriptionInit) => {
      const message: OfferMessage = {
        type: 'offer',
        roomId,
        userId,
        targetId,
        sdp,
        timestamp: Date.now(),
      };
      sendMessage(message);
    },
    [roomId, userId, sendMessage]
  );

  const sendAnswer = useCallback(
    (targetId: string, sdp: RTCSessionDescriptionInit) => {
      const message: AnswerMessage = {
        type: 'answer',
        roomId,
        userId,
        targetId,
        sdp,
        timestamp: Date.now(),
      };
      sendMessage(message);
    },
    [roomId, userId, sendMessage]
  );

  const sendIceCandidate = useCallback(
    (targetId: string, candidate: RTCIceCandidateInit) => {
      const message: IceCandidateMessage = {
        type: 'ice-candidate',
        roomId,
        userId,
        targetId,
        candidate,
        timestamp: Date.now(),
      };
      sendMessage(message);
    },
    [roomId, userId, sendMessage]
  );

  const sendJoinRoom = useCallback(
    (userName: string) => {
      const message: JoinRoomMessage = {
        type: 'join-room',
        roomId,
        userId,
        userName,
        timestamp: Date.now(),
      };
      sendMessage(message);
    },
    [roomId, userId, sendMessage]
  );

  useEffect(() => {
    shouldReconnectRef.current = autoReconnect;
    connect();

    return () => {
      disconnect();
    };
  }, [connect, disconnect, autoReconnect]);

  return {
    status,
    sendMessage,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    sendJoinRoom,
    disconnect,
    reconnect,
    reconnectAttempts,
  };
}
