import { useRef, useEffect, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { RoomUser, BackgroundConfig } from '../types';

interface UseSocketOptions {
  onUserJoined?: (user: RoomUser) => void;
  onUserLeft?: (user: { socketId: string }) => void;
  onRoomUsers?: (users: RoomUser[]) => void;
  onBackgroundUpdated?: (background: BackgroundConfig) => void;
  onOffer?: (data: { from: string; offer: RTCSessionDescriptionInit }) => void;
  onAnswer?: (data: { from: string; answer: RTCSessionDescriptionInit }) => void;
  onIceCandidate?: (data: { from: string; candidate: RTCIceCandidateInit }) => void;
}

export function useSocket(options: UseSocketOptions = {}) {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [roomUsers, setRoomUsers] = useState<RoomUser[]>([]);
  const currentRoomRef = useRef<string | null>(null);

  const connect = useCallback(() => {
    if (socketRef.current?.connected) return;

    const socket = io('http://localhost:3001', {
      transports: ['websocket', 'polling']
    });

    socket.on('connect', () => {
      setIsConnected(true);
      console.log('Socket connected:', socket.id);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
      console.log('Socket disconnected');
    });

    socket.on('user-joined', (user: RoomUser) => {
      options.onUserJoined?.(user);
    });

    socket.on('user-left', (data: { socketId: string }) => {
      options.onUserLeft?.(data);
    });

    socket.on('room-users', (users: RoomUser[]) => {
      setRoomUsers(users);
      options.onRoomUsers?.(users);
    });

    socket.on('background-updated', (background: BackgroundConfig) => {
      options.onBackgroundUpdated?.(background);
    });

    socket.on('offer', (data: { from: string; offer: RTCSessionDescriptionInit }) => {
      options.onOffer?.(data);
    });

    socket.on('answer', (data: { from: string; answer: RTCSessionDescriptionInit }) => {
      options.onAnswer?.(data);
    });

    socket.on('ice-candidate', (data: { from: string; candidate: RTCIceCandidateInit }) => {
      options.onIceCandidate?.(data);
    });

    socketRef.current = socket;
    return socket;
  }, [options]);

  const joinRoom = useCallback((roomId: string, userId: string) => {
    if (!socketRef.current) return;
    socketRef.current.emit('join-room', { roomId, userId });
    currentRoomRef.current = roomId;
  }, []);

  const updateBackground = useCallback((background: BackgroundConfig) => {
    if (!socketRef.current || !currentRoomRef.current) return;
    socketRef.current.emit('background-update', {
      roomId: currentRoomRef.current,
      background
    });
  }, []);

  const sendOffer = useCallback((targetId: string, offer: RTCSessionDescriptionInit) => {
    if (!socketRef.current) return;
    socketRef.current.emit('offer', { targetId, offer });
  }, []);

  const sendAnswer = useCallback((targetId: string, answer: RTCSessionDescriptionInit) => {
    if (!socketRef.current) return;
    socketRef.current.emit('answer', { targetId, answer });
  }, []);

  const sendIceCandidate = useCallback((targetId: string, candidate: RTCIceCandidateInit) => {
    if (!socketRef.current) return;
    socketRef.current.emit('ice-candidate', { targetId, candidate });
  }, []);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => disconnect();
  }, [disconnect]);

  return {
    isConnected,
    roomUsers,
    connect,
    disconnect,
    joinRoom,
    updateBackground,
    sendOffer,
    sendAnswer,
    sendIceCandidate,
    socketId: socketRef.current?.id
  };
}
